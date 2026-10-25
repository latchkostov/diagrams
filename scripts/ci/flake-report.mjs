// Read-only CI evidence. Cache the snapshot to reproduce the Markdown without GitHub/network access.
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const exec = promisify(execFile);
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const shardName = /^E2E (\d+)\/(\d+)$/;

export function failedTests(log) {
  const tests = new Map();
  let current;
  let summary;
  const finish = () => {
    if (current && !current.excluded) {
      const { id, project, file, title } = current;
      tests.set(id, { id, project, file, title });
    }
    current = undefined;
  };
  // Actions repeats failures in annotations, the detailed error and the final list.
  for (const line of stripVTControlCharacters(log).split(/\r?\n/)) {
    const message = line
      .replace(/^\d{4}-\d{2}-\d{2}T\S+Z\s*/, "")
      .replace(/^##\[(?:error|notice)\]\s*/, "")
      .trim();
    const status = message.match(/^\d+ (failed|interrupted|cancelled|canceled|flaky|passed|skipped|did not run)\b/);
    if (status) {
      finish();
      summary = status[1];
      continue;
    }
    // Interrupted tests have the same detailed header as failures, even without a final summary.
    if (current && /^Test was (?:interrupted|cancelled|canceled)\.$/.test(message)) current.excluded = true;
    // A line reporter's [i/n] progress is not a failure, including in cancelled jobs.
    const match = message.match(/^(?:\d+\)\s*)?\[([^\]]+)\] › (tests\/e2e\/\S+?):\d+:\d+ › (.+?)\s*$/);
    if (!match) continue;
    finish();
    if (/^\d+\)/.test(message)) summary = undefined;
    const [, project, file, rawTitle] = match;
    const title = rawTitle.replace(/\s+─+$/, "");
    const id = `[${project}] ${file} › ${title}`;
    current = { id, project, file, title, excluded: summary !== undefined && summary !== "failed" };
  }
  finish();
  return [...tests.values()].sort((a, b) => order(a.id, b.id));
}

