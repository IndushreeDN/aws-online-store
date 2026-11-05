// Admin-only endpoints. The signed-in user must belong to the Cognito group "admins".
//   POST /admin/products        -> add a product
//   PUT  /admin/products/{id}   -> change price, stock, name, etc.
//   GET  /admin/orders          -> the most recent orders from all shoppers

import { randomBytes } from "node:crypto";
import { PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  db,
  PRODUCTS_TABLE,
  ORDERS_TABLE,
  ok,
  json,
  wrap,
  HttpError,
  ID_PATTERN,
  requireAdmin,
  parseBody,
  cleanString,
  cleanInt,
  publicProduct,
} from "./common.mjs";
import { scanAllProducts } from "./products.mjs";

const MAX_PRICE_PAISE = 10_000_000; // Rs 1,00,000
const MAX_STOCK = 100_000;

// Images must live on our own site (/images/...) or be a secure web address.
function cleanImageUrl(value) {
  const url = cleanString(value, "Image link", { max: 300, required: false });
  if (url === undefined) return undefined;
  if (!(url.startsWith("/images/") || url.startsWith("https://"))) {
    throw new HttpError(400, "Image link must start with /images/ or https://", "VALIDATION");
  }
  return url;
}

export const addProduct = wrap(async (event) => {
  requireAdmin(event);
  const body = parseBody(event);

  const product = {
    productId: `p-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
    name: cleanString(body.name, "Name", { min: 2, max: 100 }),
    description: cleanString(body.description, "Description", { max: 1000, required: false }) ?? "",
    category: cleanString(body.category, "Category", { min: 2, max: 40 }),
    pricePaise: cleanInt(body.pricePaise, "Price", { min: 100, max: MAX_PRICE_PAISE }),
    stock: cleanInt(body.stock, "Stock", { min: 0, max: MAX_STOCK }),
    imageUrl: cleanImageUrl(body.imageUrl) ?? "/images/placeholder.svg",
    active: true,
    createdAt: new Date().toISOString(),
  };

  await db.send(
    new PutCommand({
      TableName: PRODUCTS_TABLE,
      Item: product,
      ConditionExpression: "attribute_not_exists(productId)",
    }),
  );
  return json(201, { product: publicProduct(product) });
});

export const updateProduct = wrap(async (event) => {
  requireAdmin(event);
  const id = event.pathParameters?.id;
  if (!id || !ID_PATTERN.test(id)) {
    throw new HttpError(400, "That product id is not valid.", "VALIDATION");
  }
  const body = parseBody(event);

  // Only the fields that were sent are changed.
  const changes = {};
  if (body.name !== undefined) changes.name = cleanString(body.name, "Name", { min: 2, max: 100 });
  if (body.description !== undefined)
    changes.description = cleanString(body.description, "Description", { max: 1000, required: false }) ?? "";
  if (body.category !== undefined)
    changes.category = cleanString(body.category, "Category", { min: 2, max: 40 });
  if (body.pricePaise !== undefined)
    changes.pricePaise = cleanInt(body.pricePaise, "Price", { min: 100, max: MAX_PRICE_PAISE });
  if (body.stock !== undefined) changes.stock = cleanInt(body.stock, "Stock", { min: 0, max: MAX_STOCK });
  if (body.imageUrl !== undefined) changes.imageUrl = cleanImageUrl(body.imageUrl);
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      throw new HttpError(400, "Active must be true or false.", "VALIDATION");
    }
    changes.active = body.active;
  }

  const fields = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (fields.length === 0) {
    throw new HttpError(400, "Nothing to change.", "VALIDATION");
  }

  const names = {};
  const values = {};
  const sets = fields.map((field, i) => {
    names[`#f${i}`] = field;
    values[`:v${i}`] = changes[field];
    return `#f${i} = :v${i}`;
  });

  try {
    const res = await db.send(
      new UpdateCommand({
        TableName: PRODUCTS_TABLE,
        Key: { productId: id },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(productId)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return ok({ product: publicProduct(res.Attributes) });
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      throw new HttpError(404, "We could not find that product.", "NOT_FOUND");
    }
    throw err;
  }
});

// Admin view of every product, including hidden ones.
export const listAllProducts = wrap(async (event) => {
  requireAdmin(event);
  const products = await scanAllProducts();
  products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return ok({
    products: products.map((p) => ({ ...publicProduct(p), active: p.active !== false })),
  });
});

export const listOrders = wrap(async (event) => {
  requireAdmin(event);
  const orders = [];
  let startKey;
  do {
    const res = await db.send(
      new ScanCommand({ TableName: ORDERS_TABLE, ExclusiveStartKey: startKey }),
    );
    orders.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey && orders.length < 1000);
  orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ orders: orders.slice(0, 100) });
});
