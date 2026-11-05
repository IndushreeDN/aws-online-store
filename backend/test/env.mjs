// Sets up fake settings BEFORE the backend code is loaded (import this file first).
process.env.PRODUCTS_TABLE = "eshop-products";
process.env.ORDERS_TABLE = "eshop-orders";
delete process.env.SENDER_EMAIL;

// Normal mode ("memory") needs nothing but Node: a tiny in-memory database stands in for DynamoDB.
// Advanced mode (TEST_DB=moto) runs the very same tests against a local DynamoDB look-alike server.
if (process.env.TEST_DB === "moto") {
  process.env.AWS_ENDPOINT_URL ??= "http://127.0.0.1:5055";
}
process.env.AWS_REGION ??= "ap-south-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