export function renderReport(snapshot) {
  const { runs, jobs, logs, budgetSeconds } = snapshot;
  const failures = new Map();
  const missing = [];
  for (const job of jobs) {
    if (!shardName.test(job.name) || !["failure", "cancelled", "timed_out"].includes(job.conclusion)) continue;
    const tests = failedTests(logs[job.id] ?? "");
    if (!tests.length && ["failure", "timed_out"].includes(job.conclusion)) missing.push(job);
    const run = runs.find((r) => r.databaseId === job.runId);
    for (const test of tests) {
      const entry = failures.get(test.id) ?? { ...test, occurrences: [] };
      const passed = jobs.some((later) => {
        const next = runs.find((r) => r.databaseId === later.runId);
        return (
          next.headSha === run.headSha &&
          later.name === job.name &&
          later.conclusion === "success" &&
          Date.parse(later.started_at) >= Date.parse(job.completed_at)
        );
      });
      entry.occurrences.push({ job, run, passed });
      failures.set(test.id, entry);
    }
  }
  const ranked = [...failures.values()].sort(
    (a, b) => b.occurrences.length - a.occurrences.length || order(a.id, b.id),
  );
  const unique = (values) => [...new Set(values)].sort(order).join(", ");
  const link = (job) =>
    `[${job.runId}/${job.attempt}](https://github.com/${snapshot.repo}/actions/runs/${job.runId}/job/${job.id})`;
  const shards = [...new Set(jobs.filter((j) => shardName.test(j.name)).map((j) => j.name))].sort(order);
  const times = shards.map((name) => {
    const samples = jobs.filter(
      (j) => j.name === name && ["success", "failure", "timed_out"].includes(j.conclusion) && j.completed_at,
    );
    const seconds = samples.map((j) => (Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000);
    return { name, seconds, mean: seconds.length ? seconds.reduce((a, b) => a + b, 0) / seconds.length : 0 };
  });
  const measured = times.filter((t) => t.seconds.length);
  const mean = measured.reduce((sum, t) => sum + t.mean, 0) / measured.length;
  const latest = runs
    .flatMap((run) =>
      Array.from({ length: run.attempt }, (_, i) => ({
        run,
        attempt: run.attempt - i,
        shards: jobs.filter(
          (j) => j.runId === run.databaseId && j.attempt === run.attempt - i && shardName.test(j.name),
        ),
      })),
    )
    .find(
      ({ shards }) =>
        shards.length > 0 &&
        shards.length === Number(shards[0].name.match(shardName)[2]) &&
        shards.every((j) => j.conclusion === "success"),
    );
  const latestTimes =
    latest?.shards
      .map((j) => ({
        job: j,
        seconds: (Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000,
      }))
      .sort((a, b) => order(a.job.name, b.job.name)) ?? [];
  const latestMean = latestTimes.reduce((sum, t) => sum + t.seconds, 0) / latestTimes.length;
  const lines = [
    `## CI flake evidence (${runs.length}-run snapshot)`,
    "",
    `Repository: ${snapshot.repo}. Workflow: CI. Runs: ${runs.length}, all branches, newest first. Snapshot ends at ${runs[0].createdAt} (run ${runs[0].databaseId}).`,
    "",
    "Counts are distinct failing test/job attempts, deduplicating repeated Actions log annotations. Test IDs use project, spec and full title; source line numbers are deliberately excluded. Earlier attempts of rerun workflows are included, as are failures logged before a job was cancelled. Interrupted/cancelled tests do not count as failures. A later successful shard on the identical SHA is passing-rerun evidence; it is not evidence that the cause was fixed. No later passing shard means **unconfirmed**, not a persistent failure. Cancelled/in-progress jobs are excluded from wall-time samples. Infrastructure failures without a test ID are listed separately.",
    "",
    "| Test ID | Failures | Distinct branches | Passed same SHA (failures confirmed) | Shards | Evidence (run/attempt) |",
    "| --- | ---: | --- | ---: | --- | --- |",
    ...ranked.map(
      (t) =>
        `| ${t.id.replaceAll("|", "\\|")} | ${t.occurrences.length} | ${unique(t.occurrences.map((o) => o.run.headBranch))} | ${t.occurrences.filter((o) => o.passed).length}/${t.occurrences.length} | ${unique(t.occurrences.map((o) => o.job.name))} | ${unique(t.occurrences.map((o) => link(o.job)))} |`,
    ),
    "",
    "## Shard wall time",
    "",
    `Completed shard jobs include setup, downloads and uploads, excluding queue time. Budget: ${budgetSeconds / 60} minutes (current workflow job timeout, not the test timeout). Historical runs can use older infrastructure. Means combine completed attempts; compare a complete recent run before refreshing the duration map.`,
    "",
    "| Shard | Samples | Mean seconds | Max seconds | Mean / budget | Mean / shard mean |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...times.map(
      (t) =>
        `| ${t.name} | ${t.seconds.length} | ${t.mean.toFixed(1)} | ${t.seconds.length ? Math.max(...t.seconds).toFixed(1) : "—"} | ${((100 * t.mean) / budgetSeconds).toFixed(1)}% | ${mean ? ((100 * t.mean) / mean).toFixed(1) : "0.0"}% |`,
    ),
    "",
    `Over 125% of the shard mean: ${
      measured
        .filter((t) => t.mean > mean * 1.25)
        .map((t) => t.name)
        .join(", ") || "none"
    }.`,
    "",
    "## Latest complete successful shard set",
    "",
    latest
      ? `Run ${latest.run.databaseId}, attempt ${latest.attempt}, SHA ${latest.run.headSha}. This same-attempt comparison avoids averaging different infrastructure revisions or mixing partial reruns.`
      : "No complete successful shard set in this snapshot.",
    "",
    "| Shard | Seconds | Budget used | Relative to mean |",
    "| --- | ---: | ---: | ---: |",
    ...latestTimes.map(
      (t) =>
        `| ${t.job.name} | ${t.seconds} | ${((100 * t.seconds) / budgetSeconds).toFixed(1)}% | ${((100 * t.seconds) / latestMean).toFixed(1)}% |`,
    ),
    "",
    `Over 125% of this run's mean: ${
      latestTimes
        .filter((t) => t.seconds > latestMean * 1.25)
        .map((t) => t.job.name)
        .join(", ") || "none"
    }.`,
    "",
    "## Collection coverage",
    "",
    `Run conclusions: ${unique(runs.map((r) => `${r.conclusion || r.status}: ${runs.filter((other) => (other.conclusion || other.status) === (r.conclusion || r.status)).length}`))}.`,
    "",
    ...missing.map(
      (j) =>
        `- Failed shard without a parsed test ID: ${j.name}, ${link(j)}. Inspect its log for infrastructure interruption.`,
    ),
    ...snapshot.unavailable.map((message) => `- Unavailable evidence: ${message}.`),
    "",
    "## Runs in the snapshot",
    "",
    "| Run | SHA | Branch | Conclusion at collection | Attempts |",
    "| --- | --- | --- | --- | ---: |",
    ...runs.map(
      (r) =>
        `| [${r.databaseId}](https://github.com/${snapshot.repo}/actions/runs/${r.databaseId}) | ${r.headSha} | ${r.headBranch} | ${r.conclusion || r.status} | ${r.attempt} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

async function collect(repo, cache, budgetSeconds) {
  await mkdir(cache, { recursive: true });
  const unavailable = [];
  const gh = async (args) => (await exec("gh", args, { maxBuffer: 32 * 1024 * 1024 })).stdout;
  const cached = async (file, get) => {
    const path = join(cache, file);
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const value = await get();
    await writeFile(path, value);
    return value;
  };
  const runs = JSON.parse(
    await cached("runs.json", () =>
      gh([
        "run",
        "list",
        "--repo",
        repo,
        "--workflow",
        "CI",
        "--limit",
        "60",
        "--json",
        "databaseId,headBranch,headSha,conclusion,attempt,createdAt,status",
      ]),
    ),
  );
  const jobs = [];
  const logs = {};
  // Four concurrent runs, bounded independently of the host's CPU count.
  let index = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < runs.length) {
        const run = runs[index++];
        for (let attempt = 1; attempt <= run.attempt; attempt++) {
          const response = JSON.parse(
            await cached(`jobs-${run.databaseId}-${attempt}.json`, () =>
              gh(["api", `repos/${repo}/actions/runs/${run.databaseId}/attempts/${attempt}/jobs?per_page=100`]),
            ),
          );
          if (response.total_count > response.jobs.length)
            throw new Error("Jobs response truncated; add pagination before trusting this report");
          for (const job of response.jobs.filter((j) => shardName.test(j.name))) {
            jobs.push({ ...job, runId: run.databaseId, attempt });
            if (!["failure", "cancelled", "timed_out"].includes(job.conclusion)) continue;
            try {
              logs[job.id] = await cached(`log-${job.id}.txt`, () =>
                gh(["api", "--allow-escape-sequences", `repos/${repo}/actions/jobs/${job.id}/logs`]),
              );
            } catch (error) {
              unavailable.push(`job ${job.id} log (${error.code ?? "download failed"})`);
            }
          }
        }
        console.error(`flake-report: collected ${run.databaseId}`);
      }
    }),
  );
  jobs.sort((a, b) => a.runId - b.runId || a.attempt - b.attempt || a.id - b.id);
  unavailable.sort(order);
  return { repo, runs, jobs, logs, budgetSeconds, unavailable };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const cache = value("--cache", "tests/.output/flake-report");
  const repo = value("--repo", "latchkostov/diagrams");
  const budgetSeconds = Number(value("--budget-minutes", "22")) * 60;
  if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0) throw new Error("Budget must be positive minutes");
  const snapshotPath = join(cache, "snapshot.json");
  const snapshot = args.includes("--offline")
    ? JSON.parse(await readFile(snapshotPath, "utf8"))
    : await collect(repo, cache, budgetSeconds);
  if (!args.includes("--offline")) await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  const { format } = await import("prettier");
  const report = await format(renderReport(snapshot), { parser: "markdown", printWidth: 120 });
  const output = value("--output", undefined);
  if (output) await writeFile(output, report);
  else process.stdout.write(report);
}
