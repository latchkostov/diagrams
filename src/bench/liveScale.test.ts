import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it.each([
  ["quick", "", [500]],
  ["full", "500", [500]],
  ["full", "1500", [1500]],
  ["full", "", [500, 1500]],
  ["gates", "", [500, 1500]],
])("honors benchmark mode %s and size filter %s", (mode, sizes, expected) => {
  const listing = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        "tests/bench/playwright.config.ts",
        "liveScale.bench.ts",
        "--list",
        "--reporter=json",
      ],
      { encoding: "utf8", env: { ...process.env, BENCH_MODE: mode, BENCH_SIZES: sizes } },
    ),
  ) as {
    suites: { specs: { title: string; tests: { expectedStatus: string }[] }[] }[];
  };
  const specs = listing.suites.flatMap((suite) => suite.specs);
  expect(specs.map((spec) => spec.title)).toEqual(expected.map((n) => `live scale pipeline@${n}`));
  expect(specs.flatMap((spec) => spec.tests.map((test) => test.expectedStatus))).toEqual(
    expected.map(() => (mode === "gates" ? "skipped" : "passed")),
  );
});
