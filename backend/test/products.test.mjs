import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeEvent, parse, resetDb, seedProducts } from "./helpers.mjs";
import { list, get } from "../src/products.mjs";

beforeEach(async () => {
  await resetDb();
  await seedProducts();
});

describe("GET /products", () => {
  it("lists active products only, sorted by name, without internal fields", async () => {
    const { status, body } = parse(await list(makeEvent({ path: "/products" })));
    assert.equal(status, 200);
    assert.deepEqual(
      body.products.map((p) => p.name),
      ["Last One Lamp", "Sold Out Mug", "Steel Bottle", "Wireless Earbuds"],
    );
    assert.equal(body.products.some((p) => p.productId === "p-hidden"), false);
    assert.equal("active" in body.products[0], false);
    assert.equal("createdAt" in body.products[0], false);
  });

  it("filters by category (ignoring upper/lower case)", async () => {
    const { body } = parse(await list(makeEvent({ query: { category: "electronics" } })));
    assert.deepEqual(body.products.map((p) => p.productId), ["p-earbuds"]);
  });

  it("filters by search text in name or description", async () => {
    const { body } = parse(await list(makeEvent({ query: { q: "bluetooth" } })));
    assert.deepEqual(body.products.map((p) => p.productId), ["p-earbuds"]);
  });

  it("returns an empty list (not an error) when nothing matches", async () => {
    const { status, body } = parse(await list(makeEvent({ query: { q: "nothing-like-this" } })));
    assert.equal(status, 200);
    assert.deepEqual(body.products, []);
  });
});

describe("GET /products/{id}", () => {
  it("returns one product", async () => {
    const { status, body } = parse(await get(makeEvent({ pathParameters: { id: "p-bottle" } })));
    assert.equal(status, 200);
    assert.equal(body.product.name, "Steel Bottle");
    assert.equal(body.product.pricePaise, 34900);
  });

  it("returns 404 for an unknown product", async () => {
    const { status, body } = parse(await get(makeEvent({ pathParameters: { id: "p-nope" } })));
    assert.equal(status, 404);
    assert.equal(body.code, "NOT_FOUND");
  });

  it("returns 404 for a hidden (inactive) product", async () => {
    const { status } = parse(await get(makeEvent({ pathParameters: { id: "p-hidden" } })));
    assert.equal(status, 404);
  });

  it("returns 400 for a badly formed id", async () => {
    for (const id of ["../secret", "a b", "x".repeat(41), ""]) {
      const { status } = parse(await get(makeEvent({ pathParameters: { id } })));
      assert.equal(status, 400, `id "${id}" should be rejected`);
    }
  });
});
