// Compares two benchmark runs (docs/BENCHMARKS.md § Output, § Compare):
//
//   pnpm bench:compare <base.json> <head.json> [--md report.md] [--fail-on-regression]
//
// - Gates: every gate that fails in head (the only thing that fails this command, unless --fail-on-regression).
// - Timings: compared normalised (ms ÷ the run's calibration), so a slower runner isn't a regression. A change counts
//   when it's beyond the noise: 25%, or three times the larger coefficient of variation of the two samples, whichever
//   is more, and at least 2 ms either way. Single-sample timings get 50%. (Two runs of one commit on a shared desktop
//   differed by a median of 21% and a p90 of 61%: docs/BENCHMARKS.md § Measured variance.)
// - Counts: every change, increases first (renders, commits, nodes and listeners left behind, operations).
// - Sizes: every chunk that grew by more than 200 bytes gzip, with the modules that grew in it; memory (heap bytes)
//   up by a quarter and a megabyte or more.

import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import { fmt, table } from "./lib.mjs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--") && !(args[args.indexOf(a) - 1] === "--md"));
const mdAt = args.indexOf("--md");
const mdFile = mdAt >= 0 ? args[mdAt + 1] : undefined;
const failOnRegression = args.includes("--fail-on-regression");
if (files.length !== 2) {
  console.error("usage: pnpm bench:compare <base.json> <head.json> [--md report.md] [--fail-on-regression]");
  process.exit(2);
}
const [base, head] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const byId = (r) => new Map(r.metrics.map((m) => [m.id, m]));
const B = byId(base);
const H = byId(head);

const pct = (r) => `${r >= 1 ? "+" : "−"}${Math.abs((r - 1) * 100).toFixed(0)}%`;
/** Throughput, where more is better. Renders and commits per second are work: they're counts (more is worse). */
const RATES = new Set(["frames/s"]);

const regressions = [];
const improvements = [];
const counts = [];
const ratios = [];
const sizes = [];
/** Heap and other memory bytes: noisy (V8's caches), so only a quarter more and a megabyte or more. */
const heap = [];
for (const [id, h] of H) {
  const b = B.get(id);
  if (!b) continue;
  if (h.kind === "time" || RATES.has(h.unit)) {
    const useNorm = Number.isFinite(b.normalized) && Number.isFinite(h.normalized);
    const bv = useNorm ? b.normalized : b.value;
    const hv = useNorm ? h.normalized : h.value;
    if (!(bv > 0) || !Number.isFinite(hv)) continue;
    const many = (b.stats?.n ?? 1) > 2 && (h.stats?.n ?? 1) > 2;
    const tol = many ? Math.max(0.25, 3 * Math.max(b.stats.cov, h.stats.cov)) : 0.5;
    const ratio = hv / bv;
    const higherIsBetter = RATES.has(h.unit);
    const worse = higherIsBetter ? ratio < 1 / (1 + tol) : ratio > 1 + tol;
    const better = higherIsBetter ? ratio > 1 + tol : ratio < 1 / (1 + tol);
    // At least 2 ms either way, in head's milliseconds: the normalised difference times head's calibration.
    const headCal = useNorm && h.normalized > 0 ? h.value / h.normalized : 1;
    const big = h.unit !== "ms" || Math.abs(hv - bv) * (useNorm ? headCal : 1) >= 2;
    const row = { id, b, h, ratio, tol };
    if (worse && big) regressions.push(row);
    else if (better && big) improvements.push(row);
  } else if ((h.kind === "count" || h.kind === "percent") && h.value !== b.value)
    counts.push({ id, b, h, delta: h.value - b.value });
  else if (h.kind === "ratio" && h.value > b.value * 1.5) ratios.push({ id, b, h });
  else if (h.kind === "bytes" && h.suite === "bundle" && h.value - b.value > 200 && h.value > b.value * 1.005)
    sizes.push({ id, b, h });
  else if (h.kind === "bytes" && h.suite !== "bundle" && h.value > b.value * 1.25 && h.value - b.value > 1e6)
    heap.push({ id, b, h });
}
const failed = [...H.values()].filter((m) => m.gate && !m.gate.pass);
const added = [...H.keys()].filter((id) => !B.has(id));
const removed = [...B.keys()].filter((id) => !H.has(id));

/** The modules that grew in chunks that grew (bundle part info). */
function grownModules() {
  const bc = base.info?.["build-bundle"]?.chunks ?? {};
  const hc = head.info?.["build-bundle"]?.chunks ?? {};
  const rows = [];
  for (const [name, c] of Object.entries(hc)) {
    const was = bc[name];
    if (was && c.gzip - was.gzip <= 200) continue;
    const before = new Map(was?.modules ?? []);
    for (const [mod, len] of c.modules) {
      const d = len - (before.get(mod) ?? 0);
      if (d > 500)
        rows.push([
          name,
          mod,
          before.has(mod) ? `+${d.toLocaleString("en-US")} B` : `new, ${len.toLocaleString("en-US")} B`,
        ]);
    }
  }
  return rows.sort((a, b) => Number(b[2].replace(/\D/g, "")) - Number(a[2].replace(/\D/g, ""))).slice(0, 25);
}

