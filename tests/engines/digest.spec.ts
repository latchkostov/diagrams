import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { test, expect } from "@playwright/test";
import type { DiagramFile, Simulation } from "../../src/model/types";
import type { EngineRun, playDigests } from "./harness";
import { HARNESS } from "./build-harness";

// Every saved simulation of the public examples, played to 60 s (or its end) with the harness's tweaks and scrub:
// each browser's run digests and latency percentiles must equal Node's (V8, as the parity goldens). A difference
// names the engine, the simulation and the first simulated moment the states differ.
//
// The public examples only: the top-level files in src/examples (src/examples/private is never listed or read).

const UNTIL_MS = 60_000;

const examples = readdirSync("src/examples", { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name)
  .sort()
  .map((name) => ({
    slug: name.slice(0, -".json".length),
    diagram: JSON.parse(readFileSync(join("src/examples", name), "utf8")) as DiagramFile,
  }));

const runs = examples.flatMap(({ slug, diagram }) =>
  (diagram.simulations ?? []).map((simulation) => ({ name: `${slug} / ${simulation.id}`, diagram, simulation })),
);

/** Node's run of the same script: the expected values (V8, as the parity goldens). */
function inNode(diagram: DiagramFile, simulation: Simulation): EngineRun {
  const sandbox: Record<string, unknown> = { console, performance, setTimeout, clearTimeout, structuredClone };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  runInNewContext(readFileSync(HARNESS, "utf8"), sandbox);
  const play = sandbox.__playDigests as typeof playDigests;
  return JSON.parse(JSON.stringify(play(diagram, simulation, UNTIL_MS))) as EngineRun;
}

test("the harness covers saved simulations", () => {
  expect(runs.length).toBeGreaterThanOrEqual(50);
  // Latency percentiles are compared too: enough runs measure some.
});

for (const run of runs)
  test(`${run.name}: the same digests as V8`, async ({ page, browserName }) => {
    const expected = inNode(run.diagram, run.simulation);
    expect(expected.digests.length).toBeGreaterThan(0);
    await page.setContent("<!doctype html><title>engine digests</title>");
    await page.addScriptTag({ content: readFileSync(HARNESS, "utf8") });
    const actual = await page.evaluate(
      ([diagram, simulation, until]) =>
        (globalThis as unknown as { __playDigests: typeof playDigests }).__playDigests(diagram, simulation, until),
      [run.diagram, run.simulation, UNTIL_MS] as const,
    );
    const first = expected.digests.find(
      ([ms, digest], i) => actual.digests[i]?.[0] !== ms || actual.digests[i]?.[1] !== digest,
    );
    expect(first, `${browserName} first differs at ${first?.[0]} ms`).toBeUndefined();
    expect(actual.digests).toEqual(expected.digests);
    expect(actual.latency).toEqual(expected.latency);
    expect(actual.ms).toBe(expected.ms);
  });
