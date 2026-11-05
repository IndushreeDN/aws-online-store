import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN, OTHER_SHOPPER, SHIPPING, SHOPPER,
  allItems, getItem, makeEvent, orderBody, parse, resetDb, seedProducts,
} from "./helpers.mjs";
import { place, list, priceOrder, newOrderId, sendConfirmationEmail } from "../src/orders.mjs";

beforeEach(async () => {
  await resetDb();
  await seedProducts();
});

const placeOrder = (body, claims = SHOPPER, extra = {}) =>
  place(makeEvent({ method: "POST", path: "/orders", body, claims, ...extra }));

const stockOf = async (id) => (await getItem("eshop-products", { productId: id })).stock;

describe("POST /orders: working cases", () => {
  it("places an order, lowers stock, saves it, and charges delivery under Rs 999", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity: 2 }])));
    assert.equal(res.status, 201);
    const order = res.body.order;
    assert.equal(order.subtotalPaise, 69800);
    assert.equal(order.shippingPaise, 4900);
    assert.equal(order.totalPaise, 74700);
    assert.equal(order.status, "PLACED");
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.userId, SHOPPER.sub);
    assert.equal(order.email, SHOPPER.email);
    assert.equal(order.shipping.phone, "9876543210"); // spaces removed
    assert.equal(await stockOf("p-bottle"), 3);
    const saved = await allItems("eshop-orders");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].orderId, order.orderId);
  });

  it("gives free delivery from Rs 999", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-earbuds", quantity: 1 }])));
    assert.equal(res.body.order.shippingPaise, 0);
    assert.equal(res.body.order.totalPaise, 129900);
  });

  it("ignores any price sent by the browser", async () => {
    const res = parse(
      await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1, pricePaise: 1, price: 1 }], { totalPaise: 1 })),
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.order.items[0].pricePaise, 34900);
    assert.equal(res.body.order.subtotalPaise, 34900);
  });

  it("merges the same product listed twice into one line", async () => {
    const res = parse(
      await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }, { productId: "p-bottle", quantity: 2 }])),
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.order.items.length, 1);
    assert.equal(res.body.order.items[0].quantity, 3);
    assert.equal(await stockOf("p-bottle"), 2);
  });

  it("accepts pay on delivery (payment pending, order still placed)", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }], { paymentMethod: "COD" })));
    assert.equal(res.status, 201);
    assert.equal(res.body.order.paymentStatus, "PAY_ON_DELIVERY");
  });

  it("lets a shopper order the very last unit", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-last", quantity: 1 }])));
    assert.equal(res.status, 201);
    assert.equal(await stockOf("p-last"), 0);
  });

  it("handles a multi-product order and lowers every stock", async () => {
    const res = parse(
      await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }, { productId: "p-earbuds", quantity: 2 }])),
    );
    assert.equal(res.status, 201);
    assert.equal(await stockOf("p-bottle"), 4);
    assert.equal(await stockOf("p-earbuds"), 1);
  });
});

