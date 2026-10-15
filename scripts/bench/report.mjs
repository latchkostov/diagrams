// The human summary of a benchmark run (docs/BENCHMARKS.md § Output): environment, gates, then every metric as a
// table per suite, workloads in rows and sizes in columns.
//
//   node scripts/bench/report.mjs <results.json> [summary.md]

import fs from "node:fs";
import process from "node:process";
import console from "node:console";
import { fmt, split, table } from "./lib.mjs";

const SIZES = [100, 250, 500, 1500, 5000];

export function summary(results) {
  const { meta, metrics } = results;
  const out = [];
  const env = meta.env;
  out.push(`# Benchmark results`);
  out.push("");
  out.push(
    `${meta.date} · commit \`${env.commit.slice(0, 10)}\`${env.dirty ? " (uncommitted changes)" : ""} on \`${env.branch}\` · mode **${meta.mode}**`,
  );
  out.push("");
  out.push(
    table(
      ["Environment", ""],
      [
        ["Machine", `${env.cpu}, ${env.cores} threads, ${env.memoryGB} GB, ${env.os}`],
        [
          "Runtime",
          `Node ${env.node}, Chromium ${meta.browser ?? "–"}, Playwright ${env.playwright}, Vite ${env.vite}, React ${env.react}`,
        ],
        [
          "Browser settings",
          `CPU throttle ${meta.cpuThrottle}× (main thread), 1440 × 900 at device scale factor 1, light, en-US, UTC`,
        ],
        [
          "Calibration",
          `Node ${fmt({ unit: "ms" }, meta.calibrationMs.node)}, browser ${fmt({ unit: "ms" }, meta.calibrationMs.browser)} (same-run baseline; "cu" = ms ÷ calibration)`,
        ],
        ["CI", env.ci ? `yes (${env.runner ?? "runner"})` : "no"],
      ],
    ),
  );
  out.push("");

  const gates = metrics.filter((m) => m.gate);
  const failed = gates.filter((m) => !m.gate.pass);
  out.push(`## Gates: ${gates.length - failed.length} of ${gates.length} pass`);
  out.push("");
  if (failed.length)
    out.push(
      table(
        ["Failed gate", "Value", "Limit", "Why"],
        failed.map((m) => [`\`${m.id}\``, fmt(m), `${m.gate.op} ${fmt(m, m.gate.limit)}`, m.gate.why ?? ""]),
      ),
      "",
    );
  out.push("<details><summary>Every gate</summary>", "");
  out.push(
    table(
      ["Gate", "Value", "Limit", ""],
      gates.map((m) => [
        `\`${m.id}\``,
        fmt(m),
        `${m.gate.op} ${fmt(m, m.gate.limit)}`,
        m.gate.pass ? "pass" : "**FAIL**",
      ]),
    ),
  );
  out.push("", "</details>", "");

  // Every suite: workload metrics pivoted by size; the rest listed.
  const suites = [...new Set(metrics.map((m) => m.suite))];
  for (const suite of suites) {
    const ms = metrics.filter((m) => m.suite === suite && !m.gate);
    if (!ms.length) continue;
    out.push(`## ${suite}`, "");
    const sized = ms.filter((m) => m.workload);
    const rows = new Map();
    for (const m of sized) {
      const { base, family, n } = split(m);
      const key = `${base}|${family}`;
      if (!rows.has(key)) rows.set(key, { base, family, cells: {}, m });
      rows.get(key).cells[n] = m;
    }
    const sizes = SIZES.filter((n) => [...rows.values()].some((r) => r.cells[n]));
    const other = [...new Set(sized.map((m) => m.workload.n))].filter((n) => !SIZES.includes(n)).sort((a, b) => a - b);
    const columns = [...sizes, ...other];
    if (rows.size)
      out.push(
        table(
          ["Metric", "Workload", ...columns.map((n) => `${n}`)],
          [...rows.values()].map((r) => [
            `\`${r.base.slice(suite.length + 1)}\``,
            r.family,
            ...columns.map((n) => {
              const m = r.cells[n];
              if (!m) return "";
              const p90 = m.stats && m.stats.n > 2 ? ` <sub>p90 ${fmt(m, m.stats.p90)}</sub>` : "";
              return `${fmt(m)}${p90}`;
            }),
          ]),
        ),
        "",
      );
    const flat = ms.filter((m) => !m.workload);
    if (flat.length)
      out.push(
        table(
          ["Metric", "Value", "Note"],
          flat.map((m) => [`\`${m.id.slice(suite.length + 1)}\``, fmt(m), m.note ?? ""]),
        ),
        "",
      );
  }
  out.push(
    "Times are medians (p90 beside them when there were more than two samples). Report-only: compare them as a trend",
    "(`pnpm bench:compare`), normalised by the calibration. Gates are counts, ratios and sizes.",
  );
  return out.join("\n") + "\n";
}

if (process.argv[1] && process.argv[1].endsWith("report.mjs")) {
  const [file, md] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node scripts/bench/report.mjs <results.json> [summary.md]");
    process.exit(2);
  }
  const text = summary(JSON.parse(fs.readFileSync(file, "utf8")));
  if (md) fs.writeFileSync(md, text);
  else console.log(text);
}
