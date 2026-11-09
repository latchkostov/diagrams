import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";

it.each(["bench-compare", "coverage-compare"])(
  "%s enforces read-only caches and removes checkout credentials before selected source runs",
  (name) => {
    const workflow = parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.permissions.contents).toBe("read");
    expect(workflow.jobs.compare["cache-mode"]).toBe("read");
    const steps = workflow.jobs.compare.steps as { uses?: string; with?: Record<string, unknown> }[];
    const checkouts = steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkouts.length).toBe(name === "bench-compare" ? 3 : 1);
    for (const checkout of checkouts) expect(checkout.with?.["persist-credentials"]).toBe(false);
    expect(checkouts.map((step) => step.with?.ref)).toEqual(
      name === "bench-compare"
        ? ["${{ github.sha }}", "${{ inputs.base }}", "${{ inputs.head }}"]
        : ["${{ steps.revision.outputs.sha }}"],
    );
    // Bootstrap inline so arbitrary older revisions need no new local action inputs, and no
    // cache-save post steps are scheduled. Normal PR/master toolchain caching stays separate.
    expect(steps.some((step) => step.uses?.startsWith("./.github/actions/"))).toBe(false);
    expect(steps.some((step) => step.uses?.startsWith("actions/cache@"))).toBe(false);
    const nodeSetups = steps.filter((step) => step.uses?.startsWith("actions/setup-node@"));
    expect(nodeSetups).toHaveLength(name === "bench-compare" ? 2 : 1);
    for (const setup of nodeSetups) {
      expect(setup.with?.["package-manager-cache"]).toBe(false);
      expect(setup.with?.cache).toBeUndefined();
      expect(setup.with?.["node-version-file"]).toBe(".nvmrc");
    }
  },
);

it("preserves survey comparison tooling from the workflow revision before checking out either measured revision", () => {
  const { steps } = parse(readFileSync(".github/workflows/bench-compare.yml", "utf8")).jobs.compare;
  const preserve = steps.findIndex((s: { name?: string }) => s.name === "Preserve workflow comparison tools");
  const checkout = steps.slice(0, preserve).findLast((s: { uses?: string }) => s.uses?.startsWith("actions/checkout"));
  expect(checkout.with.ref).toBe("${{ github.sha }}");
  expect(preserve).toBeLessThan(
    steps.findIndex((s: { with?: { ref?: string } }) => s.with?.ref === "${{ inputs.base }}"),
  );
  expect(preserve).toBeLessThan(
    steps.findIndex((s: { with?: { ref?: string } }) => s.with?.ref === "${{ inputs.head }}"),
  );
  expect(steps[preserve].run).toContain(
    'cp scripts/perf/survey2-compare.mjs scripts/perf/survey2-compare.test.mjs "$RUNNER_TEMP/bench-compare/tools/"',
  );
  const compare = steps.find((s: { id?: string }) => s.id === "comparison").run;
  expect(compare).toContain('out="$RUNNER_TEMP/bench-compare"');
  expect(compare).toContain('node --test "$out/tools/survey2-compare.test.mjs"');
  expect(compare).toContain(
    'node "$out/tools/survey2-compare.mjs" "$out/base/survey2/samples.jsonl" "$out/head/survey2/samples.jsonl"',
  );
});
