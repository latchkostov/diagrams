#!/usr/bin/env node
// Collaboration's Nightly network smoke, as the Nightly summary and its trend (collaboration plan §4.2, E6).
//
//   node scripts/collab-smoke.mjs ensure <result.json>
//       Writes a failed night's result there if the smoke left none (it didn't get that far), so every night that
//       ran uploads one.
//   node scripts/collab-smoke.mjs summary <result.json>
//       The night's table (Markdown, for $GITHUB_STEP_SUMMARY).
//   node scripts/collab-smoke.mjs trend <result.json> <previous-dir>
//       The last nights, newest first, and the streak of failed nights. <previous-dir> holds earlier scheduled
//       runs' results, one folder per run (named by run id, newer runs larger; runs from before the smoke existed
//       have none and are left out). Writes `streak=<n>` to $GITHUB_OUTPUT when set. A folder without a result
//       counts as failed.
//
// Report-only: neither command ever fails because the smoke did. Three failed nights in a row open (or comment on)
// the Nightly failure issue (nightly.yml); fewer are only in the summary.
import { existsSync, readdirSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

/** Nights in a row that open the issue (the owner's decision). */
export const ALERT_AFTER = 3;

const CLASS_TEXT = {
  "tracker-unreachable": "Trackers unreachable (public network)",
  "ice-nat": "Found but couldn't connect (ICE/NAT)",
  "app-error": "App error (a bug: see the trace)",
};

/**
 * Why a night failed, from what each side's room said, whether the peers ever connected and what the trackers did.
 * A failure after the peers connected (the room's document never arrived, say) is the app's, not the network's.
 */
export function classify(r) {
  if (r.errors?.length || r.stage !== "connect") return "app-error";
  const states = [r.connectivity?.creator, r.connectivity?.joiner];
  if (r.peerConnected || states.includes("connected")) return "app-error";
  if (states.some((s) => s === "ice-failed" || s === "no-answer")) return "ice-nat";
  const answered = Object.values(r.trackers ?? {}).some((t) => t.framesReceived > 0);
  if (!answered || states.includes("trackers-unreachable")) return "tracker-unreachable";
  // Trackers answered but no peer ever connected: matchmaking found no one, or the connection never formed.
  return "ice-nat";
}

/** How long from starting `act` (an edit) until `until` (the other side shows it) passes, in ms. */
export async function timeFrom(act, until) {
  const start = Date.now();
  await act();
  await until();
  return Date.now() - start;
}

/** Reads a result file; a missing or unreadable one is a failed night with no detail. */
export function readResult(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, stage: "missing", class: "app-error", message: "No result: the smoke didn't get that far." };
  }
}

const ms = (n) => (typeof n !== "number" ? "–" : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

/** One night as table rows (Markdown). */
export function summary(r) {
  const rows = [
    ["Result", r.ok ? "✅ passed" : `❌ ${CLASS_TEXT[r.class] ?? "failed"}`],
    ["Stage reached", r.stage],
    ["Time to connect", ms(r.connectMs)],
    ["Sync creator → joiner", ms(r.syncMs?.creatorToJoiner)],
    ["Sync joiner → creator", ms(r.syncMs?.joinerToCreator)],
    ["Peers connected", r.peerConnected === undefined ? "–" : r.peerConnected ? "yes" : "no"],
    ["Candidate pair", r.pair ? `${r.pair.local}/${r.pair.protocol} → ${r.pair.remote}` : "–"],
    [
      "Trackers (sockets, frames received)",
      Object.entries(r.trackers ?? {})
        .map(([host, t]) => `${host} (${t.opened}, ${t.framesReceived})`)
        .join(", ") || "–",
    ],
    ["Room connectivity", `creator ${r.connectivity?.creator ?? "–"}, joiner ${r.connectivity?.joiner ?? "–"}`],
  ];
  if (r.message) rows.push(["Failure", r.message.replace(/\|/g, "\\|")]);
  if (r.errors?.length) rows.push(["Page errors", r.errors.join("; ").replace(/\|/g, "\\|")]);
  return [
    "### Collaboration network smoke (report-only)",
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
  ].join("\n");
}

/** Failed nights in a row, newest first (the current night included). */
export function streak(results) {
  let n = 0;
  for (const r of results) {
    if (r.ok) break;
    n++;
  }
  return n;
}

/** Earlier nights' results, newest first: one folder per run id, holding result.json (or nothing). */
export function previous(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a))
    .map((name) => {
      const found = [join(dir, name, "result.json"), join(dir, name, "collab-smoke", "result.json")].find((p) =>
        existsSync(p),
      );
      return found ? readResult(found) : readResult(join(dir, name, "missing.json"));
    });
}

/** The trend table: the last nights, newest first. */
export function trend(nights) {
  const n = streak(nights);
  return [
    "#### Last nights (newest first)",
    "",
    "| Night | Result | Connect | Pair |",
    "| --- | --- | --- | --- |",
    ...nights
      .slice(0, 7)
      .map(
        (r, i) =>
          `| ${i === 0 ? "this run" : `-${i}`} | ${r.ok ? "passed" : (CLASS_TEXT[r.class] ?? "failed")} | ${ms(r.connectMs)} | ${r.pair ? `${r.pair.local}→${r.pair.remote}` : "–"} |`,
      ),
    "",
    n >= ALERT_AFTER
      ? `**${n} failed nights in a row**: the Nightly failure issue is opened or updated.`
      : `${n} failed night${n === 1 ? "" : "s"} in a row (the issue opens at ${ALERT_AFTER}).`,
    "",
  ].join("\n");
}

/** Leaves a result at `path`: the smoke's own, or a failed night's when it left none. */
export function ensure(path) {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(readResult(path), null, 2));
}

function main([command, file, dir]) {
  if (command === "ensure") return ensure(file);
  if (command === "summary") return console.log(summary(readResult(file)));
  if (command === "trend") {
    const nights = [readResult(file), ...previous(dir ?? "previous")];
    console.log(trend(nights));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `streak=${streak(nights)}\n`);
    return;
  }
  console.error("usage: collab-smoke.mjs ensure|summary <result.json> | trend <result.json> <previous-dir>");
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
