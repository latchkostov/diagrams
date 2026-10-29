import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

/** Raw same-job survey observations: no calibration or selection of individual fast samples. */
export function compareSurvey(base, head) {
  const sample = (rows, metric) => {
    const values = rows.filter((row) => !row.traced && row.metric === metric).map((row) => row.data.wall);
    if (values.length < 3 || values.some((value) => !Number.isFinite(value) || value <= 0))
      throw new Error(`${metric}: need at least three finite positive unprofiled observations per revision`);
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return {
      n: values.length,
      median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      min: values[0],
      max: values.at(-1),
    };
  };
  const fmt = (s) => `${s.median.toFixed(0)} (${s.min.toFixed(0)}–${s.max.toFixed(0)})`;
  const lines = [
    "## Bulk geometry survey comparison",
    "",
    "Raw action wall time in ms: median (observed range). Layout includes its one-second quiet observation.",
    "",
    "| Action | Parts | Base | Head | Change | Samples base/head |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const size of [500, 1500])
    for (const [metric, label] of [
      ["layout", "Auto-layout"],
      ["paste50", "Paste 50"],
    ]) {
      const b = sample(base, `${metric}-${size}`),
        h = sample(head, `${metric}-${size}`);
      const change = (h.median / b.median - 1) * 100;
      lines.push(`| ${label} | ${size} | ${fmt(b)} | ${fmt(h)} | ${change.toFixed(1)}% | ${b.n}/${h.n} |`);
    }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = (path) => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
  console.log(compareSurvey(rows(process.argv[2]), rows(process.argv[3])));
}
