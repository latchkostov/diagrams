// Bundle composition of the shipped build (docs/BENCHMARKS.md § Metrics): the production build as `pnpm build` makes it
// (no VITE_E2E), in memory, measured chunk by chunk.
//
//   node scripts/bench/bundle.mjs [--mode full|gates|quick]
//
// Writes the `bundle` part: the entry chunk, the startup JavaScript (the entry and what index.html preloads), the
// canvas's first view (startup plus CanvasView and canvas-shared), the live session's chunk, every chunk's size,
// and in `info.chunks` each chunk's biggest modules, so `pnpm bench:compare` can say what grew. Sizes are raw,
// gzip (level 9, as scripts/bundle-budget.mjs measures) and brotli.
//
// Gates (bytes don't depend on the machine): the entry within scripts/bundle-budget.mjs's budget (read from that
// file: one number, one place), and the startup JavaScript, the canvas's first view and the live session within
// BUDGETS below (about 15% over what they measured, as the entry's budget is).

import { build } from "vite";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import zlib from "node:zlib";
import { Buffer } from "node:buffer";

const OUT = path.resolve(process.env.BENCH_OUT ?? path.join("tests", ".output", "bench"));

/** Gzip bytes, measured 2026-10-14 on master plus about 15%. Raise one on purpose, in the change that needs it. */
const BUDGETS = {
  // 145,053 B measured: the entry, React, React DOM and the diagram loader's chunks (17 files).
  startup: 167_000,
  // 319,777 B measured: startup plus CanvasView and canvas-shared.
  canvasFirstView: 368_000,
  // 78,323 B measured.
  liveSession: 90_000,
};

const entryBudget = (() => {
  const text = fs.readFileSync(path.resolve("scripts", "bundle-budget.mjs"), "utf8");
  const m = /const BUDGET = ([\d_]+);/.exec(text);
  if (!m) throw new Error("bundle.mjs: no BUDGET in scripts/bundle-budget.mjs");
  return Number(m[1].replaceAll("_", ""));
})();

const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const brotli = (buf) => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const sizes = (code) => {
  const buf = Buffer.from(code);
  return { raw: buf.length, gzip: gzip(buf), brotli: brotli(buf) };
};
/** A chunk's name without its content hash: stable across builds. */
const stable = (fileName) => fileName.replace(/^assets\//, "").replace(/-[\w-]{8}(\.\w+)$/, "$1");
const rel = (id) =>
  path
    .relative(process.cwd(), id.replace(/^\0/, ""))
    .replaceAll("\\", "/")
    .replace(/^.*node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/");

const env = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
delete process.env.VITE_E2E;
let result;
try {
  result = await build({ configFile: path.resolve("vite.config.ts"), logLevel: "silent", build: { write: false } });
} finally {
  process.env.NODE_ENV = env;
}
const output = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
const chunks = output.filter((o) => o.type === "chunk");
const html = String(output.find((o) => o.type === "asset" && o.fileName === "index.html")?.source ?? "");
const byFile = new Map(chunks.map((c) => [c.fileName, c]));
const srcOf = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\.\//, ""));
const entryFile = srcOf(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/g)[0];
const preloaded = srcOf(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g);
const closure = (from) => {
  const seen = new Set();
  for (const stack = [...from]; stack.length;) {
    const c = stack.pop();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    stack.push(...c.imports.map((f) => byFile.get(f)));
  }
  return seen;
};
const startup = closure([byFile.get(entryFile), ...preloaded.map((f) => byFile.get(f))]);
const canvas = closure([...startup, ...chunks.filter((c) => c.name === "CanvasView")]);
const live = chunks.find((c) => c.name === "LiveSession");
const sum = (set, k) => [...set].reduce((n, c) => n + c.sizes[k], 0);

for (const c of chunks) c.sizes = sizes(c.code);
const metrics = [];
const add = (id, scenario, value, gate) =>
  metrics.push({
    id: `bundle/${id}`,
    suite: "bundle",
    scenario,
    kind: "bytes",
    unit: "bytes",
    value,
    env: "build",
    ...(gate ? { gate } : {}),
  });
const within = (value, limit, why) => ({ op: "<=", limit, pass: value <= limit, why });

const entry = byFile.get(entryFile);
add("entry/gzip", "entry", entry.sizes.gzip, within(entry.sizes.gzip, entryBudget, "scripts/bundle-budget.mjs"));
add("entry/raw", "entry", entry.sizes.raw);
add("entry/brotli", "entry", entry.sizes.brotli);
const startupGzip = sum(startup, "gzip");
add("startup/gzip", "startup", startupGzip, within(startupGzip, BUDGETS.startup, "entry and preloaded chunks"));
add("startup/raw", "startup", sum(startup, "raw"));
add("startup/chunks", "startup", startup.size);
const canvasGzip = sum(canvas, "gzip");
add(
  "canvasFirstView/gzip",
  "canvasFirstView",
  canvasGzip,
  within(canvasGzip, BUDGETS.canvasFirstView, "startup plus the canvas's two chunks"),
);
if (live)
  add("liveSession/gzip", "liveSession", live.sizes.gzip, within(live.sizes.gzip, BUDGETS.liveSession, "LiveSession"));
add(
  "allJs/gzip",
  "allJs",
  chunks.reduce((n, c) => n + c.sizes.gzip, 0),
);
add("allJs/chunks", "allJs", chunks.length);
for (const c of chunks) add(`chunk/${stable(c.fileName)}/gzip`, "chunk", c.sizes.gzip);

const info = {
  entry: stable(entryFile),
  startup: [...startup].map((c) => stable(c.fileName)).sort(),
  chunks: Object.fromEntries(
    chunks.map((c) => [
      stable(c.fileName),
      {
        ...c.sizes,
        modules: Object.entries(c.modules)
          .filter(([, m]) => m.renderedLength > 0)
          .map(([id, m]) => [rel(id), m.renderedLength])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40),
      },
    ]),
  ),
};

const dir = path.join(OUT, "parts");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, "build-bundle.json"),
  JSON.stringify(
    { schema: "livediagrams-bench/v1", suite: "bundle", env: "build", calibrationMs: NaN, metrics, info },
    null,
    1,
  ),
);
const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
console.log(
  `bundle: entry ${kB(entry.sizes.gzip)} gzip, startup ${kB(startupGzip)} (${startup.size} chunks), canvas first view ${kB(canvasGzip)}, ${chunks.length} chunks`,
);
const failed = metrics.filter((m) => m.gate && !m.gate.pass);
for (const m of failed) console.error(`bundle: ${m.id} ${m.value} B is over its budget of ${m.gate.limit} B`);
process.exitCode = failed.length ? 1 : 0;
