// The golden store, shared by the Node tier (Vitest) and the browser tier (Playwright): compare an output with
// its golden file, and on a difference throw an error with a readable diff. `PARITY_UPDATE=1` writes the golden
// instead (refused on CI). Every comparison is written to a ledger that scripts/parity.mjs reads for the summary
// and for stale goldens. docs/PARITY.md.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { threadId } from "node:worker_threads";
import { jsonDiff, textDiff } from "./diff";
import { stable } from "./stable";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const GOLDENS = join(ROOT, "tests/parity/goldens");
export const OUTPUT = join(ROOT, "tests/.output/parity");

export const UPDATE = process.env.PARITY_UPDATE === "1";
if (UPDATE && process.env.CI)
  throw new Error("PARITY_UPDATE is refused on CI: goldens are updated on purpose, locally.");

/** "node" or "browser": goldens live under goldens/<tier>/. Set by each tier's config. */
function tier(): string {
  const value = process.env.PARITY_TIER;
  if (value !== "node" && value !== "browser") throw new Error("PARITY_TIER must be node or browser");
  return value;
}

type Status = "same" | "changed" | "added" | "missing";

interface LedgerEntry {
  name: string;
  status: Status;
  total?: number;
  lines?: string[];
}

const seen = new Set<string>();

function record(entry: LedgerEntry): void {
  const dir = join(OUTPUT, "ledger");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${tier()}-${process.pid}-${threadId}.jsonl`), JSON.stringify(entry) + "\n");
}

function write(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/** Files are named by the caller ("sim/kafka-order-pipeline/black-friday.json"); keep them portable. */
function check(name: string): string {
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(name) || name.includes("..") || name.includes("//"))
    throw new Error(`Golden name "${name}" must be lower-case letters, digits, ".", "_", "-" and "/"`);
  const full = `${tier()}/${name}`;
  if (seen.has(full)) throw new Error(`Golden "${full}" was recorded twice in one run`);
  seen.add(full);
  return full;
}

export class ParityMismatch extends Error {
  override name = "ParityMismatch";
}

/**
 * Mismatches are collected, not thrown where they're found, so a test reports every golden it changed (a change to
 * the checks shows in the findings, their words and the agent report at once). Each tier calls assertGoldens() after
 * every test (tests/parity/node/setup.ts, tests/parity/browser/fixtures.ts), and scripts/parity.mjs also fails on any
 * mismatch in the ledger, so none can go unreported.
 */
const failures: string[] = [];

/** Throws every mismatch recorded since the last call, as one error. */
export function assertGoldens(): void {
  if (!failures.length) return;
  throw new ParityMismatch(failures.splice(0).join("\n\n"));
}

type Diff = { lines: string[]; total: number } | undefined;

interface Pending {
  full: string;
  file: string;
  golden: Buffer | undefined;
}

/** The comparison's first half: the golden, if there is one. A comparison may run in between (in a browser). */
function begin(name: string): Pending {
  const full = check(name);
  const file = join(GOLDENS, full);
  return { full, file, golden: existsSync(file) ? readFileSync(file) : undefined };
}

/** The second half: record the outcome; write the golden (update) or keep the readable diff for assertGoldens. */
function finish({ full, file, golden }: Pending, actual: string | Buffer, diff: Diff): void {
  const rerun = "If the change is intended, run `pnpm parity:update` and commit the goldens with it.";
  if (golden) {
    if (!diff) return record({ name: full, status: "same" });
    if (UPDATE) {
      write(file, actual);
      return record({ name: full, status: "changed", total: diff.total, lines: diff.lines.slice(0, 3) });
    }
    const actualFile = join(OUTPUT, "actual", full);
    write(actualFile, actual);
    write(join(OUTPUT, "diffs", `${full}.txt`), diff.lines.join("\n") + "\n");
    record({ name: full, status: "changed", total: diff.total, lines: diff.lines });
    const count = `${diff.total} difference${diff.total === 1 ? "" : "s"}`;
    failures.push(
      [
        `Output changed: tests/parity/goldens/${full} (${count})`,
        ...diff.lines.map((l) => `  ${l}`),
        `Actual output: ${actualFile}`,
        rerun,
      ].join("\n"),
    );
    return;
  }
  if (UPDATE) {
    write(file, actual);
    return record({ name: full, status: "added" });
  }
  write(join(OUTPUT, "actual", full), actual);
  record({ name: full, status: "missing" });
  failures.push(`No golden for tests/parity/goldens/${full}: run \`pnpm parity:update\` to record it.`);
}

function compare(name: string, actual: string | Buffer, differ: (golden: Buffer) => Diff): void {
  const at = begin(name);
  finish(at, actual, at.golden && differ(at.golden));
}

/** Data, recorded with the stable printer (`<name>` ends in .json). */
export function expectGolden(name: string, value: unknown): void {
  if (!name.endsWith(".json")) throw new Error(`Data goldens end in .json: ${name}`);
  const text = stable(value);
  compare(name, text, (golden) => {
    const before = golden.toString("utf8");
    if (before === text) return undefined;
    const diff = jsonDiff(JSON.parse(before), JSON.parse(text));
    // Same data, different text (the printer changed, or a hand edit): show the text.
    return diff.total ? diff : textDiff(before, text);
  });
}

/** Text that is an output already (an export, a report): compared byte for byte, shown as a line diff. */
export function expectGoldenText(name: string, text: string): void {
  compare(name, text, (golden) => {
    const before = golden.toString("utf8");
    return before === text ? undefined : textDiff(before, text);
  });
}

/**
 * A binary golden with its own comparison, which may be asynchronous (an image compared in the browser): `differs`
 * resolves to undefined when the actual output matches the golden within its tolerance, or to the lines that say
 * how it doesn't. Within tolerance, the golden is kept as it is, even when updating (no churn).
 */
export async function expectGoldenBinary(
  name: string,
  data: Buffer,
  differs: (golden: Buffer) => Promise<string[] | undefined>,
): Promise<void> {
  const at = begin(name);
  const lines = at.golden && (await differs(at.golden));
  finish(at, data, lines ? { lines, total: 1 } : undefined);
}
