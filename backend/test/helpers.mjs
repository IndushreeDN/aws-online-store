// Shared test helpers. Always import "./env.mjs" first so fake settings are in place.
import "./env.mjs";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { db } from "../src/common.mjs";
import { FakeDynamo } from "./fake-dynamo.mjs";

export const MODE = process.env.TEST_DB === "moto" ? "moto" : "memory";

const KEYS = {
  "eshop-products": ["productId"],
  "eshop-orders": ["userId", "orderId"],
};

let fake;

// Starts every test with a clean, empty database.
export async function resetDb() {
  if (MODE === "memory") {
    fake = new FakeDynamo(KEYS);
    db.send = (command) => fake.send(command);
    return;
  }
  const raw = new DynamoDBClient({});
  for (const [name, [hash, range]] of Object.entries(KEYS)) {
    try {
      await raw.send(new DeleteTableCommand({ TableName: name }));
    } catch {
      /* table did not exist yet */
    }
    await raw.send(
      new CreateTableCommand({
        TableName: name,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [hash, range].filter(Boolean).map((a) => ({ AttributeName: a, AttributeType: "S" })),
        KeySchema: [hash, range]
          .filter(Boolean)
          .map((a, i) => ({ AttributeName: a, KeyType: i === 0 ? "HASH" : "RANGE" })),
      }),
    );
  }
}

// Direct access to the stored data, so tests can check what really happened.
export async function putItem(table, item) {
  if (MODE === "memory") return fake.put(table, item);
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  await db.send(new PutCommand({ TableName: table, Item: item }));
}

export async function getItem(table, key) {
  const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
  const res = await db.send(new GetCommand({ TableName: table, Key: key }));
  return res.Item;
}

export async function allItems(table) {
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const res = await db.send(new ScanCommand({ TableName: table }));
  return res.Items ?? [];
}

// Builds the kind of "event" API Gateway hands to a Lambda function (HTTP API, format 2.0).
export function makeEvent({ method = "GET", path = "/", body, rawBody, query, pathParameters, claims } = {}) {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    queryStringParameters: query,
    pathParameters,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path },
      authorizer: claims ? { jwt: { claims, scopes: null } } : undefined,
    },
  };
}

export const SHOPPER = { sub: "user-shopper", email: "shopper@example.com" };
export const OTHER_SHOPPER = { sub: "user-other", email: "other@example.com" };
export const ADMIN = { sub: "user-admin", email: "admin@example.com", "cognito:groups": "[admins]" };

export const PRODUCTS = [
  { productId: "p-bottle", name: "Steel Bottle", description: "Keeps drinks cold", category: "Home", pricePaise: 34900, stock: 5, imageUrl: "/images/bottle.svg", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { productId: "p-earbuds", name: "Wireless Earbuds", description: "Bluetooth earbuds", category: "Electronics", pricePaise: 129900, stock: 3, imageUrl: "/images/earbuds.svg", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { productId: "p-last", name: "Last One Lamp", description: "Only one left", category: "Home", pricePaise: 59900, stock: 1, imageUrl: "/images/lamp.svg", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { productId: "p-sold", name: "Sold Out Mug", description: "Gone", category: "Home", pricePaise: 19900, stock: 0, imageUrl: "/images/mug.svg", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
  { productId: "p-hidden", name: "Hidden Item", description: "Not for sale", category: "Home", pricePaise: 10000, stock: 9, imageUrl: "/images/mug.svg", active: false, createdAt: "2026-01-01T00:00:00.000Z" },
];

export async function seedProducts() {
  for (const p of PRODUCTS) await putItem("eshop-products", p);
}

export const SHIPPING = {
  name: "Asha Rao",
  phone: "98765 43210",
  address: "12 MG Road, Indiranagar",
  city: "Bengaluru",
  pincode: "560038",
};

export function orderBody(items, overrides = {}) {
  return { items, paymentMethod: "TEST_SUCCESS", shipping: SHIPPING, ...overrides };
}

export function parse(response) {
  return { status: response.statusCode, body: JSON.parse(response.body) };
}