describe("POST /orders: failing cases (must be refused safely)", () => {
  it("declined test payment: 402, no order, stock unchanged", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }], { paymentMethod: "TEST_DECLINED" })));
    assert.equal(res.status, 402);
    assert.equal(res.body.code, "PAYMENT_DECLINED");
    assert.equal(await stockOf("p-bottle"), 5);
    assert.equal((await allItems("eshop-orders")).length, 0);
  });

  it("sold-out product: 409 and nothing changes", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-sold", quantity: 1 }])));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "OUT_OF_STOCK");
    assert.match(res.body.error, /out of stock/);
    assert.equal((await allItems("eshop-orders")).length, 0);
  });

  it("asking for more than the stock: 409 with a helpful message", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-earbuds", quantity: 4 }])));
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Only 3 of "Wireless Earbuds"/);
  });

  it("all-or-nothing: if one item is short, the other item's stock is NOT lowered", async () => {
    const res = parse(
      await placeOrder(orderBody([{ productId: "p-bottle", quantity: 2 }, { productId: "p-sold", quantity: 1 }])),
    );
    assert.equal(res.status, 409);
    assert.equal(await stockOf("p-bottle"), 5);
    assert.equal((await allItems("eshop-orders")).length, 0);
  });

  it("two shoppers racing for the last unit: exactly one wins", async () => {
    const [a, b] = await Promise.all([
      placeOrder(orderBody([{ productId: "p-last", quantity: 1 }]), SHOPPER),
      placeOrder(orderBody([{ productId: "p-last", quantity: 1 }]), OTHER_SHOPPER),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(statuses, [201, 409]);
    const loser = parse(a.statusCode === 409 ? a : b);
    assert.equal(loser.body.code, "OUT_OF_STOCK"); // proves we read DynamoDB's reason for cancelling
    assert.match(loser.body.error, /just sold out/);
    assert.equal(await stockOf("p-last"), 0); // never below zero
    assert.equal((await allItems("eshop-orders")).length, 1);
  });

  it("unknown product: 400", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-ghost", quantity: 1 }])));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "PRODUCT_UNAVAILABLE");
  });

  it("hidden (inactive) product cannot be ordered", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-hidden", quantity: 1 }])));
    assert.equal(res.status, 400);
  });

  it("not signed in: 401", async () => {
    const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }]), null));
    assert.equal(res.status, 401);
    assert.equal(await stockOf("p-bottle"), 5);
  });

  it("empty or missing cart: 400", async () => {
    for (const items of [[], undefined, "p-bottle", {}]) {
      const res = parse(await placeOrder({ ...orderBody([]), items }));
      assert.equal(res.status, 400, `items=${JSON.stringify(items)}`);
    }
  });

  it("bad quantities: 400", async () => {
    for (const quantity of [0, -1, 1.5, "2", null, 11]) {
      const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity }])));
      assert.equal(res.status, 400, `quantity=${JSON.stringify(quantity)}`);
    }
  });

  it("too many different products: 400", async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ productId: `p-${i}`, quantity: 1 }));
    const res = parse(await placeOrder(orderBody(items)));
    assert.equal(res.status, 400);
  });

  it("merging cannot sneak past the per-product limit: 400", async () => {
    const items = [{ productId: "p-bottle", quantity: 6 }, { productId: "p-bottle", quantity: 6 }];
    const res = parse(await placeOrder(orderBody(items)));
    assert.equal(res.status, 400);
  });

  it("bad delivery details: 400", async () => {
    const bad = [
      { ...SHIPPING, phone: "12345" },
      { ...SHIPPING, phone: "5876543210" },
      { ...SHIPPING, pincode: "12345" },
      { ...SHIPPING, pincode: "0123456" },
      { ...SHIPPING, name: "" },
      { ...SHIPPING, address: "x" },
      { ...SHIPPING, city: undefined },
      undefined,
    ];
    for (const shipping of bad) {
      const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }], { shipping })));
      assert.equal(res.status, 400, JSON.stringify(shipping));
    }
    assert.equal(await stockOf("p-bottle"), 5);
  });

  it("unknown payment method: 400", async () => {
    for (const paymentMethod of ["BITCOIN", "", undefined, 5, "toString"]) {
      const res = parse(await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }], { paymentMethod })));
      assert.equal(res.status, 400, String(paymentMethod));
    }
  });

  it("broken JSON, empty body, JSON that is not an object: 400", async () => {
    for (const rawBody of ["{not json", "", "[]", "null", "123"]) {
      const res = parse(await place(makeEvent({ method: "POST", rawBody, claims: SHOPPER })));
      assert.equal(res.status, 400, `body=${rawBody}`);
    }
  });

  it("huge request: 413", async () => {
    const res = parse(await place(makeEvent({ method: "POST", rawBody: JSON.stringify({ x: "a".repeat(25000) }), claims: SHOPPER })));
    assert.equal(res.status, 413);
  });
});

describe("GET /orders", () => {
  it("returns only the signed-in shopper's own orders, newest first", async () => {
    await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }]), SHOPPER);
    await new Promise((r) => setTimeout(r, 5));
    await placeOrder(orderBody([{ productId: "p-earbuds", quantity: 1 }]), SHOPPER);
    await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }]), OTHER_SHOPPER);

    const mine = parse(await list(makeEvent({ path: "/orders", claims: SHOPPER })));
    assert.equal(mine.status, 200);
    assert.equal(mine.body.orders.length, 2);
    assert.equal(mine.body.orders[0].items[0].productId, "p-earbuds"); // newest first
    assert.ok(mine.body.orders.every((o) => o.userId === SHOPPER.sub));

    const theirs = parse(await list(makeEvent({ path: "/orders", claims: OTHER_SHOPPER })));
    assert.equal(theirs.body.orders.length, 1);
  });

  it("gives an empty list when there are no orders", async () => {
    const res = parse(await list(makeEvent({ path: "/orders", claims: SHOPPER })));
    assert.deepEqual(res.body.orders, []);
  });

  it("requires sign-in: 401", async () => {
    assert.equal(parse(await list(makeEvent({ path: "/orders" }))).status, 401);
  });

  it("an admin's own list is still only their own orders", async () => {
    await placeOrder(orderBody([{ productId: "p-bottle", quantity: 1 }]), SHOPPER);
    const res = parse(await list(makeEvent({ path: "/orders", claims: ADMIN })));
    assert.deepEqual(res.body.orders, []);
  });
});

describe("helpers", () => {
  it("priceOrder: exactly Rs 999 ships free, one paisa less pays delivery", () => {
    const products = new Map([["a", { productId: "a", name: "A", pricePaise: 99900, imageUrl: "" }], ["b", { productId: "b", name: "B", pricePaise: 99899, imageUrl: "" }]]);
    assert.equal(priceOrder([{ productId: "a", quantity: 1 }], products).shippingPaise, 0);
    assert.equal(priceOrder([{ productId: "b", quantity: 1 }], products).shippingPaise, 4900);
  });

  it("order ids sort by time and do not repeat", () => {
    const ids = Array.from({ length: 200 }, () => newOrderId(new Date("2026-10-19T10:00:00.000Z")));
    assert.equal(new Set(ids).size, 200);
    assert.ok(newOrderId(new Date("2026-10-19T10:00:00.000Z")) < newOrderId(new Date("2026-10-19T10:00:01.000Z")));
  });

  it("email is skipped quietly when no sender is configured", async () => {
    delete process.env.SENDER_EMAIL;
    await sendConfirmationEmail({ email: "a@b.c", items: [], shipping: {} });
  });
});
