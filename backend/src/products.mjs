// Public product endpoints. Anyone can call these, no login needed.
//   GET /products        -> list of products (optional ?category=...&q=...)
//   GET /products/{id}   -> one product

import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { db, PRODUCTS_TABLE, ok, wrap, HttpError, ID_PATTERN, publicProduct } from "./common.mjs";

// A "Scan" reads the whole table. That is fine for a small shop (hundreds of products).
// DynamoDB returns at most 1 MB per call, so we keep asking until there is no more.
export async function scanAllProducts() {
  const items = [];
  let startKey;
  do {
    const res = await db.send(
      new ScanCommand({ TableName: PRODUCTS_TABLE, ExclusiveStartKey: startKey }),
    );
    items.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export const list = wrap(async (event) => {
  const query = event.queryStringParameters ?? {};
  const category = (query.category ?? "").trim().toLowerCase();
  const search = (query.q ?? "").trim().toLowerCase();

  let products = (await scanAllProducts()).filter((p) => p.active !== false);

  if (category) {
    products = products.filter((p) => String(p.category).toLowerCase() === category);
  }
  if (search) {
    products = products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(search) ||
        String(p.description ?? "").toLowerCase().includes(search),
    );
  }

  products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return ok({ products: products.map(publicProduct) });
});

export const get = wrap(async (event) => {
  const id = event.pathParameters?.id;
  if (!id || !ID_PATTERN.test(id)) {
    throw new HttpError(400, "That product id is not valid.", "VALIDATION");
  }
  const res = await db.send(new GetCommand({ TableName: PRODUCTS_TABLE, Key: { productId: id } }));
  if (!res.Item || res.Item.active === false) {
    throw new HttpError(404, "We could not find that product.", "NOT_FOUND");
  }
  return ok({ product: publicProduct(res.Item) });
});
