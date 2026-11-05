// Builds the website and publishes it to the internet.
// Run:  npm run deploy:site
// Steps: read your AWS addresses -> write frontend/.env -> build -> upload to S3 -> refresh CloudFront.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, aws, fail, stackOutputs } from "./lib.mjs";
import { writeEnv } from "./configure.mjs";

const frontend = join(ROOT, "frontend");

function npm(args) {
  try {
    // shell is needed on Windows, where npm is a ".cmd" file
    execFileSync("npm", args, { cwd: frontend, stdio: "inherit", shell: process.platform === "win32" });
  } catch {
    fail(`"npm ${args.join(" ")}" failed. Read the messages above for the reason.`);
  }
}

console.log("1/5 Reading your AWS addresses…");
const outputs = stackOutputs();
writeEnv(outputs);

if (!existsSync(join(frontend, "node_modules"))) {
  console.log("2/5 Installing website tools (first time only, about a minute)…");
  npm(["install", "--no-audit", "--no-fund"]);
} else {
  console.log("2/5 Website tools already installed.");
}

console.log("3/5 Building the website…");
npm(["run", "build"]);

const bucket = `s3://${outputs.SiteBucketName}`;
const dist = join(frontend, "dist");
console.log("4/5 Uploading to S3…");
// Files in /assets have a fingerprint in their name, so browsers may keep them for a year.
aws(["s3", "sync", join(dist, "assets"), `${bucket}/assets`, "--delete", "--cache-control", "public,max-age=31536000,immutable"], { inherit: true });
// Pictures and other files: keep for an hour.
aws(["s3", "sync", dist, bucket, "--delete", "--exclude", "assets/*", "--exclude", "index.html", "--cache-control", "public,max-age=3600"], { inherit: true });
// The main page must always be fresh, because it points at the newest files.
aws(["s3", "cp", join(dist, "index.html"), `${bucket}/index.html`, "--cache-control", "no-cache", "--content-type", "text/html"], { inherit: true });

console.log("5/5 Refreshing CloudFront so visitors get the new version…");
aws(["cloudfront", "create-invalidation", "--distribution-id", outputs.DistributionId, "--paths", "/*", "--output", "json"]);

console.log(`\n✔ Your store is live at:\n\n   ${outputs.SiteUrl}\n\n(The first time, it can take a few minutes before the address works everywhere.)`);
