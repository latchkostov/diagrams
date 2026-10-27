import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import console from "node:console";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { buildArtifacts, requiredProfiles, verifyArtifacts } from "../../scripts/ci/e2e-builds.mjs";
import { E2E_PROFILES } from "../../scripts/e2e-profiles.mjs";
import { planShards, updateTimings } from "../../scripts/e2e-shard.mjs";

const roots: string[] = [];
function fixture() {
  mkdirSync("tests/.output", { recursive: true });
  const root = mkdtempSync(resolve("tests/.output/ci-e2e-"));
  roots.push(root);
  mkdirSync(join(root, "tests/e2e"), { recursive: true });
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

it("builds each required variant once and preserves conditional self-host profiles", async () => {
  const specs = ["tests/e2e/self-host.spec.ts", "tests/e2e/self-host-locked.spec.ts"];
  const build = vi.fn().mockResolvedValue(0);
  await buildArtifacts(specs, build);
  expect(build.mock.calls.map(([name]) => name)).toEqual(["e2e", "preview", "internal", "locked"]);
  expect(requiredProfiles("dev", [specs[1]])).toEqual(["e2e", "preview", "locked"]);
  expect(requiredProfiles("build", ["tests/e2e/smoke.spec.ts"])).toEqual(["e2e", "preview"]);
  expect(() => requiredProfiles("other", specs)).toThrow("target");
  build.mockReset().mockImplementation(async (name) => (name === "preview" ? 1 : 0));
  await expect(buildArtifacts(specs, build)).rejects.toThrow("preview");
  expect(build).toHaveBeenCalledTimes(4);
});

it("fails on missing shared builds and requires only the self-host variants a shard serves", () => {
  const root = fixture();
  for (const name of ["e2e", "preview", "internal"] as const) {
    const dir = join(root, E2E_PROFILES[name].outDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), name);
  }
  expect(() => verifyArtifacts("build", ["tests/e2e/self-host.spec.ts"], root)).not.toThrow();
  expect(() => verifyArtifacts("build", ["tests/e2e/self-host-locked.spec.ts"], root)).toThrow(
    "Missing prebuilt locked",
  );
  rmSync(join(root, E2E_PROFILES.e2e.outDir, "index.html"));
  expect(() => verifyArtifacts("build", ["tests/e2e/smoke.spec.ts"], root)).toThrow("Missing prebuilt e2e");
  expect(() => verifyArtifacts("dev", ["tests/e2e/smoke.spec.ts"], root)).toThrow("Missing prebuilt e2e");
});

it("uses whole-file greedy duration bins with disjoint and complete coverage", () => {
  const root = fixture();
  const seconds = { "a.spec.ts": 12, "b.spec.ts": 8, "c.spec.ts": 4, "d.spec.ts": 2, "e.spec.ts": 1 };
  for (const file of Object.keys(seconds)) writeFileSync(join(root, "tests/e2e", file), "");
  writeFileSync(join(root, "tests/e2e-timings.json"), JSON.stringify({ seconds }));
  const shards = planShards(2, root);
  expect(shards.map((s) => s.seconds)).toEqual([14, 13]);
  expect(shards.flatMap((s) => s.files).sort()).toEqual(Object.keys(seconds));
  expect(planShards(2, root)).toEqual(shards);
});

