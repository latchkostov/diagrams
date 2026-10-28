import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

// Greek is the largest production catalog: 95,987 B gzip on 2026-10-27. About 1.5% room
// makes catalog growth visible without changing the existing loading or startup budgets.
export const LOCALE_BUDGET = 97_500;
// Arabic core: 37,299 B gzip, plus 1.9% headroom. Optional surfaces cannot spend this reserve.
export const CORE_LOCALE_BUDGET = 38_000;

export function checkCoreLocaleSizes(sizes) {
  const core = sizes.filter(({ file }) => /-core-/.test(file));
  for (const { file, gzip } of core) {
    if (gzip > CORE_LOCALE_BUDGET)
      throw new Error(`core locale budget: ${file}: ${gzip} B gzip exceeds ${CORE_LOCALE_BUDGET} B`);
  }
  return core.reduce((max, size) => (!max || size.gzip > max.gzip ? size : max), undefined);
}

export function localeSizes(outDir) {
  const codes = fs
    .readdirSync("src/i18n/locales")
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .map((f) => f.slice(0, -5));
  return fs
    .readdirSync(path.join(outDir, "assets"))
    .filter((f) => codes.some((code) => f.startsWith(`${code}-`)) && f.endsWith(".js"))
    .map((file) => ({ file, gzip: gzipSync(fs.readFileSync(path.join(outDir, "assets", file)), { level: 9 }).length }));
}

export function checkLocaleSizes(sizes) {
  // English-only self-hosted copies emit no locale catalogs.
  if (!sizes.length) return;
  checkCoreLocaleSizes(sizes);
  const totals = new Map();
  for (const { file, gzip } of sizes) {
    const code = /(?:^|\/)(.+?)-(?:core|tutorials|stencils|simulation|exports|ai)-/.exec(file)?.[1] ?? file;
    totals.set(code, (totals.get(code) ?? 0) + gzip);
  }
  const combined = [...totals].map(([file, gzip]) => ({ file, gzip }));
  for (const { file, gzip } of combined) {
    if (gzip > LOCALE_BUDGET) throw new Error(`locale budget: ${file}: ${gzip} B gzip exceeds ${LOCALE_BUDGET} B`);
  }
  return combined.reduce((max, size) => (size.gzip > max.gzip ? size : max));
}
