// Order endpoints. The shopper must be signed in (API Gateway checks the login token).
//   POST /orders   -> place an order from the cart
//   GET  /orders   -> the signed-in shopper's own orders, newest first

import { randomBytes } from "node:crypto";
import { BatchGetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  db,
  PRODUCTS_TABLE,
  ORDERS_TABLE,
  ok,
  json,
  wrap,
  HttpError,
  ID_PATTERN,
  getUser,
  parseBody,
  cleanString,
} from "./common.mjs";

export const MAX_LINES = 10; // different products in one order
export const MAX_QUANTITY = 10; // of one product
export const FREE_SHIPPING_FROM_PAISE = 99900; // Rs 999
export const SHIPPING_FEE_PAISE = 4900; // Rs 49

// No real card is ever used. These are pretend payment results so you can test both
// the happy path and the failure path.
export const PAYMENT_METHODS = {
  TEST_SUCCESS: { paymentStatus: "PAID" },
  TEST_DECLINED: { paymentStatus: "DECLINED" },
  COD: { paymentStatus: "PAY_ON_DELIVERY" },
};

// ---------- Validation ----------

export function validateOrderInput(body) {
  // 1) Items: a list of {productId, quantity}. Same product twice is merged into one line.
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, "Your cart is empty.", "VALIDATION");
  }
  const merged = new Map();
  for (const item of body.items) {
    const productId = item?.productId;
    const quantity = item?.quantity;
    if (typeof productId !== "string" || !ID_PATTERN.test(productId)) {
      throw new HttpError(400, "One of the items has an invalid product id.", "VALIDATION");
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new HttpError(400, "Each quantity must be a whole number of 1 or more.", "VALIDATION");
    }
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  if (merged.size > MAX_LINES) {
    throw new HttpError(400, `You can order up to ${MAX_LINES} different products at a time.`, "VALIDATION");
  }
  const lines = [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  for (const line of lines) {
    if (line.quantity > MAX_QUANTITY) {
      throw new HttpError(400, `You can order up to ${MAX_QUANTITY} of one product.`, "VALIDATION");
    }
  }

  // 2) Payment method
  const paymentMethod = body.paymentMethod;
  if (typeof paymentMethod !== "string" || !Object.hasOwn(PAYMENT_METHODS, paymentMethod)) {
    throw new HttpError(400, "Please choose a valid payment method.", "VALIDATION");
  }

  // 3) Delivery address
  const s = body.shipping;
  if (!s || typeof s !== "object") {
    throw new HttpError(400, "Please enter your delivery details.", "VALIDATION");
  }
  const phone = String(s.phone ?? "").replace(/[\s-]/g, "").replace(/^(\+91|0)/, "");
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new HttpError(400, "Please enter a valid 10-digit mobile number.", "VALIDATION");
  }
  const pincode = String(s.pincode ?? "").trim();
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    throw new HttpError(400, "Please enter a valid 6-digit PIN code.", "VALIDATION");
  }
  const shipping = {
    name: cleanString(s.name, "Name", { min: 2, max: 80 }),
    phone,
    address: cleanString(s.address, "Address", { min: 5, max: 200 }),
    city: cleanString(s.city, "City", { min: 2, max: 60 }),
    pincode,
  };

  return { lines, paymentMethod, shipping };
}

// The server always works out prices itself from the database.
// Anything a browser claims about price is ignored.
export function priceOrder(lines, products) {
  let subtotalPaise = 0;
  const items = lines.map((line) => {
    const p = products.get(line.productId);
    subtotalPaise += p.pricePaise * line.quantity;
    return {
      productId: p.productId,
      name: p.name,
      pricePaise: p.pricePaise,
      quantity: line.quantity,
      imageUrl: p.imageUrl,
    };
  });
  const shippingPaise = subtotalPaise >= FREE_SHIPPING_FROM_PAISE ? 0 : SHIPPING_FEE_PAISE;
  return { items, subtotalPaise, shippingPaise, totalPaise: subtotalPaise + shippingPaise };
}

