import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN, SHOPPER, getItem, makeEvent, orderBody, parse, resetDb, seedProducts,
} from "./helpers.mjs";
import { addProduct, updateProduct, listAllProducts, listOrders } from "../src/admin.mjs";
import { list as listProducts, get as getProduct } from "../src/products.mjs";
import { place } from "../src/orders.mjs";
import { parseGroups } from "../src/common.mjs";

beforeEach(async () => {
  await resetDb();
  await seedProducts();
});

const add = (body, claims = ADMIN) => addProduct(makeEvent({ method: "POST", path: "/admin/products", body, claims }));
const update = (id, body, claims = ADMIN) =>
  updateProduct(makeEvent({ method: "PUT", path: `/admin/products/${id}`, pathParameters: { id }, body, claims }));

const goodProduct = { name: "Desk Plant", description: "Green", category: "Home", pricePaise: 25000, stock: 10 };

describe("who may use admin endpoints", () => {
  it("a normal shopper gets 403 everywhere", async () => {
    assert.equal(parse(await add(goodProduct, SHOPPER)).status, 403);
    assert.equal(parse(await update("p-bottle", { stock: 1 }, SHOPPER)).status, 403);
    assert.equal(parse(await listAllProducts(makeEvent({ claims: SHOPPER }))).status, 403);
    assert.equal(parse(await listOrders(makeEvent({ claims: SHOPPER }))).status, 403);
  });

  it("someone not signed in gets 401", async () => {
    assert.equal(parse(await add(goodProduct, null)).status, 401);
  });

  it("reads the admins group in every format API Gateway may use", () => {
    assert.deepEqual(parseGroups("[admins]"), ["admins"]);
    assert.deepEqual(parseGroups("[admins staff]"), ["admins", "staff"]);
    assert.deepEqual(parseGroups("admins,staff"), ["admins", "staff"]);
    assert.deepEqual(parseGroups(["admins"]), ["admins"]);
    assert.deepEqual(parseGroups(undefined), []);
    assert.deepEqual(parseGroups("[]"), []);
  });

  it("a group that merely contains the word admins is not enough", async () => {
    const sneaky = { sub: "u-x", email: "x@example.com", "cognito:groups": "[superadmins]" };
    assert.equal(parse(await add(goodProduct, sneaky)).status, 403);
  });
});

describe("adding a product", () => {
  it("admin adds a product and shoppers can then see it", async () => {
    const res = parse(await add({ ...goodProduct, imageUrl: "https://example.com/plant.jpg" }));
    assert.equal(res.status, 201);
    assert.match(res.body.product.productId, /^p-/);
    const shopList = parse(await listProducts(makeEvent({ path: "/products" })));
    assert.ok(shopList.body.products.some((p) => p.name === "Desk Plant"));
    const one = parse(await getProduct(makeEvent({ pathParameters: { id: res.body.product.productId } })));
    assert.equal(one.status, 200);
  });

  it("uses a placeholder picture when none is given", async () => {
    const res = parse(await add(goodProduct));
    assert.equal(res.body.product.imageUrl, "/images/placeholder.svg");
  });

  it("rejects bad input with 400", async () => {
    const bad = [
      { ...goodProduct, name: "x" },
      { ...goodProduct, name: undefined },
      { ...goodProduct, category: "" },
      { ...goodProduct, pricePaise: 0 },
      { ...goodProduct, pricePaise: -500 },
      { ...goodProduct, pricePaise: 99.5 },
      { ...goodProduct, pricePaise: "25000" },
      { ...goodProduct, pricePaise: 99_999_999 },
      { ...goodProduct, stock: -1 },
      { ...goodProduct, stock: 1.5 },
      { ...goodProduct, imageUrl: "javascript:alert(1)" },
      { ...goodProduct, imageUrl: "http://insecure.example.com/a.jpg" },
      { ...goodProduct, description: "d".repeat(1001) },
    ];
    for (const body of bad) {
      assert.equal(parse(await add(body)).status, 400, JSON.stringify(body));
    }
  });
});

describe("updating a product", () => {
  it("changes only the fields sent", async () => {
    const res = parse(await update("p-bottle", { pricePaise: 29900, stock: 20 }));
    assert.equal(res.status, 200);
    assert.equal(res.body.product.pricePaise, 29900);
    assert.equal(res.body.product.stock, 20);
    assert.equal(res.body.product.name, "Steel Bottle"); // untouched
  });

  it("can rename (name is a reserved word in DynamoDB, so this guards our placeholders)", async () => {
    const res = parse(await update("p-bottle", { name: "Steel Bottle 1L" }));
    assert.equal(res.status, 200);
    assert.equal(res.body.product.name, "Steel Bottle 1L");
  });

  it("hiding a product removes it from the shop and from ordering", async () => {
    assert.equal(parse(await update("p-bottle", { active: false })).status, 200);
    const shopList = parse(await listProducts(makeEvent({ path: "/products" })));
    assert.equal(shopList.body.products.some((p) => p.productId === "p-bottle"), false);
    assert.equal(parse(await getProduct(makeEvent({ pathParameters: { id: "p-bottle" } }))).status, 404);
    const order = parse(
      await place(makeEvent({ method: "POST", body: orderBody([{ productId: "p-bottle", quantity: 1 }]), claims: SHOPPER })),
    );
    assert.equal(order.status, 400);
    const adminList = parse(await listAllProducts(makeEvent({ claims: ADMIN })));
    assert.equal(adminList.body.products.find((p) => p.productId === "p-bottle").active, false);
  });

  it("unknown product: 404 (and nothing is created)", async () => {
    assert.equal(parse(await update("p-missing", { stock: 5 })).status, 404);
    assert.equal(await getItem("eshop-products", { productId: "p-missing" }), undefined);
  });

  it("nothing to change, or bad values: 400", async () => {
    assert.equal(parse(await update("p-bottle", {})).status, 400);
    assert.equal(parse(await update("p-bottle", { stock: -3 })).status, 400);
    assert.equal(parse(await update("p-bottle", { active: "no" })).status, 400);
    assert.equal(parse(await update("p-bottle", { imageUrl: "ftp://x" })).status, 400);
    assert.equal(parse(await update("bad id!", { stock: 1 })).status, 400);
  });
});

describe("admin order list", () => {
  it("shows orders from all shoppers, newest first", async () => {
    const order = (claims, id) =>
      place(makeEvent({ method: "POST", body: orderBody([{ productId: id, quantity: 1 }]), claims }));
    await order(SHOPPER, "p-bottle");
    await new Promise((r) => setTimeout(r, 5));
    await order({ sub: "user-two", email: "two@example.com" }, "p-earbuds");
    const res = parse(await listOrders(makeEvent({ claims: ADMIN })));
    assert.equal(res.status, 200);
    assert.equal(res.body.orders.length, 2);
    assert.equal(res.body.orders[0].items[0].productId, "p-earbuds");
  });
});
