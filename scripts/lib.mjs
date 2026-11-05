// Small helpers shared by the setup scripts. You do not need to read or change this file.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const STACK_NAME = process.env.STACK_NAME || "eshop";
export const APP_NAME = process.env.APP_NAME || "eshop";

export function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function hintFor(text) {
  if (/Unable to locate credentials|NoCredentialProviders|could not be found/i.test(text)) {
    return "Your computer is not connected to AWS yet. Do Step 3 of the guide (aws configure), then try again.";
  }
  if (/does not exist/i.test(text) && /stack/i.test(text)) {
    return "The backend is not deployed yet. Do Step 5 of the guide (npm run deploy:backend), then try again.";
  }
  if (/ExpiredToken|security token/i.test(text)) {
    return "Your AWS login has expired. Run aws configure again (or aws login) and retry.";
  }
  if (/You must specify a region|Could not connect to the endpoint/i.test(text)) {
    return "No AWS Region is set. Run: aws configure set region <your-region> (see Step 3).";
  }
  if (/AccessDenied|not authorized/i.test(text)) {
    return "Your AWS user is not allowed to do this. Check it has the AdministratorAccess policy (Step 1).";
  }
  return "";
}

// Runs an AWS CLI command and returns its output.
export function aws(args, { json = true, inherit = false } = {}) {
  try {
    const out = execFileSync("aws", args, {
      encoding: "utf8",
      cwd: ROOT,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    if (inherit || !json) return out;
    return out.trim() ? JSON.parse(out) : {};
  } catch (err) {
    if (err.code === "ENOENT") {
      fail("The AWS command line tool (aws) was not found. Install it (Step 2 of the guide), then open a NEW terminal window.");
    }
    const text = String(err.stderr || err.message).trim();
    const hint = hintFor(text);
    fail(`An AWS command failed:\n  aws ${args.join(" ")}\n\n${text}${hint ? `\n\n→ ${hint}` : ""}`);
  }
}

// Reads the addresses and ids that "sam deploy" created.
export function stackOutputs() {
  const data = aws(["cloudformation", "describe-stacks", "--stack-name", STACK_NAME, "--output", "json"]);
  const stack = data.Stacks?.[0];
  if (!stack) fail(`Could not find the stack "${STACK_NAME}". Do Step 5 of the guide first.`);
  if (!/^(CREATE|UPDATE)_COMPLETE$/.test(stack.StackStatus)) {
    fail(
      `The stack "${STACK_NAME}" is in the state ${stack.StackStatus}, not finished. ` +
        `Wait a few minutes, or look at the Events tab of the stack in the AWS console (CloudFormation).`,
    );
  }
  const outputs = Object.fromEntries((stack.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
  for (const key of ["ApiUrl", "UserPoolClientId", "Region", "SiteBucketName", "DistributionId", "SiteUrl"]) {
    if (!outputs[key]) fail(`The stack is missing the output "${key}". Run npm run deploy:backend again.`);
  }
  return outputs;
}
