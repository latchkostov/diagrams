// Fails if the main entry JS chunk (the <script type="module"> in the built index.html) grows past its
// gzip budget. Run after a build: `pnpm size` (or `node scripts/bundle-budget.mjs <outDir>`).
// Raise the budget deliberately, in the same change that needs it, and say why in the commit message.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import zlib from "node:zlib";

/** Entry chunk gzip budget in bytes: 112,727 B measured on 2026-10-11, plus about 15%. */
const BUDGET = 130_000;

const outDir = process.argv[2] ?? "dist";
const htmlPath = path.join(outDir, "index.html");
if (!fs.existsSync(htmlPath)) {
  console.error(`bundle-budget: ${htmlPath} not found; run a build first.`);
  process.exit(1);
}
const src = /<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/.exec(fs.readFileSync(htmlPath, "utf8"))?.[1];
if (!src) {
  console.error(`bundle-budget: no module entry script in ${htmlPath}.`);
  process.exit(1);
}
const file = path.join(outDir, src.replace(/^\.?\//, ""));
const raw = fs.readFileSync(file);
const gz = zlib.gzipSync(raw, { level: 9 }).length;
const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
const pct = ((gz / BUDGET) * 100).toFixed(0);
const line = `entry ${path.basename(file)}: ${kB(raw.length)} raw, ${kB(gz)} gzip; budget ${kB(BUDGET)} gzip (${pct}%)`;
if (gz > BUDGET) {
  console.error(`bundle-budget: over budget by ${kB(gz - BUDGET)}. ${line}`);
  process.exit(1);
}
console.log(`bundle-budget: ok. ${line}`);
