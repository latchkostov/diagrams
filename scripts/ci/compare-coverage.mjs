import { readFileSync } from "node:fs";
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const metrics = ["statements", "branches", "functions", "lines"];
const canonical = (summary) =>
  Object.fromEntries(
    Object.entries(summary).map(([file, value]) => [file.replaceAll("\\", "/").replace(/^.*\/src\//, "src/"), value]),
  );

/** Compare totals and every file's covered/total counts; percentages alone can hide a missing shard. */
export function compareCoverage(merged, reference) {
  const a = canonical(merged),
    b = canonical(reference);
  const differences = [];
  for (const file of new Set([...Object.keys(a), ...Object.keys(b)]))
    for (const metric of metrics)
      for (const key of ["total", "covered", "skipped", "pct"])
        if (a[file]?.[metric]?.[key] !== b[file]?.[metric]?.[key])
          differences.push(`${file} ${metric}.${key}: ${a[file]?.[metric]?.[key]} != ${b[file]?.[metric]?.[key]}`);
  return differences;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const read = (file) => JSON.parse(readFileSync(file, "utf8"));
    const merged = read(process.argv[2]),
      reference = read(process.argv[3]);
    const differences = compareCoverage(merged, reference);
    if (differences.length) {
      console.error(differences.join("\n"));
      process.exitCode = 1;
    } else
      console.log(
        `COVERAGE-EQUAL ${metrics.map((metric) => `${metric}=${merged.total[metric].covered}/${merged.total[metric].total} (${merged.total[metric].pct}%)`).join(" ")}`,
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
