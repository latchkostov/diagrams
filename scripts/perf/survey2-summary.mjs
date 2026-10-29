// Summarise the opt-in survey helper's raw observations and diagnostic profiles.
// node scripts/perf/survey2-summary.mjs [tests/.output/bench/survey2] [replacement.jsonl ...]
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";

const dir = process.argv[2] ?? "tests/.output/bench/survey2";
// Later files replace whole metric groups, preserving earlier exploratory raw
// data without mixing a corrected fixture's samples with the original fixture.
const groups = new Map();
for (const file of ["samples.jsonl", ...process.argv.slice(3)]) {
  const rows = fs.readFileSync(path.join(dir, file), "utf8").trim().split("\n").map(JSON.parse);
  for (const [metric, group] of Map.groupBy(rows, (row) => row.metric)) groups.set(metric, group);
}
const summary = {};
for (const [key, group] of groups) {
  const fields = new Set(group.flatMap((row) => (typeof row.data === "number" ? ["value"] : Object.keys(row.data))));
  const out = {};
  for (const field of fields) {
    const values = group
      .map((row) => (typeof row.data === "number" ? row.data : row.data[field]))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!values.length) continue;
    out[field] = {
      n: values.length,
      median: values[Math.floor(values.length / 2)],
      min: values[0],
      max: values.at(-1),
    };
  }
  summary[key] = out;
}
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"))) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
  const self = new Map();
  const inclusive = new Map();
  for (const [i, id] of (p.samples ?? []).entries()) {
    const dt = p.timeDeltas[i] / 1000;
    const label = (id) => {
      const f = nodes.get(id).callFrame;
      return `${f.functionName || "(anonymous)"} ${f.url.split("/").at(-1) || "native"}`;
    };
    const key = label(id);
    self.set(key, (self.get(key) ?? 0) + dt);
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const key = label(cur);
      if (!seen.has(key)) inclusive.set(key, (inclusive.get(key) ?? 0) + dt);
      seen.add(key);
    }
  }
  const top = (m) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([fn, ms]) => ({ fn, ms: Math.round(ms) }));
  const report = { self: top(self), inclusive: top(inclusive) };
  fs.writeFileSync(
    path.join(dir, file.replace(".cpuprofile", ".profile-summary.json")),
    JSON.stringify(report, null, 2),
  );
}
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".trace.json"))) {
  const { traceEvents } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const main = traceEvents.find((e) => e.name === "thread_name" && e.args.name === "CrRendererMain");
  const phases = new Map();
  for (const e of traceEvents) {
    if (e.pid !== main?.pid || e.tid !== main?.tid || e.ph !== "X") continue;
    phases.set(e.name, (phases.get(e.name) ?? 0) + e.dur / 1000);
  }
  fs.writeFileSync(
    path.join(dir, file.replace(".trace.json", ".phase-summary.json")),
    JSON.stringify(Object.fromEntries([...phases].sort((a, b) => b[1] - a[1])), null, 2),
  );
}
