import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { changedLines, git, reviewScope } from "../../scripts/review/scope.mjs";
import { consolidate, renderReport } from "../../scripts/review/triage.mjs";
import { nextState, roundPlan } from "../../scripts/review/rounds.mjs";
import { options, plan as gatePlan } from "../../scripts/gate/logic.mjs";

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
  const saved = JSON.parse(readFileSync(join(root, ".reviews/state/feature.json"), "utf8"));
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
  expect(JSON.parse(readFileSync(join(root, ".reviews/state/feature.json"), "utf8"))).toEqual(saved);
});
