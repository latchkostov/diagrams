import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { changedLines, git, reviewScope } from "../../scripts/review/scope.mjs";
import { consolidate, renderReport } from "../../scripts/review/triage.mjs";
import { ANGLES, nextState, roundPlan } from "../../scripts/review/rounds.mjs";
import { readState, replaceState } from "../../scripts/review/state.mjs";
import type { Plan, State } from "../../scripts/review/triage.mjs";
import { options, plan as gatePlan } from "../../scripts/gate/logic.mjs";
import { acquireLock } from "../../scripts/gate/host.mjs";

let root: string;
let reviewed: string;
let masterOnly: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "review-loop-"));
  git(root, "init", "--initial-branch=master");
  git(root, "config", "user.name", "Review fixture");
  git(root, "config", "user.email", "fixture@example.test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.autocrlf", "false");
  writeFileSync(join(root, "shared.txt"), "original\nunchanged\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "switch", "-c", "feature");
  writeFileSync(join(root, "shared.txt"), "feature\nunchanged\n");
  writeFileSync(join(root, "feature.txt"), "feature\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "feature");
  reviewed = git(root, "rev-parse", "HEAD").trim();
  git(root, "switch", "master");
  writeFileSync(join(root, "shared.txt"), "master\nunchanged\n");
  writeFileSync(join(root, "master-only.txt"), "must not review\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "master only");
  masterOnly = git(root, "rev-parse", "HEAD").trim();
  git(root, "update-ref", "refs/remotes/origin/master", "HEAD");
  git(root, "switch", "feature");
  expect(() => git(root, "merge", "master", "--no-commit")).toThrow();
  writeFileSync(join(root, "shared.txt"), "resolved feature\nunchanged\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "resolve merge");
  writeFileSync(join(root, "feature.txt"), "fixed feature\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "fix");
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("review scope", () => {
  it("starts at the merge base with a three-dot PR diff", () => {
    const scope = reviewScope(root);
    expect(scope.range).toBe(`${masterOnly}...${scope.head}`);
    expect(scope.files).toEqual(["feature.txt", "shared.txt"]);
    expect(scope.patch).not.toContain("must not review");
  });
  it("excludes merged master commits/files but includes conflict resolutions against first parent", () => {
    const scope = reviewScope(root, { since: reviewed });
    expect(scope.commits).not.toContain(masterOnly);
    expect(scope.commits).toHaveLength(2);
    expect(scope.files).toEqual(["feature.txt", "shared.txt"]);
    expect(scope.patch).toContain("+resolved feature");
    expect(scope.patch).not.toContain("master-only.txt");
    expect(scope.lines["shared.txt"]).toEqual([1]);
  });
  it("rejects a reviewed SHA from the merged side", () => {
    expect(() => reviewScope(root, { since: masterOnly })).toThrow("first-parent");
  });
  it("does not re-review the previous SHA", () => {
    expect(reviewScope(root, { since: "HEAD" }).files).toEqual([]);
  });
  it("relocates changed lines across later hunks without capping shifted fixes", () => {
    expect(changedLines("@@ -2,0 +3,2 @@\n+x\n+y", [2, 3, 9], false)).toEqual([2, 5, 11]);
    expect(changedLines("@@ -2,2 +2,0 @@\n-a\n-b", [2, 3, 4], false)).toEqual([2]);
    expect(changedLines("@@ -4 +4,2 @@\n-old\n+new\n+new", [4, 5])).toEqual([4, 5, 6]);
  });
});

const finding = (overrides = {}) => ({
  severity: "P1",
  confidence: "high",
  file: "feature.txt",
  line: 10,
  title: "Preserve usable consumer capacity across parallel routes",
  detail: "Normal routing loses capacity.",
  suggestion: "Preserve capacity.",
  previousId: null,
  ...overrides,
});
const lens = (
  angle: string,
  findings = [finding()],
  assessments: { id: string; status: string; detail: string }[] = [],
) => ({ angle, report: { summary: "Reviewed", findings, assessments } });
const scope = { head: "head-sha", mode: "delta", files: ["feature.txt"], lines: { "feature.txt": [10] } };
const plan = { round: 1, scope, capped: false, state: null };

describe("deterministic consolidation", () => {
  it("counts distinct issues, keeps highest severity and all contributing lenses, preserves raw JSON", () => {
    const reports = [
      lens("correctness"),
      lens("performance", [finding({ severity: "P2", line: 12 })]),
      lens("tests", [finding({ title: "Preserve consumer capacity across parallel routes", line: 11 })]),
    ];
    const before = JSON.stringify(reports);
    const result = consolidate(reports, plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("P1");
    expect(result.issues[0].lenses).toEqual(["correctness", "performance", "tests"]);
    expect(result.rawCount).toBe(3);
    expect(JSON.stringify(reports)).toBe(before);
    expect(renderReport("fixture", plan, result, reports)).toContain("P1: 1");
  });
  it("does not merge unrelated titles, distant locations or different files", () => {
    const reports = [
      lens("correctness", [
        finding(),
        finding({ title: "Undo deletes unrelated nodes" }),
        finding({ line: 40 }),
        finding({ file: "other.txt" }),
      ]),
    ];
    expect(
      consolidate(reports, { ...plan, scope: { ...scope, files: ["feature.txt", "other.txt"] } }).issues,
    ).toHaveLength(4);
  });
  it("clusters different titles at the same file and line across lenses", () => {
    const reports = [lens("correctness"), lens("types", [finding({ title: "Stop replay after a deleted owner" })])];
    const result = consolidate(reports, plan);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].lenses).toEqual(["correctness", "types"]);
    expect(result.issues[0].evidence).toHaveLength(2);
  });
  it("logs unknown previous IDs and treats their findings as new without losing active assessments", () => {
    const old = { ...finding(), id: "R-active", lenses: ["correctness"] };
    const second = {
      ...plan,
      round: 2,
      state: { round: 1, lastReviewedSha: "old", openP1Ids: [old.id], openP1s: [old] },
    };
    const reports = [
      lens(
        "correctness",
        [finding({ previousId: "R-resolved", line: 40 })],
        [{ id: old.id, status: "fixed", detail: "Confirmed fixed." }],
      ),
    ];
    const result = consolidate(reports, second);
    expect(result.warnings).toEqual([
      "correctness: unknown or resolved previous issue R-resolved; treating finding as new.",
    ]);
    expect(result.issues[0]).toMatchObject({ severity: "P2", previousId: null });
    expect(result.issues[0].id).not.toBe("R-resolved");
    expect(result.resolutions[0]).toMatchObject({ id: old.id, status: "fixed" });
    expect(renderReport("fixture", second, result, reports)).toContain("unknown or resolved previous issue R-resolved");
  });
  it("caps new P1s on unchanged lines in delta rounds, but leaves changed-line P1s", () => {
    const result = consolidate([lens("correctness", [finding(), finding({ line: 40 })])], { ...plan, round: 2 });
    expect(result.issues.map((x) => x.severity)).toEqual(["P1", "P2"]);
    expect(result.issues[1].calibration).toContain("unchanged line");
  });
  it("excludes findings outside the exact file list", () => {
    const result = consolidate([lens("correctness", [finding({ file: "master-only.txt" })])], plan);
    expect(result.issues).toEqual([]);
    expect(result.excluded).toHaveLength(1);
  });
  it("rejects malformed severity names rather than treating inherited object keys as valid", () => {
    expect(() => consolidate([lens("correctness", [finding({ severity: "toString" })])], plan)).toThrow(
      "Invalid finding",
    );
  });
});

describe("round state and cap", () => {
  const issue = { ...finding(), id: "R-open", lenses: ["security"] };
  const state = { round: 1, lastReviewedSha: "old", openP1Ids: [issue.id], openP1s: [issue] };
  const delta = { ...plan, round: 2, state };
  it("selects correctness and every open P1 lens, retaining ANGLES additions", () => {
    expect(roundPlan(state).angles).toEqual(["correctness", "security"]);
    expect(roundPlan(state, { angles: "tests" }).angles).toEqual(["correctness", "security", "tests"]);
    expect(roundPlan(null, { angles: "tests" }).angles).toEqual(["tests"]);
    expect(() => roundPlan(null, { angles: "../oops" })).toThrow("ANGLES");
  });
  it("closes an old P1 only when all reviewers provide fixed evidence", () => {
    const fixed = [{ id: issue.id, status: "fixed", detail: "The fix restores capacity." }];
    const reports = [lens("correctness", [], fixed), lens("security", [], fixed)];
    const result = consolidate(reports, delta);
    expect(result.issues).toEqual([]);
    expect(result.resolutions[0].status).toBe("fixed");
    expect(nextState({ round: 2, context: "Acceptance criteria" }, scope, result.issues, "REPORT.md")).toEqual({
      round: 2,
      lastReviewedSha: "head-sha",
      openP1Ids: [],
      openP1s: [],
      report: "REPORT.md",
      context: "Acceptance criteria",
    });
  });
  it("retains an unconfirmed P1 and its ID, even if its lines were not changed", () => {
    const reports = [
      lens(
        "correctness",
        [finding({ previousId: issue.id, line: 40, severity: "P2" })],
        [{ id: issue.id, status: "open", detail: "Still broken" }],
      ),
    ];
    const result = consolidate(reports, delta);
    expect(result.issues[0]).toMatchObject({ id: issue.id, severity: "P1", lenses: ["correctness", "security"] });
  });
  it("fails incomplete reviewer assessments instead of silently closing issues", () => {
    expect(() => consolidate([lens("security", [])], delta)).toThrow("must assess");
  });
  it("keeps a P1 open when reviewers disagree, retaining both assessments", () => {
    const result = consolidate(
      [
        lens("correctness", [], [{ id: issue.id, status: "fixed", detail: "The simple route works." }]),
        lens("security", [], [{ id: issue.id, status: "open", detail: "Parallel routes still lose capacity." }]),
      ],
      delta,
    );
    expect(result.issues).toEqual([issue]);
    expect(result.resolutions[0]).toMatchObject({
      id: issue.id,
      status: "open",
      answers: [{ status: "fixed" }, { status: "open" }],
    });
    expect(nextState({ round: 2 }, scope, result.issues, "REPORT.md").openP1Ids).toEqual([issue.id]);
  });
  it("uses an explicit identity before a fuzzy match and never clusters distinct explicit identities", () => {
    const other = { ...issue, id: "R-other", line: 11 };
    const result = consolidate(
      [
        lens(
          "correctness",
          [finding({ previousId: other.id }), finding({ previousId: issue.id })],
          [issue, other].map((x) => ({ id: x.id, status: "open", detail: "Still reproducible." })),
        ),
      ],
      { ...delta, state: { ...state, openP1Ids: [issue.id, other.id], openP1s: [issue, other] } },
    );
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((x) => x.id).sort()).toEqual([issue.id, other.id].sort());
    expect(result.issues.find((x) => x.id === other.id)?.evidence).toHaveLength(1);
    expect(result.issues.find((x) => x.id === other.id)?.evidence?.[0].previousId).toBe(other.id);
  });
  it("ends round three with quarantine suggestions, blocks round four unless explicitly allowed", () => {
    const third = roundPlan({ ...state, round: 2 });
    const reports = [lens("correctness")];
    const result = consolidate(reports, plan);
    const report = renderReport("fixture", { ...third, scope }, result, reports);
    expect(report).toContain("QUARANTINE-OR-MERGE");
    expect(report).toContain("docs/backlog/");
    expect(report).not.toContain("**Fix:**");
    expect(report.trim().endsWith("--allow-round-4.")).toBe(true);
    expect(() => roundPlan({ ...state, round: 3 })).toThrow("cap reached");
    expect(roundPlan({ ...state, round: 3 }, { allowRound4: true })).toMatchObject({ round: 4, capped: false });
    expect(roundPlan(state, { full: true })).toMatchObject({ round: 1, capped: false });
  });
});

it("runs explicit reviewer unit files through the gate without related or E2E expansion", () => {
  const groups = gatePlan(options(["quick", "src/lib/reviewLoop.test.ts", "--workers", "1", "--only", "unit"]), [
    "unrelated.ts",
  ]);
  expect(groups.flat()).toEqual([
    { name: "unit", args: ["exec", "vitest", "run", "src/lib/reviewLoop.test.ts", "--allowOnly=false"], env: {} },
  ]);
  const mixed = gatePlan(options(["quick", "src/lib/reviewLoop.test.ts", "tests/e2e/viewport.spec.ts"]), []);
  expect(mixed.flat().find((x) => x.name === "e2e-1")?.args).not.toContain("src/lib/reviewLoop.test.ts");
});

it("prepares intent and assessments and commits state only after valid reports", () => {
  const out = join(root, ".reviews", "smoke");
  const brief = join(root, "brief.md");
  writeFileSync(brief, "## Acceptance criteria\nDo not include master-only files.\n");
  execFileSync(process.execPath, [resolve("scripts/review/prepare.mjs"), out, "--since", reviewed, "--brief", brief], {
    cwd: root,
    env: { ...process.env, ANGLES: "correctness" },
  });
  const prompt = readFileSync(join(out, "prompt.md"), "utf8");
  expect(prompt).toContain("Do not include master-only files.");
  writeFileSync(join(out, "correctness.json"), JSON.stringify(lens("correctness", []).report));
  execFileSync(process.execPath, [resolve("scripts/review/merge.mjs"), out], { cwd: root });
  const saved = JSON.parse(readFileSync(join(root, ".reviews/state/branch-feature.json"), "utf8"));
  expect(saved).toMatchObject({ round: 1, lastReviewedSha: git(root, "rev-parse", "HEAD").trim(), openP1Ids: [] });
  const next = join(root, ".reviews", "second");
  execFileSync(process.execPath, [resolve("scripts/review/prepare.mjs"), next], {
    cwd: root,
    env: { ...process.env, ANGLES: "correctness" },
  });
  expect(readFileSync(join(next, "prompt.md"), "utf8")).toContain("Do not include master-only files.");
  expect(() =>
    execFileSync(process.execPath, [resolve("scripts/review/merge.mjs"), next], { cwd: root, stdio: "pipe" }),
  ).toThrow();
  expect(JSON.parse(readFileSync(join(root, ".reviews/state/branch-feature.json"), "utf8"))).toEqual(saved);
});

it("keeps PR identity in the documented continuation commands", () => {
  const readme = readFileSync(resolve("scripts/review/README.md"), "utf8");
  const examples = readme.split("```sh")[1].split("```")[0];
  for (const flag of ["--since", "--allow-round-4"]) {
    const command = examples.split("\n").find((line) => line.includes(flag));
    expect(command).toContain("--pr 123");
  }
});

describe("review CLI in a detached checkout", () => {
  let checkout: string;
  let resolver: string;
  const prepareScript = resolve("scripts/review/prepare.mjs");
  const mergeScript = resolve("scripts/review/merge.mjs");
  type Prepared = Plan & {
    angles: string[];
    branch: string;
    stateFile: string;
    expectedState: State | null;
    scope: ReturnType<typeof reviewScope>;
  };
  beforeEach(() => {
    checkout = mkdtempSync(join(tmpdir(), "review-detached-"));
    git(checkout, "clone", "--quiet", "--no-hardlinks", root, ".");
    git(checkout, "checkout", "--detach", "HEAD");
    // Deliberately stale local master: the PR resolver must supply the authoritative base.
    git(checkout, "update-ref", "refs/remotes/origin/master", `${reviewed}^`);
    resolver = join(checkout, "resolve-pr.mjs");
    resolvePr();
  });
  function resolvePr(base = masterOnly) {
    writeFileSync(
      resolver,
      `import process from 'node:process';\nprocess.stdout.write(JSON.stringify({headRefName: 'feature', baseRefOid: '${base}', title: 'PR ' + process.argv[2], body: 'Keep the PR scoped.'}));\n`,
    );
  }
  afterEach(() => {
    if (checkout) rmSync(checkout, { recursive: true, force: true });
  });
  function prepare(name: string, args: string[], angles = "correctness") {
    const out = join(checkout, ".reviews", name);
    execFileSync(process.execPath, [prepareScript, out, ...args], {
      cwd: checkout,
      env: { ...process.env, ANGLES: angles, REVIEW_PR_RESOLVER: resolver },
      stdio: "pipe",
    });
    return { out, prepared: JSON.parse(readFileSync(join(out, "plan.json"), "utf8")) as Prepared };
  }
  function writeReports(out: string, prepared: Prepared, open = false) {
    for (const angle of prepared.angles)
      writeFileSync(
        join(out, `${angle}.json`),
        JSON.stringify(
          lens(
            angle,
            [],
            (prepared.state?.openP1s ?? []).map((x) => ({
              id: x.id,
              status: open ? "open" : "fixed",
              detail: open ? "Still reproducible." : "The regression passes.",
            })),
          ).report,
        ),
      );
  }
  function merge(out: string, prepared: Prepared, open = false) {
    writeReports(out, prepared, open);
    execFileSync(process.execPath, [mergeScript, out], { cwd: checkout, stdio: "pipe" });
  }
  function seed(pr: string, outstanding = false) {
    const issue = { ...finding(), id: "R-persisted", lenses: ["security"] };
    const saved: State = {
      round: outstanding ? 1 : 3,
      lastReviewedSha: reviewed,
      openP1Ids: outstanding ? [issue.id] : [],
      openP1s: outstanding ? [issue] : [],
      context: "Persisted acceptance criteria.",
    };
    const file = join(checkout, ".reviews", "state", `${pr}.json`);
    mkdirSync(join(checkout, ".reviews", "state"), { recursive: true });
    writeFileSync(file, JSON.stringify(saved));
    return { file, saved };
  }
  it("resolves --pr on detached HEAD, ignores branch smoke state, and starts with all seven lenses", () => {
    seed("branch-feature");
    const { out, prepared } = prepare("detached", ["--pr", "123"]);
    expect(prepared).toMatchObject({ round: 1, branch: "feature", state: null, expectedState: null, angles: ANGLES });
    expect(prepared.stateFile).toBe(join(".reviews", "state", "pr-123.json"));
    expect(existsSync(join(checkout, prepared.stateFile))).toBe(false);
    expect(prepared.scope.base).toBe(masterOnly);
    expect(prepared.scope.files).toEqual(["feature.txt", "shared.txt"]);
    expect(readFileSync(join(out, "prompt.md"), "utf8")).toContain("PR 123");
    merge(out, prepared);
    const report = readFileSync(join(out, "REPORT.md"), "utf8");
    expect(report.split("## Exact files reviewed")[0]).toContain("**Round 1 · 2 files · branch**");
    expect(report).toContain("pnpm review '--pr' '123'");
    expect(prepare("detached-next", ["--pr", "123"]).prepared.round).toBe(2);
  });
  it("retains saved intent when --pr only identifies a continuation and replaces it explicitly", () => {
    const { file, saved } = seed("pr-123", true);
    const continuation = prepare("intent-continuation", ["--pr", "123"]);
    expect(continuation.prepared.context).toBe(saved.context);
    expect(readFileSync(join(continuation.out, "prompt.md"), "utf8")).toContain(saved.context);
    merge(continuation.out, continuation.prepared);
    expect(readState(file)?.context).toBe(saved.context);
    const refreshed = prepare("intent-refresh", ["--pr", "123", "--refresh-intent"]);
    expect(refreshed.prepared.context).toContain("Keep the PR scoped.");
    expect(refreshed.prepared.context).not.toContain(saved.context);
    const brief = join(checkout, "replacement.md");
    writeFileSync(brief, "Replacement acceptance criteria.");
    expect(prepare("intent-brief", ["--pr", "123", "--brief", brief]).prepared.context).toContain(
      "Replacement acceptance criteria.",
    );
    expect(prepare("intent-full", ["--pr", "123", "--full"]).prepared.context).toBe(saved.context);
    expect(() => prepare("refresh-without-pr", ["--branch", "feature", "--refresh-intent"])).toThrow("requires --pr");
  });
  it("labels the saved fix delta separately from the whole PR scope", () => {
    const { file, saved } = seed("pr-123", true);
    const merged = git(checkout, "rev-parse", "HEAD^").trim();
    writeFileSync(file, JSON.stringify({ ...saved, lastReviewedSha: merged }));
    const { out, prepared } = prepare("delta-scope", ["--pr", "123"]);
    expect(prepared.scope).toMatchObject({ mode: "delta", since: merged, files: ["feature.txt"] });
    expect(prepared.prScope?.files).toEqual(["feature.txt", "shared.txt"]);
    const prompt = readFileSync(join(out, "prompt.md"), "utf8");
    expect(prompt).toContain(`only the fix delta since ${merged}, not the whole PR`);
    expect(prompt).toContain('Whole PR files (context only): ["feature.txt","shared.txt"]');
    merge(out, prepared);
    expect(readFileSync(join(out, "REPORT.md"), "utf8")).toContain(`Fix delta since ${merged}; whole PR: 2 files.`);
  });
  it("merges round two with an unknown previous ID, logging it and advancing state", () => {
    const { file } = seed("pr-123", true);
    const { out, prepared } = prepare("unknown-previous", ["--pr", "123"]);
    writeReports(out, prepared);
    const reportFile = join(out, "correctness.json");
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    report.findings = [finding({ previousId: "R-not-in-state", file: "feature.txt", line: 1 })];
    writeFileSync(reportFile, JSON.stringify(report));
    const output = execFileSync(process.execPath, [mergeScript, out], { cwd: checkout, stdio: "pipe" });
    expect(output.toString()).toContain("Consolidated");
    expect(readState(file)?.round).toBe(2);
    expect(readFileSync(join(out, "REPORT.md"), "utf8")).toContain("unknown or resolved previous issue R-not-in-state");
  });
  it("uses --branch on detached HEAD and explains how to resolve an unnamed review", () => {
    const { prepared } = prepare("explicit-branch", ["--branch", "explicit/feature"]);
    expect(prepared.branch).toBe("explicit/feature");
    expect(prepared.stateFile).toBe(join(".reviews", "state", "branch-explicit", "feature.json"));
    expect(() => prepare("unnamed", [])).toThrow("supply --pr <number> or --branch <name>");
    expect(() => prepare("mismatch", ["--pr", "123", "--branch", "other"])).toThrow("must match");
  });
  it("fetches a PR base that advanced only on the remote before computing scope", () => {
    const remote = join(checkout, "remote.git");
    git(checkout, "clone", "--quiet", "--bare", root, remote);
    git(checkout, "remote", "set-url", "origin", remote);
    const base = git(
      remote,
      "-c",
      "user.name=Review fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit-tree",
      `${masterOnly}^{tree}`,
      "-p",
      masterOnly,
      "-m",
      "remote base advances",
    ).trim();
    git(remote, "update-ref", "refs/heads/master", base);
    resolvePr(base);
    expect(() => git(checkout, "cat-file", "-e", `${base}^{commit}`)).toThrow();
    const { prepared } = prepare("remote-base", ["--pr", "123"]);
    expect(git(checkout, "cat-file", "-t", base).trim()).toBe("commit");
    expect(prepared.scope.base).toBe(masterOnly);
    expect(prepared.scope.files).toEqual(["feature.txt", "shared.txt"]);
    expect(prepared.scope.patch).not.toContain("master-only.txt");
  });
  it("explains an unavailable PR base without producing a review plan or state", () => {
    const base = "0".repeat(40);
    resolvePr(base);
    expect(() => prepare("missing-base", ["--pr", "123"])).toThrow(
      `PR #123 base commit ${base} is unavailable locally and could not be fetched from origin. Fetch the PR base and retry.`,
    );
    expect(existsSync(join(checkout, ".reviews", "missing-base"))).toBe(false);
    expect(existsSync(join(checkout, ".reviews", "state", "pr-123.json"))).toBe(false);
  });
  it("isolates a completed branch named pr-123 from PR 123's first round", () => {
    git(checkout, "switch", "-c", "pr-123");
    const smoke = prepare("branch-smoke", []);
    merge(smoke.out, smoke.prepared);
    const smokeFile = join(checkout, smoke.prepared.stateFile);
    const savedSmoke = readFileSync(smokeFile, "utf8");
    const first = prepare("pr-first", ["--pr", "123"]);
    expect(first.prepared).toMatchObject({ round: 1, state: null, expectedState: null, angles: ANGLES });
    expect(first.prepared.scope.files).toEqual(["feature.txt", "shared.txt"]);
    expect(first.prepared.stateFile).not.toBe(smoke.prepared.stateFile);
    merge(first.out, first.prepared);
    expect(readFileSync(smokeFile, "utf8")).toBe(savedSmoke);
    expect(prepare("branch-next", []).prepared.round).toBe(2);
    expect(prepare("pr-next", ["--pr", "123"]).prepared.round).toBe(2);
  });
  it("scopes --full to the whole PR, selects all lenses, and neither creates nor advances state", () => {
    seed("pr-123");
    for (const pr of ["123", "124"]) {
      const file = join(checkout, ".reviews", "state", `pr-${pr}.json`);
      const before = existsSync(file) ? readFileSync(file, "utf8") : null;
      const { out, prepared } = prepare(`full-${pr}`, ["--pr", pr, "--full"]);
      expect(prepared).toMatchObject({ round: 1, angles: ANGLES, state: null });
      expect(prepared.scope.files).toEqual(reviewScope(checkout, { baseRef: masterOnly }).files);
      expect(prepared.scope.mode).toBe("full");
      expect(prepared.scope.patch).toContain("+resolved feature");
      expect(prepared.scope.patch).not.toContain("master-only.txt");
      merge(out, prepared);
      expect(existsSync(file) ? readFileSync(file, "utf8") : null).toBe(before);
    }
  });
  it("requires --audit for a repository-wide review, even without a named branch or base ref", () => {
    seed("pr-123");
    git(checkout, "update-ref", "-d", "refs/remotes/origin/master");
    const { out, prepared } = prepare("audit", ["--audit"]);
    expect(prepared.scope).toMatchObject({ mode: "audit", patch: "" });
    expect(prepared.scope.files).toEqual(git(checkout, "ls-files", "-z").split("\0").filter(Boolean));
    expect(prepared.scope.files).toContain("master-only.txt");
    expect(prepared.angles).toEqual(ANGLES);
    merge(out, prepared);
    expect(existsSync(join(checkout, prepared.stateFile))).toBe(false);
    const file = join(checkout, ".reviews", "state", "pr-123.json");
    const before = readFileSync(file, "utf8");
    const auditPr = prepare("audit-pr", ["--audit", "--pr", "123"]);
    merge(auditPr.out, auditPr.prepared);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(() => prepare("ambiguous", ["--full", "--audit"])).toThrow("mutually exclusive");
  });
  it("resets state to round one and a full PR review only after a successful merge", () => {
    const { file, saved } = seed("pr-125");
    const { out, prepared } = prepare("reset", ["--pr", "125", "--reset-state"]);
    expect(prepared).toMatchObject({ round: 1, angles: ANGLES, state: null, expectedState: saved });
    expect(prepared.scope.files).toEqual(["feature.txt", "shared.txt"]);
    expect(readState(file)).toEqual(saved);
    expect(() => execFileSync(process.execPath, [mergeScript, out], { cwd: checkout, stdio: "pipe" })).toThrow();
    expect(readState(file)).toEqual(saved);
    merge(out, prepared);
    expect(readState(file)).toMatchObject({ round: 1, openP1s: [] });
    expect(prepare("reset-next", ["--pr", "125"]).prepared.round).toBe(2);
    expect(() => prepare("reset-full", ["--pr", "125", "--reset-state", "--full"])).toThrow("cannot be combined");
  });
  it("loads an outstanding P1 from disk, requires its lens, and persists it until unanimously fixed", () => {
    const { file, saved } = seed("pr-126", true);
    const second = prepare("persisted", ["--pr", "126"], "tests");
    expect(second.prepared).toMatchObject({ round: 2, angles: ["correctness", "security", "tests"], state: saved });
    expect(readFileSync(join(second.out, "prompt.md"), "utf8")).toContain("R-persisted");
    merge(second.out, second.prepared, true);
    expect(readState(file)).toMatchObject({ round: 2, openP1Ids: ["R-persisted"], openP1s: saved.openP1s });
    const third = prepare("persisted-fixed", ["--pr", "126"]);
    expect(third.prepared.angles).toEqual(["correctness", "security"]);
    merge(third.out, third.prepared);
    expect(readState(file)).toMatchObject({ round: 3, openP1Ids: [], openP1s: [] });
    expect(readFileSync(join(third.out, "REPORT.md"), "utf8")).toContain("pnpm review '--pr' '126' '--allow-round-4'");
  });
  it("serializes concurrent compare-and-replace writers and rejects stale snapshots", async () => {
    const file = join(checkout, ".reviews", "state", "concurrent.json");
    const attempts = Array.from({ length: 8 }, (_, i) =>
      replaceState(file, null, async () => {
        // Yield after comparison so an unlocked implementation deterministically loses updates.
        await new Promise<void>((done) => setImmediate(done));
        return { round: i + 1, lastReviewedSha: reviewed, openP1Ids: [], openP1s: [] };
      }),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((x) => x.status === "rejected");
    expect(rejected).toHaveLength(7);
    for (const result of rejected) expect(String(result.reason)).toContain("Another review advanced state");
    const saved = readState(file);
    expect(saved).toMatchObject({ lastReviewedSha: reviewed, openP1s: [] });
    await expect(replaceState(file, null, () => saved!)).rejects.toThrow("Another review");
    await expect(
      replaceState(file, saved, () => {
        throw new Error("Failed replacement");
      }),
    ).rejects.toThrow("Failed replacement");
    await replaceState(file, saved, () => ({ ...saved!, round: 9 }));
    expect(readState(file)?.round).toBe(9);
  });
  it("locks competing merge processes before comparing their saved snapshots", async () => {
    const { file } = seed("pr-127", true);
    const rounds = [prepare("competing-a", ["--pr", "127"]), prepare("competing-b", ["--pr", "127"])];
    for (const { out, prepared } of rounds) writeReports(out, prepared);
    const unlock = await acquireLock(join(realpathSync(dirname(file)), basename(file)), process.platform);
    const children = rounds.map(({ out }) => {
      const child = spawn(process.execPath, [mergeScript, out], { cwd: checkout, stdio: ["ignore", "pipe", "pipe"] });
      const completion = new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("close", done);
      });
      const waiting = new Promise<void>((done, reject) => {
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes("Waiting for review state lock")) done();
        });
        child.once("error", reject);
        child.once("close", () => reject(new Error("Merge finished without waiting for the state lock")));
      });
      child.stderr.resume();
      return { completion, waiting };
    });
    try {
      await Promise.all(children.map((x) => x.waiting));
    } finally {
      await unlock();
      await Promise.allSettled(children.map((x) => x.completion));
    }
    expect((await Promise.all(children.map((x) => x.completion))).sort()).toEqual([0, 1]);
    expect(readState(file)).toMatchObject({ round: 2, openP1s: [] });
  });
});
