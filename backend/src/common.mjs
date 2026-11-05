// Shared helpers used by every backend function (Lambda).
//
// Beginner note: a "Lambda function" is a small piece of code that AWS runs only when
// someone calls it. API Gateway receives the web request, hands it to the function as
// an "event", and sends back whatever the function returns.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// The table names come from the environment, which template.yaml fills in.
export const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
export const ORDERS_TABLE = process.env.ORDERS_TABLE;

// `db.send(...)` is the single door to DynamoDB. Tests swap it out if they need to.
export const db = {
  client: DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  }),
  send(command) {
    return this.client.send(command);
  },
};

// ---------- Responses ----------

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const ok = (body) => json(200, body);

// An error we raise on purpose, with a message that is safe to show to the shopper.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Wraps a handler so that any error becomes a clean JSON reply.
// Unexpected errors are logged for us (CloudWatch) but never shown to the shopper.
export function wrap(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(err.status, { error: err.message, code: err.code });
      }
      console.error("Unexpected error", err);
      return json(500, { error: "Something went wrong on our side. Please try again." });
    }
  };
}

// ---------- Request helpers ----------

export function parseBody(event, maxBytes = 20000) {
  const raw = event.body;
  if (raw === undefined || raw === null || raw === "") {
    throw new HttpError(400, "The request body is empty.", "BAD_REQUEST");
  }
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new HttpError(413, "The request is too large.", "TOO_LARGE");
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.", "BAD_REQUEST");
  }
}

// API Gateway has already checked the login token before our code runs.
// Here we only read the facts (claims) it found inside the token.
export function getUser(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !claims.sub) {
    throw new HttpError(401, "Please sign in first.", "UNAUTHENTICATED");
  }
  const groups = parseGroups(claims["cognito:groups"]);
  return {
    userId: String(claims.sub),
    email: claims.email ? String(claims.email) : undefined,
    groups,
    isAdmin: groups.includes("admins"),
  };
}

// API Gateway turns a list claim into text such as "[admins]" or "[admins staff]".
export function parseGroups(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

export function requireAdmin(event) {
  const user = getUser(event);
  if (!user.isAdmin) {
    throw new HttpError(403, "Only store admins can do this.", "FORBIDDEN");
  }
  return user;
}

// ---------- Validation helpers ----------

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function cleanString(value, field, { min = 0, max = 200, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${field} is required.`, "VALIDATION");
    return undefined;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be text.`, "VALIDATION");
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(
      400,
      `${field} must be between ${min} and ${max} characters.`,
      "VALIDATION",
    );
  }
  return trimmed;
}

export function cleanInt(value, field, { min, max, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, `${field} is required.`, "VALIDATION");
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(
      400,
      `${field} must be a whole number between ${min} and ${max}.`,
      "VALIDATION",
    );
  }
  return value;
}

// What shoppers are allowed to see about a product.
export function publicProduct(p) {
  return {
    productId: p.productId,
    name: p.name,
    description: p.description,
    category: p.category,
    pricePaise: p.pricePaise,
    stock: p.stock,
    imageUrl: p.imageUrl,
  };
}
