// Draws a simple picture (a coloured tile with an emoji) for each product.
// Run it with:  node scripts/make-images.mjs
// You do NOT need to run it: the pictures are already in frontend/public/images.
// Replace any .svg with your own photo (keep the name, or change imageUrl in the product).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "frontend", "public", "images");
mkdirSync(outDir, { recursive: true });

const looks = {
  earbuds: ["🎧", "#cfe3ff", "#9ec5ff"],
  speaker: ["🔊", "#d9d3ff", "#b3a8ff"],
  stand: ["📱", "#cdeff0", "#8fdadd"],
  kurta: ["👕", "#ffe1c9", "#ffbe8c"],
  backpack: ["🎒", "#ffd6dc", "#ff9fb0"],
  shoes: ["👟", "#ffe9a8", "#ffd35c"],
  bottle: ["🥤", "#cdf2dc", "#8fe0b0"],
  lamp: ["💡", "#fff3b8", "#ffe066"],
  mug: ["🏺", "#f3dccb", "#e0b595"],
  yoga: ["🧘", "#e3d4f7", "#c9a6f0"],
  coffee: ["☕", "#e8d9c9", "#c9a883"],
  notebook: ["📓", "#d6e4f5", "#9fbfe6"],
  placeholder: ["📦", "#e6eaf0", "#c9d1dc"],
};

const names = Object.fromEntries(
  JSON.parse(readFileSync(join(root, "seed", "products.json"), "utf8")).map((p) => [
    p.imageUrl.replace(/^\/images\/|\.svg$/g, ""),
    p.name,
  ]),
);
names.placeholder = "Product picture coming soon";

const escapeXml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

for (const [id, [emoji, c1, c2]] of Object.entries(looks)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="${escapeXml(names[id] ?? id)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <circle cx="300" cy="300" r="190" fill="#ffffff" fill-opacity="0.55"/>
  <text x="300" y="305" font-size="210" text-anchor="middle" dominant-baseline="central" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${emoji}</text>
</svg>
`;
  writeFileSync(join(outDir, `${id}.svg`), svg);
}
console.log(`Wrote ${Object.keys(looks).length} pictures to frontend/public/images`);