it.each([
  undefined,
  "{",
  "{}",
  "null",
  '{"seconds":null}',
  '{"seconds":{"a.spec.ts":100}}',
  '{"seconds":{"a.spec.ts":"100"}}',
])("uses a count split when duration data is missing, incomplete or invalid: %s", (data) => {
  const root = fixture();
  for (const file of ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts"])
    writeFileSync(join(root, "tests/e2e", file), "");
  if (data !== undefined) writeFileSync(join(root, "tests/e2e-timings.json"), data);
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(planShards(2, root)).toEqual([
    { files: ["a.spec.ts", "c.spec.ts", "e.spec.ts"], seconds: 3 },
    { files: ["b.spec.ts", "d.spec.ts"], seconds: 2 },
  ]);
});

it("refreshes timings from a download directory, averaging first passes while ignoring retries and failures", () => {
  const root = fixture();
  for (const file of ["a.spec.ts", "b.spec.ts"]) writeFileSync(join(root, "tests/e2e", file), "");
  writeFileSync(
    join(root, "tests/e2e-timings.json"),
    JSON.stringify({ seconds: { "b.spec.ts": 7, "deleted.spec.ts": 10 } }),
  );
  const reports = join(root, "download");
  mkdirSync(reports);
  const spec = (file: string, results: { status: string; duration: number }[]) => ({
    file,
    title: file,
    line: 1,
    tests: [{ projectName: "chromium", results }],
  });
  for (const [i, duration] of [1000, 3000].entries()) {
    const dir = join(reports, `e2e-durations-${i + 1}`);
    mkdirSync(dir);
    writeFileSync(
      join(dir, "results.json"),
      JSON.stringify({
        suites: [
          {
            suites: [
              {
                specs: [
                  spec("a.spec.ts", [
                    { status: "passed", duration },
                    { status: "passed", duration: 90000 },
                  ]),
                  spec("b.spec.ts", [
                    { status: "failed", duration: 90000 },
                    { status: "passed", duration: 1000 },
                  ]),
                ],
              },
            ],
          },
        ],
      }),
    );
  }
  updateTimings([reports], root);
  expect(JSON.parse(readFileSync(join(root, "tests/e2e-timings.json"), "utf8")).seconds).toEqual({
    "a.spec.ts": 2,
    "b.spec.ts": 7,
  });
  expect(() => updateTimings([], root)).toThrow("at least one");
});

it("wires six unchanged check names to one artifact producer and skips browser installs in the image", () => {
  const { jobs } = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const action = parse(readFileSync(".github/actions/e2e/action.yml", "utf8"));
  const steps = action.runs.steps as {
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    env?: Record<string, string>;
    with?: Record<string, string>;
  }[];
  const producer = jobs["e2e-build"];
  expect(producer.needs).toBe("changes");
  expect(producer.if).toBe(jobs.e2e.if);
  expect(producer.steps.filter((s: { run?: string }) => s.run === "node scripts/ci/e2e-builds.mjs build")).toHaveLength(
    1,
  );
  const artifact = producer.steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/upload-artifact"));
  expect(artifact.with.name).toBe("e2e-builds");
  expect(artifact.with.path.trim().split("\n")).toEqual(Object.values(E2E_PROFILES).map((p) => p.outDir));
  expect(jobs.e2e.needs).toContain("e2e-build");
  expect(jobs.e2e.name).toBe("E2E ${{ matrix.shard }}/${{ strategy.job-total }}");
  expect(jobs.e2e.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6]);
  expect(jobs.e2e.container.image).toBe("${{ needs.e2e-build.outputs.playwright-image }}");
  expect(jobs.e2e.container.options).toContain("--ipc=host");
  expect(jobs.e2e.steps.find((s: { uses?: string }) => s.uses === "./.github/actions/e2e").with).toMatchObject({
    "builds-artifact": "e2e-builds",
    "browser-setup": "image",
  });
  expect(steps.find((s) => s.name === "Local builds")?.if).toBe("inputs.builds-artifact == ''");
  expect(steps.find((s) => s.name === "Download shared E2E builds")?.with?.path).toBe("tests/.output");
  for (const step of steps.filter(
    (s) => s.uses?.includes("chromium-cache") || s.name === "Browser system dependencies",
  ))
    expect(step.if).toContain("inputs.browser-setup == 'install'");
  expect(steps.find((s) => s.name === "Local builds")?.run).toContain('if [ "$BROWSER_SETUP" = "install" ]; then');
  expect(steps.find((s) => s.name === "Local builds")?.run).toContain(
    'node scripts/ci/e2e-builds.mjs build "$TARGET" "${specs[@]}"',
  );
  expect(steps.find((s) => s.name === "Playwright")?.env).toMatchObject({
    E2E_PREBUILT: "1",
    E2E_GATE: "1",
    E2E_PORT: "6400",
    E2E_LOCKED_PORT: "6404",
  });
  expect(jobs.ci.needs).toContain("e2e-build");
  expect(jobs.ci.name).toBe("CI");
  expect(jobs.checks.name).toBe("Types, lint, unit, build");
  expect(jobs["e2e-report"].needs).toBe("e2e");
  expect(jobs.e2e.steps.find((s: { name?: string }) => s.name === "Upload blob report").with.name).toBe(
    "blob-report-${{ matrix.shard }}",
  );
  expect(jobs.e2e.steps.find((s: { name?: string }) => s.name === "Upload durations").with.name).toBe(
    "e2e-durations-${{ matrix.shard }}",
  );
});