const out = [];
const who = (r) =>
  `\`${r.meta.env.commit.slice(0, 10)}\` (${r.meta.env.branch}, ${r.meta.date.slice(0, 16).replace("T", " ")}, ${r.meta.env.cpu}${r.meta.env.ci ? ", CI" : ""}, mode ${r.meta.mode})`;
out.push("# Benchmark comparison", "");
out.push(`- base: ${who(base)}`, `- head: ${who(head)}`);
const cal = (k) =>
  `${k} ${fmt({ unit: "ms" }, base.meta.calibrationMs[k])} → ${fmt({ unit: "ms" }, head.meta.calibrationMs[k])}`;
out.push(`- calibration: ${cal("node")}, ${cal("browser")} (timings below are compared after dividing by these)`, "");

out.push(
  `**${failed.length ? `${failed.length} gate${failed.length > 1 ? "s" : ""} failed` : "Every gate passed"}** · ${regressions.length} timing regression${regressions.length === 1 ? "" : "s"} beyond noise · ${improvements.length} improvement${improvements.length === 1 ? "" : "s"} · ${counts.length} count${counts.length === 1 ? "" : "s"} changed · ${sizes.length} size${sizes.length === 1 ? "" : "s"} grew`,
  "",
);
if (failed.length) {
  out.push("## Gate failures", "");
  out.push(
    table(
      ["Gate", "Base", "Head", "Limit", "Why"],
      failed.map((m) => [
        `\`${m.id}\``,
        B.has(m.id) ? fmt(B.get(m.id)) : "new",
        fmt(m),
        `${m.gate.op} ${fmt(m, m.gate.limit)}`,
        m.gate.why ?? "",
      ]),
    ),
    "",
  );
}
const timingRows = (rows) =>
  rows
    .sort((a, b) => (a.ratio > 1 ? b.ratio - a.ratio : a.ratio - b.ratio))
    .map((r) => [`\`${r.id}\``, fmt(r.b), fmt(r.h), pct(r.ratio), `±${(r.tol * 100).toFixed(0)}%`]);
if (regressions.length) {
  out.push("## Slower (report-only)", "");
  out.push(table(["Metric", "Base", "Head", "Change (normalised)", "Noise"], timingRows(regressions)), "");
}
if (counts.length) {
  out.push("## Counts that changed", "");
  out.push(
    table(
      ["Metric", "Base", "Head", "Change"],
      counts
        .sort((a, b) => b.delta - a.delta)
        .map((r) => [`\`${r.id}\``, fmt(r.b), fmt(r.h), `${r.delta > 0 ? "+" : ""}${fmt(r.h, r.delta)}`]),
    ),
    "",
  );
}
if (ratios.length) {
  out.push("## Growth ratios up by half or more", "");
  out.push(
    table(
      ["Ratio", "Base", "Head"],
      ratios.map((r) => [`\`${r.id}\``, fmt(r.b), fmt(r.h)]),
    ),
    "",
  );
}
if (sizes.length) {
  out.push("## Bundle: what grew", "");
  out.push(
    table(
      ["Size", "Base", "Head", "Change"],
      sizes.map((r) => [`\`${r.id}\``, fmt(r.b), fmt(r.h), `+${(r.h.value - r.b.value).toLocaleString("en-US")} B`]),
    ),
    "",
  );
  const mods = grownModules();
  if (mods.length) out.push(table(["Chunk", "Module", "Rendered"], mods), "");
}
if (heap.length) {
  out.push("## Memory up by a quarter or more", "");
  out.push(
    table(
      ["Metric", "Base", "Head", "Change"],
      heap.map((r) => [`\`${r.id}\``, fmt(r.b), fmt(r.h), `+${fmt(r.h, r.h.value - r.b.value)}`]),
    ),
    "",
  );
}
if (improvements.length) {
  out.push("## Faster", "");
  out.push(table(["Metric", "Base", "Head", "Change (normalised)", "Noise"], timingRows(improvements)), "");
}
if (added.length || removed.length) {
  out.push("## Metrics added or removed", "");
  if (added.length)
    out.push(
      `New: ${added.length} (${added
        .slice(0, 12)
        .map((x) => `\`${x}\``)
        .join(", ")}${added.length > 12 ? ", …" : ""})`,
      "",
    );
  if (removed.length)
    out.push(
      `Gone: ${removed.length} (${removed
        .slice(0, 12)
        .map((x) => `\`${x}\``)
        .join(", ")}${removed.length > 12 ? ", …" : ""})`,
      "",
    );
}
const text = out.join("\n") + "\n";
if (mdFile) fs.writeFileSync(mdFile, text);
console.log(text);
process.exitCode = failed.length || (failOnRegression && regressions.length) ? 1 : 0;
