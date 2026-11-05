// Deletes EVERYTHING this project created in AWS (tables, login pool, API, website).
// Run:  npm run destroy
// Orders and users are deleted permanently.

import { createInterface } from "node:readline/promises";
import { STACK_NAME, aws, fail, stackOutputs } from "./lib.mjs";

if (!process.argv.includes("--yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This permanently deletes the stack "${STACK_NAME}": all products, orders, users and the website.\nType DELETE to continue: `,
  );
  rl.close();
  if (answer.trim() !== "DELETE") fail("Cancelled. Nothing was deleted.");
}

const outputs = stackOutputs();
console.log("1/3 Emptying the website bucket…");
aws(["s3", "rm", `s3://${outputs.SiteBucketName}`, "--recursive"], { inherit: true });

console.log("2/3 Deleting the stack…");
aws(["cloudformation", "delete-stack", "--stack-name", STACK_NAME], { json: false });

console.log("3/3 Waiting until AWS finishes (CloudFront can take 10 to 15 minutes)…");
aws(["cloudformation", "wait", "stack-delete-complete", "--stack-name", STACK_NAME], { json: false, inherit: true });
console.log("\n✔ Everything has been deleted.");