export function newOrderId(now = new Date()) {
  // Starts with the date and time so orders sort by time, plus a random tail so two
  // orders in the same millisecond never clash.
  const stamp = now.toISOString().replace(/\D/g, "");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

// ---------- Place an order ----------

export const place = wrap(async (event) => {
  const user = getUser(event);
  const { lines, paymentMethod, shipping } = validateOrderInput(parseBody(event));

  // Load the real products from the database.
  const ids = lines.map((l) => l.productId);
  const res = await db.send(
    new BatchGetCommand({
      RequestItems: { [PRODUCTS_TABLE]: { Keys: ids.map((productId) => ({ productId })) } },
    }),
  );
  if (Object.keys(res.UnprocessedKeys ?? {}).length > 0) {
    throw new HttpError(503, "The store is busy. Please try again in a moment.", "BUSY");
  }
  const products = new Map((res.Responses?.[PRODUCTS_TABLE] ?? []).map((p) => [p.productId, p]));

  for (const line of lines) {
    const p = products.get(line.productId);
    if (!p || p.active === false) {
      throw new HttpError(400, "One of the items in your cart is no longer available.", "PRODUCT_UNAVAILABLE");
    }
    if (p.stock < line.quantity) {
      const msg =
        p.stock <= 0
          ? `"${p.name}" is out of stock.`
          : `Only ${p.stock} of "${p.name}" left in stock.`;
      throw new HttpError(409, msg, "OUT_OF_STOCK");
    }
  }

  const { items, subtotalPaise, shippingPaise, totalPaise } = priceOrder(lines, products);

  // Pretend payment step. A declined payment stops here: no order, no stock change.
  const { paymentStatus } = PAYMENT_METHODS[paymentMethod];
  if (paymentStatus === "DECLINED") {
    throw new HttpError(
      402,
      "Your test payment was declined. No money was taken and your cart is unchanged.",
      "PAYMENT_DECLINED",
    );
  }

  const now = new Date();
  const order = {
    userId: user.userId,
    orderId: newOrderId(now),
    createdAt: now.toISOString(),
    status: "PLACED",
    paymentMethod,
    paymentStatus,
    email: user.email,
    items,
    subtotalPaise,
    shippingPaise,
    totalPaise,
    shipping,
  };

  // One all-or-nothing step: lower the stock of every product AND save the order.
  // If any product ran out a moment ago, nothing at all is changed.
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          ...lines.map((line) => ({
            Update: {
              TableName: PRODUCTS_TABLE,
              Key: { productId: line.productId },
              UpdateExpression: "SET #stock = #stock - :qty",
              ConditionExpression: "attribute_exists(productId) AND #stock >= :qty",
              ExpressionAttributeNames: { "#stock": "stock" },
              ExpressionAttributeValues: { ":qty": line.quantity },
            },
          })),
          {
            Put: {
              TableName: ORDERS_TABLE,
              Item: order,
              ConditionExpression: "attribute_not_exists(orderId)",
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err?.name === "TransactionCanceledException") {
      const reasons = err.CancellationReasons ?? [];
      const failed = reasons.findIndex((r) => r?.Code === "ConditionalCheckFailed");
      if (failed >= 0 && failed < lines.length) {
        const p = products.get(lines[failed].productId);
        throw new HttpError(
          409,
          `Sorry, "${p.name}" just sold out or has less stock than you asked for. Please update your cart.`,
          "OUT_OF_STOCK",
        );
      }
      throw new HttpError(409, "Another order was being processed. Please try again.", "CONFLICT");
    }
    throw err;
  }

  await sendConfirmationEmail(order);

  return json(201, { order });
});

// ---------- Order history ----------

export const list = wrap(async (event) => {
  const user = getUser(event);
  const res = await db.send(
    new QueryCommand({
      TableName: ORDERS_TABLE,
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": user.userId },
      ScanIndexForward: false, // newest first
      Limit: 50,
    }),
  );
  return ok({ orders: res.Items ?? [] });
});

// ---------- Optional confirmation email (Amazon SES) ----------
// Skipped completely unless SENDER_EMAIL is set. A failure here never fails the order.

export async function sendConfirmationEmail(order) {
  const sender = process.env.SENDER_EMAIL;
  if (!sender || !order.email) return;
  try {
    const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const rupees = (paise) => `Rs ${(paise / 100).toLocaleString("en-IN")}`;
    const lines = order.items
      .map((i) => `- ${i.name} x ${i.quantity}: ${rupees(i.pricePaise * i.quantity)}`)
      .join("\n");
    const text =
      `Thank you for your order!\n\nOrder number: ${order.orderId}\n\n${lines}\n\n` +
      `Delivery: ${rupees(order.shippingPaise)}\nTotal: ${rupees(order.totalPaise)}\n\n` +
      `Delivering to: ${order.shipping.name}, ${order.shipping.address}, ${order.shipping.city} ${order.shipping.pincode}\n`;
    await new SESv2Client({}).send(
      new SendEmailCommand({
        FromEmailAddress: sender,
        Destination: { ToAddresses: [order.email] },
        Content: {
          Simple: {
            Subject: { Data: `Your order ${order.orderId} is confirmed` },
            Body: { Text: { Data: text } },
          },
        },
      }),
    );
  } catch (err) {
    console.error("Could not send confirmation email", err?.name, err?.message);
  }
}
