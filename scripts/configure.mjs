// Writes frontend/.env so the website knows where your backend and login live.
// Run:  npm run configure            (safe to run as often as you like)
//       npm run configure -- --name "My Shop Name"

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, stackOutputs } from "./lib.mjs";

export function writeEnv(outputs, storeName) {
  const envPath = join(ROOT, "frontend", ".env");
  let name = storeName;
  if (!name && existsSync(envPath)) {
    name = readFileSync(envPath, "utf8").match(/^VITE_STORE_NAME=(.*)$/m)?.[1]?.trim();
  }
  name ||= "My Online Store";
  const text = [
    '# Written by "npm run configure". Nothing in this file is secret.',
    `VITE_API_URL=${outputs.ApiUrl}`,
    `VITE_COGNITO_REGION=${outputs.Region}`,
    `VITE_COGNITO_CLIENT_ID=${outputs.UserPoolClientId}`,
    `VITE_STORE_NAME=${name}`,
    "",
  ].join("\n");
  writeFileSync(envPath, text);
  return envPath;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("configure.mjs")) {
  const i = process.argv.indexOf("--name");
  const storeName = i > -1 ? process.argv[i + 1] : undefined;
  const outputs = stackOutputs();
  const path = writeEnv(outputs, storeName);
  console.log(`✔ Wrote ${path}`);
  console.log(`  API address : ${outputs.ApiUrl}`);
  console.log(`  Region      : ${outputs.Region}`);
  console.log("\nNext: start the website on your computer with  npm run dev");
}
