// node scripts/bench/engine-profile-summary.mjs <profile.cpuprofile> [...]
// Report-only self/inclusive sampling time; never adds nested inclusive shares together.
import { readFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";

for (const file of process.argv.slice(2)) {
  const profile = JSON.parse(readFileSync(file, "utf8"));
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const id of node.children ?? []) parents.set(id, node.id);
  const self = new Map();
  const inclusive = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    // Attribute the interval up to the next sample to the currently sampled frame.
    const ms = (profile.timeDeltas[i + 1] ?? profile.timeDeltas[i] ?? 0) / 1000;
    total += ms;
    const frame = nodes.get(id).callFrame;
    const name = `${frame.functionName || "(anonymous)"} (${frame.url.split("/").at(-1) || "native"})`;
    self.set(name, (self.get(name) ?? 0) + ms);
    const names = new Set();
    for (let at = id; at !== undefined; at = parents.get(at)) names.add(nodes.get(at).callFrame.functionName);
    for (const name of names) inclusive.set(name, (inclusive.get(name) ?? 0) + ms);
  }
  console.log(file, `${total.toFixed(1)} ms sampled`);
  for (const [name, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(`self ${((100 * ms) / total).toFixed(2)}% ${name}`);
  for (const name of ["structuredClone", "cloneGraph", "captureCheckpoint", "restore", "checkpoint", "tick"])
    console.log(`inclusive ${((100 * (inclusive.get(name) ?? 0)) / total).toFixed(2)}% ${name}`);
}
