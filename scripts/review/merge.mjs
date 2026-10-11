// Merges per-angle JSON findings into one REPORT.md, sorted by severity then confidence.
import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import path from "node:path";

const dir = process.argv[2];
const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
const conf = { high: 0, medium: 1, low: 2 };
const all = [];
const summaries = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const angle = path.basename(f, ".json");
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    summaries.push(`- **${angle}**: ${r.summary}`);
    for (const x of r.findings) all.push({ angle, ...x });
  } catch {
    summaries.push(`- **${angle}**: (no valid report — see ${angle}.log)`);
  }
}
all.sort((a, b) => rank[a.severity] - rank[b.severity] || conf[a.confidence] - conf[b.confidence]);
const counts = Object.keys(rank)
  .map((s) => `${s}: ${all.filter((x) => x.severity === s).length}`)
  .join(" · ");
const lines = [`# Review ${path.basename(dir)}`, "", counts, "", "## Summaries", ...summaries, "", "## Findings"];
for (const x of all) {
  lines.push(
    `### [${x.severity}/${x.confidence}] ${x.title}  _(${x.angle})_`,
    `\`${x.file}:${x.line}\``,
    "",
    x.detail,
    "",
    `**Fix:** ${x.suggestion}`,
    "",
  );
}
fs.writeFileSync(path.join(dir, "REPORT.md"), lines.join("\n"));
console.log(counts);
