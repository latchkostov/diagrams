// Fails if the main entry JS chunk (the <script type="module"> in the built index.html) grows past its
// gzip budget. Run after a build: `pnpm size` (or `node scripts/bundle-budget.mjs <outDir>`).
// Limits stay fixed; low headroom schedules a dedicated trim PR (docs/QUALITY.md).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import zlib from "node:zlib";
import {
  checkLocaleSizes,
  checkCoreLocaleSizes,
  CORE_LOCALE_BUDGET,
  localeSizes,
  LOCALE_BUDGET,
} from "./locale-budget.mjs";

/** Entry chunk gzip budget in bytes: 107,278 B measured on 2026-10-12, plus about 15%. */
const BUDGET = 123_500;

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
const sizes = localeSizes(outDir);
const core = checkCoreLocaleSizes(sizes);
if (core)
  console.log(
    `bundle-budget: core locales ok. Largest ${core.file}: ${core.gzip} B gzip; budget ${CORE_LOCALE_BUDGET} B.`,
  );
const locale = checkLocaleSizes(sizes);
console.log(
  locale
    ? `bundle-budget: locales ok. Largest ${locale.file}: ${locale.gzip} B gzip; budget ${LOCALE_BUDGET} B.`
    : "bundle-budget: no locale catalogs emitted.",
);

// The platform viewer is deliberately independent of the app entry. Count every JS/CSS/font asset once.
// 698.1 kB measured with the full stencil icon catalog and both fonts, plus about 15%.
const VIEWER_BUDGET = 805_000;
const viewerDir = "dist-viewer";
const manifest = JSON.parse(fs.readFileSync(path.join(viewerDir, "manifest.json"), "utf8"));
const viewerGzip = manifest.files
  .filter((name) => /\.(js|css|woff2)$/.test(name))
  .reduce((total, name) => total + zlib.gzipSync(fs.readFileSync(path.join(viewerDir, name)), { level: 9 }).length, 0);
if (viewerGzip > VIEWER_BUDGET) {
  console.error(`bundle-budget: viewer over budget: ${kB(viewerGzip)} gzip; budget ${kB(VIEWER_BUDGET)}.`);
  process.exit(1);
}
console.log(`bundle-budget: viewer ok. ${kB(viewerGzip)} gzip; budget ${kB(VIEWER_BUDGET)}.`);
