// Compare two CI runs without hiding build/queue time behind shorter shard jobs.
// gh api repos/latchkostov/diagrams/actions/runs/<id>/jobs > tests/.output/<label>-jobs.json
// node scripts/ci/e2e-timings.mjs tests/.output/{before,after}-jobs.json
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const timestamp = (job, field) => {
  const value = Date.parse(job[field]);
  if (!Number.isFinite(value)) throw new Error(`Missing ${field}: ${job.name}`);
  return value;
};

export function ciTimings({ jobs }) {
  const shards = Array.from({ length: 6 }, (_, i) => {
    const name = `E2E ${i + 1}/6`;
    const job = jobs.find((job) => job.name === name);
    if (!job || job.status !== "completed" || job.conclusion !== "success")
      throw new Error(`Need six successful, completed shards: ${name}`);
    return job;
  });
  const changes = jobs.find((job) => job.name === "Detect changes");
  if (!changes) throw new Error("Missing Detect changes job");
  const end = Math.max(...shards.map((job) => timestamp(job, "completed_at")));
  const gate = jobs.find((job) => job.name === "CI");
  if (!gate || gate.conclusion !== "success") throw new Error("Need a successful CI gate");
  return [
    ...shards.map((job) => ({
      name: job.name,
      seconds: (timestamp(job, "completed_at") - timestamp(job, "started_at")) / 1000,
    })),
    {
      name: "E2E critical path (after change detection, including build and queue)",
      seconds: (end - timestamp(changes, "completed_at")) / 1000,
    },
    {
      name: "CI critical path (first job start to CI gate completion)",
      seconds: (timestamp(gate, "completed_at") - Math.min(...jobs.map((job) => timestamp(job, "started_at")))) / 1000,
    },
  ];
}

export function compareTimings(before, after) {
  const baseline = ciTimings(before);
  const current = ciTimings(after);
  const duration = (seconds) => `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return [
    "| Job / path | Before | After | Change |",
    "| --- | ---: | ---: | ---: |",
    ...baseline.map(({ name, seconds }, i) => {
      const next = current[i].seconds;
      const delta = seconds ? `${((next / seconds - 1) * 100).toFixed(1)}%` : "—";
      return `| ${name} | ${duration(seconds)} | ${duration(next)} | ${delta} |`;
    }),
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, after] = process.argv.slice(2);
  if (!before || !after) throw new Error("Usage: e2e-timings.mjs <before-jobs.json> <after-jobs.json>");
  console.log(compareTimings(JSON.parse(readFileSync(before, "utf8")), JSON.parse(readFileSync(after, "utf8"))));
}
