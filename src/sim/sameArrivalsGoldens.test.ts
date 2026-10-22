// Reproduces docs/PARITY.md's "Sampling 8a-pre" direction table: every changed simulation golden against its
// same-arrivals scale-1 reference. Opt-in (it plays every changed simulation at scale 1):
//   GOLDEN_REFS=1 GOLDEN_BASE=origin/master pnpm exec vitest run src/sim/sameArrivalsGoldens.test.ts --silent=false
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { cohortArrivals, drive, sameArrivals } from "../test/scaleEquivalence";
import { createEngine } from "./engine";
import { STEP } from "./timing";
import { allDiagrams } from "../../tests/parity/lib/corpus";
import { direction, FINAL_COUNTERS, playFinal, type FinalCounters } from "../test/sameArrivalsGoldens";

/** A queue-fed one-slot caller blocking on a 10 ms callee: the I1 harness's managed shape without admission. */
function queueCall() {
  const d = waitingFixture();
  d.nodes[0].stencil = "generic.queue";
  d.nodes[0].props = { maxDeliveryCount: 3 };
  d.nodes[1].props = { concurrency: 1, replicas: 1, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 1, replicas: 1, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { travelMs: 10, networkDelayMs: 10, caller: { wait: "blocking", replyMs: 0 } };
  return d;
}

it.each([1.01, 2.5, 10])(
  "the same-arrivals oracle replays the I1 harness's scale-one reference (scale %s)",
  (scale) => {
    // EngineOptions.sameArrivals is the scale-one run at the sampled arrival instants that scaleEquivalence.ts builds by
    // hand (sameArrivals): every emitted dot arrives as floor-cumulative real requests.
    const cohorts = cohortArrivals(scale);
    const reference = drive(queueCall(), 1, sameArrivals(cohorts, scale));
    const e = createEngine({ scale: 1, seed: 7, maxParticles: 0, sameArrivals: true });
    e.load(queueCall());
    e.setScale(scale);
    for (const count of cohorts) {
      if (count > 0) e.inject("source", count);
      e.step(STEP);
    }
    expect(e.snapshot().nodes).toEqual(reference.nodes);
    expect(e.snapshot().scale).toBe(1);
  },
);

// Named gaps (docs/backlog/2026-10-22-sampling-slow-callee-without-pool.md): sampled blocking callers whose callee
// outlasts their threads keep finishing more than scale 1. Real-unit prefetch (8a-pre) widened it.
describe("blocking-call free play at scale 10", () => {
  let sampled: ReturnType<typeof playFinal>, reference: ReturnType<typeof playFinal>;
  beforeAll(() => {
    const { diagram } = allDiagrams.find((d) => d.slug === "blocking-call")!;
    sampled = playFinal(diagram, null);
    reference = playFinal(diagram, null, { sameArrivals: true });
  }, 60_000);
  it("pins the exact sampled and same-arrivals caller completions", () => {
    // Master (whole-dot prefetch): 13,710.
    expect([sampled.scale, sampled.nodes.caller.processed, reference.nodes.caller.processed]).toEqual([
      10, 14643, 11854,
    ]);
  });
  it.fails("I1 known gap: caller completions within the I1 bound of the same-arrivals scale-one run", () => {
    const x = reference.nodes.caller.processed;
    expect(Math.abs(sampled.nodes.caller.processed - x)).toBeLessThanOrEqual(10 * (Math.ceil(64 / 10) + 1) + 0.02 * x);
  });
});

describe("busy-thread blocking at scale 2", () => {
  // Within the I1 bound, but more than a dot further from scale 1 than master's 11,982 (65 versus 54): pinned.
  it("pins the exact sampled and same-arrivals caller completions", () => {
    const { diagram } = allDiagrams.find((d) => d.slug === "scale-on-busy-threads")!;
    const simulation = diagram.simulations!.find((s) => s.id === "blocking")!;
    const sampled = playFinal(diagram, simulation);
    const reference = playFinal(diagram, simulation, { sameArrivals: true });
    expect([sampled.scale, sampled.nodes.caller.processed, reference.nodes.caller.processed]).toEqual([
      2, 11993, 11928,
    ]);
  }, 60_000);
});

const GOLDENS = "tests/parity/goldens/node/";

function counters(real: Record<string, Record<string, number> | string>): FinalCounters {
  return Object.fromEntries(
    Object.entries(real).map(([id, node]) => [
      id,
      Object.fromEntries(
        FINAL_COUNTERS.map((key) => [key, typeof node === "string" ? 0 : (node[key] ?? 0)]),
      ) as FinalCounters[string],
    ]),
  );
}

it.skipIf(process.env.GOLDEN_REFS !== "1")(
  "same-arrivals direction of changed simulation goldens",
  { timeout: 3_600_000 },
  () => {
    const base = process.env.GOLDEN_BASE ?? "origin/master";
    const changed = execSync(`git diff --name-only ${base} -- ${GOLDENS}sim`, { encoding: "utf8" })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const rows = [
      "| Golden | N | Σ off (master) | Σ off (branch) | Verdict | Counters more than a dot further |",
      "|---|--:|--:|--:|---|---|",
    ];
    let away = 0;
    for (const path of changed) {
      const [, slug, name] = path.slice(GOLDENS.length).match(/^sim\/(.+)\/(.+)\.json$/)!;
      const { diagram } = allDiagrams.find((d) => d.slug === slug)!;
      const simulation = name === "free-play" ? null : diagram.simulations!.find((s) => s.id === name)!;
      const master = JSON.parse(execSync(`git show ${base}:${path}`, { encoding: "utf8", maxBuffer: 1 << 28 }));
      const branch = JSON.parse(readFileSync(path, "utf8"));
      const reference = playFinal(diagram, simulation, { sameArrivals: true });
      const d = direction(
        diagram,
        master.run.scale,
        counters(master.final.real),
        counters(branch.final.real),
        reference.nodes,
      );
      if (d.verdict === "away") away++;
      rows.push(
        `| \`${slug}/${name}\` | ${master.run.scale} | ${d.master} | ${d.branch} | ${d.verdict} | ${[...d.away, ...d.noise.map((n) => `${n} (share)`)].join(", ")} |`,
      );
    }
    console.log(rows.join("\n"));
    expect(away).toBeGreaterThanOrEqual(0);
  },
);
