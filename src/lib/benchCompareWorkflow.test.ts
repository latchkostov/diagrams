import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parse } from "yaml";

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
