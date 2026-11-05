// Puts the sample products from seed/products.json into your products table.
// Run:  npm run seed
// If the table already has products it stops, so your changes are never overwritten.
// To reset the sample products on purpose:  npm run seed -- --force

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, ROOT, aws, fail } from "./lib.mjs";

const TABLE = `${APP_NAME}-products`;
const force = process.argv.includes("--force");

const dbValue = (v) =>
  typeof v === "number" ? { N: String(v) } : typeof v === "boolean" ? { BOOL: v } : { S: String(v) };

const products = JSON.parse(readFileSync(join(ROOT, "seed", "products.json"), "utf8"));
if (products.length > 25) fail("A single batch can hold at most 25 products.");

const count = aws(["dynamodb", "scan", "--table-name", TABLE, "--select", "COUNT", "--output", "json"]).Count;
if (count > 0 && !force) {
  fail(
    `The table "${TABLE}" already has ${count} product(s), so nothing was changed.\n` +
      `To reset the sample products to their starting stock, run: npm run seed -- --force`,
  );
}

const now = new Date().toISOString();
let pending = products.map((p) => ({
  PutRequest: {
    Item: Object.fromEntries(Object.entries({ ...p, active: true, createdAt: now }).map(([k, v]) => [k, dbValue(v)])),
  },
}));

const batchFile = join(ROOT, "seed", ".batch.json");
try {
  for (let attempt = 1; pending.length > 0 && attempt <= 5; attempt++) {
    writeFileSync(batchFile, JSON.stringify({ [TABLE]: pending }));
    const result = aws(["dynamodb", "batch-write-item", "--request-items", "file://seed/.batch.json", "--output", "json"]);
    pending = result.UnprocessedItems?.[TABLE] ?? [];
  }
} finally {
  rmSync(batchFile, { force: true });
}
if (pending.length > 0) fail(`${pending.length} product(s) could not be saved. Please run the command again.`);
console.log(`✔ Added ${products.length} sample products to ${TABLE}`);
