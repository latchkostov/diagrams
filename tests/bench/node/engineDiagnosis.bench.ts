// Opt-in diagnosis, never a timing gate. See docs/backlog/2026-10-27-engine-perf-bisect.md.
// ENGINE_DIAG=work|profile|memory|seek ENGINE_DIAG_RING=on|off|free ENGINE_DIAG_OUT=<directory>
// fnm exec --using 24 -- node node_modules/vitest/vitest.mjs run --config tests/bench/vitest.config.ts
//   tests/bench/node/engineDiagnosis.bench.ts
import { it, vi } from "vitest";
import * as resources from "../../../src/sim/engine/resources";
import * as revisions from "../../../src/model/revisions";
import { SampledLedger } from "../../../src/sim/ledger";
import { STEP } from "../../../src/sim/timing";
import { measureFresh } from "./harness";
import { Session } from "node:inspector/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { LiveController } from "../../../src/live/controller";
import { emptyInputs, freePlayScale } from "../../../src/live/capacityModel";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { createSimulationRun } from "../../../src/sim/simulation";
import { calibrate } from "../calibration";
import type { SimulationRunCheckpoint } from "../../../src/sim/types";

const mode = process.env.ENGINE_DIAG;
const out = process.env.ENGINE_DIAG_OUT ?? "tests/.output/engine-bisect/diagnosis";
const gc = () => {
  if (!globalThis.gc) throw new Error("Run with the benchmark config's --expose-gc");
  globalThis.gc();
  globalThis.gc();
};
function save(name: string, value: unknown) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), JSON.stringify(value, null, 2));
}
const revision = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const FRAME = 1000 / 60;

// Untimed operation census; allocations below count explicit scratch objects in the inactive bodies.
it.skipIf(mode !== "inactive")("engine diagnosis inactive paths @500", () => {
  let inactiveCpu = 0;
  const create = resources.createResources;
  const factory = vi.spyOn(resources, "createResources").mockImplementation((...args) => {
    const parts = [...create(...args)] as unknown as ReturnType<typeof create>;
    const prepare = parts[7];
    Object.assign(parts, {
      7: (node: Parameters<typeof prepare>[0]) => {
        if (!node.fleet && !node.props.resources && !node.cpuTail.size) inactiveCpu++;
        return prepare(node);
      },
    });
    return parts;
  });
  const revisionChecks = vi.spyOn(revisions, "revisionAtLeast");
  const release = vi.spyOn(SampledLedger.prototype, "releaseDue");
  const expire = vi.spyOn(SampledLedger.prototype, "expireCredits");
  try {
    const d = eventPipeline(500);
    const sim = d.simulations?.find((s) => s.id === "steady");
    if (!sim) throw new Error("Pipeline needs steady simulation");
    const run = createSimulationRun(d, sim);
    revisionChecks.mockClear();
    while (!run.state().done) run.step(100);
    const ticks = run.state().time / STEP;
    save("inactive.json", {
      revision: revision(),
      ticks,
      inactiveCpu,
      inactiveCpuPerTick: inactiveCpu / ticks,
      // prepareCpu: two closures, yielding array, return tuple; finishCpuTails: tailsAfter array.
      inactiveScratchAllocations: inactiveCpu * 5,
      revisionChecks: revisionChecks.mock.calls.length,
      ledgerReleaseChecks: release.mock.calls.length,
      ledgerCreditChecks: expire.mock.calls.length,
      snapshotSha256: createHash("sha256").update(JSON.stringify(run.engine.snapshot())).digest("hex"),
    });
  } finally {
    factory.mockRestore();
    revisionChecks.mockRestore();
    release.mockRestore();
    expire.mockRestore();
  }
});

it.skipIf(mode !== "replay")("engine diagnosis checkpointed replay @500", () => {
  const { c } = controller(500, "on");
  try {
    c.setPlaying(false);
    c.seek(60_000);
    const start = calibrate().ms;
    const timing = measureFresh(
      () => () => {
        c.seek(15_000);
        c.seek(60_000);
      },
      { samples: 5, warmup: 1 },
    );
    const end = calibrate().ms;
    save("replay-timing.json", {
      revision: revision(),
      timing,
      calibrationMs: (start + end) / 2,
      normalized: timing.median / ((start + end) / 2),
      snapshotSha256: createHash("sha256").update(JSON.stringify(c.snapshot())).digest("hex"),
    });
  } finally {
    c.dispose();
  }
});

// Diagnostic access only: disable controller capture in one arm, without changing engine source or restore logic.
type Internals = {
  captureCheckpoint(force?: boolean): void;
  checkpoints: { cp: SimulationRunCheckpoint }[];
};
function controller(n: number, ring: string) {
  const d = eventPipeline(n);
  const c = new LiveController(d, { seed: 7, replayDelayMs: 0 });
  const internal = c as unknown as Internals;
  if (ring === "off") internal.captureCheckpoint = () => {};
  if (ring === "free") {
    c.setInputs({ ...emptyInputs(), traffic: 10, scale: freePlayScale(d, emptyInputs()) });
    c.flush();
  } else {
    const base = d.simulations?.find((s) => s.id === "steady");
    if (!base) throw new Error("Pipeline needs steady simulation");
    const sim = {
      ...base,
      durationMs: 360_000,
      multipliers: { traffic: 10 },
      traffic: base.traffic.map((p) => ({
        ...p,
        shape: { kind: "constant" as const, ratePerSec: 5, durationMs: 360_000 },
      })),
    };
    if (c.selectSimulation(sim) !== "selected") throw new Error("Simulation refused");
  }
  c.setTraffic(true);
  c.setPlaying(true);
  return { c, internal };
}
function frames(c: LiveController, second: number) {
  for (let k = 0; k < 60; k++) {
    c.advance(FRAME);
    c.snapshot();
    if ((second * 60 + k) % 8 === 0) c.publish();
  }
}

it.skipIf(mode !== "work")("engine diagnosis work counts @500", () => {
  const d = eventPipeline(500);
  const runs = (d.simulations ?? []).map((sim) => {
    const run = createSimulationRun(d, sim);
    let steps = 0;
    while (!run.state().done && steps < 60_000) {
      run.step(100);
      steps++;
    }
    if (!run.state().done) throw new Error("Simulation did not finish");
    const snapshot = run.engine.snapshot();
    return {
      id: sim.id,
      steps,
      simulatedMs: run.state().time,
      inSystem: snapshot.inSystem,
      processed: Object.values(snapshot.nodes).reduce((sum, node) => sum + node.processed, 0),
      failed: Object.values(snapshot.nodes).reduce((sum, node) => sum + node.failed, 0),
    };
  });
  save("work.json", { revision: revision(), runs });
});

it.skipIf(mode !== "profile")(
  "engine diagnosis profiles @500",
  async () => {
    const d = eventPipeline(500);
    const sim = d.simulations?.find((s) => s.id === "steady");
    if (!sim) throw new Error("Pipeline needs steady simulation");
    const play = () => {
      const run = createSimulationRun(d, sim);
      for (let i = 0; i < 60_000 && !run.state().done; i++) run.step(100);
    };
    play();
    const calibration = calibrate();
    const session = new Session();
    session.connect();
    try {
      await session.post("Profiler.enable");
      await session.post("Profiler.setSamplingInterval", { interval: 200 });
      for (const scenario of ["saved", "replay"] as const) {
        if (process.env.ENGINE_DIAG_SCENARIO && process.env.ENGINE_DIAG_SCENARIO !== scenario) continue;
        // Construction and warm-up outside profiles; replay includes checkpoint capture AND restore.
        const { c, internal } = controller(500, "on");
        c.setPlaying(false);
        c.seek(60_000);
        let captures = 0;
        let captureMs = 0;
        let clones = 0;
        let cloneMs = 0;
        let checkpointCloneMs = 0;
        let depth = 0;
        const capture = internal.captureCheckpoint.bind(c);
        internal.captureCheckpoint = (force) => {
          const before = internal.checkpoints.at(-1)?.cp;
          const start = performance.now();
          depth++;
          try {
            capture(force);
          } finally {
            depth--;
            captureMs += performance.now() - start;
            if (internal.checkpoints.at(-1)?.cp !== before) captures++;
          }
        };
        const clone = globalThis.structuredClone;
        globalThis.structuredClone = (value, options) => {
          const start = performance.now();
          try {
            return clone(value, options);
          } finally {
            const ms = performance.now() - start;
            clones++;
            cloneMs += ms;
            if (depth) checkpointCloneMs += ms;
          }
        };
        gc();
        try {
          await session.post("Profiler.start");
          const start = performance.now();
          for (let i = 0; i < 12; i++) {
            if (scenario === "saved") play();
            else {
              c.seek(15_000);
              c.seek(60_000);
            }
          }
          const elapsedMs = performance.now() - start;
          const { profile } = await session.post("Profiler.stop");
          save(`${scenario}.cpuprofile`, profile);
          save(`${scenario}.json`, {
            revision: revision(),
            node: process.version,
            calibration,
            iterations: 12,
            elapsedMs,
            captures,
            captureMs,
            clones,
            cloneMs,
            checkpointCloneMs,
          });
        } finally {
          globalThis.structuredClone = clone;
          c.dispose();
        }
      }
    } finally {
      session.disconnect();
    }
  },
  900_000,
);

it.skipIf(mode !== "memory")(
  "engine diagnosis five minutes Live x10",
  async () => {
    const ring = process.env.ENGINE_DIAG_RING ?? "on";
    if (!["on", "off", "free"].includes(ring)) throw new Error("Unknown ring arm");
    const n = Number(process.env.ENGINE_DIAG_N ?? 500);
    const { c, internal } = controller(n, ring);
    const readings: Record<string, number | string>[] = [];
    const start = performance.now();
    const read = (second: number) => {
      gc();
      const snapshot = c.snapshot();
      readings.push({
        second,
        wallMs: performance.now() - start,
        simulatedMs: snapshot.time,
        scale: c.getState().scale,
        heapUsed: process.memoryUsage().heapUsed,
        checkpoints: internal.checkpoints.length,
        inSystem: snapshot.inSystem,
        processed: Object.values(snapshot.nodes).reduce((sum, node) => sum + node.processed, 0),
        snapshotSha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      });
      save(`memory-${ring}-${n}.json`, { revision: revision(), node: process.version, n, ring, readings });
    };
    try {
      read(0);
      for (let second = 1; second <= 300; second++) {
        frames(c, second - 1);
        if (second % 30 === 0) read(second);
        // Pace observation to wall time, while advancing deterministic 60 Hz simulated frames.
        const remaining = start + second * 1000 - performance.now();
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      // Same live engine, ring released: causal retained-heap check, without disabling any simulation work.
      internal.checkpoints = [];
      read(301);
      c.dispose();
      read(302);
    } finally {
      c.dispose();
    }
  },
  900_000,
);

it.skipIf(mode !== "seek")("engine diagnosis five-minute checkpoint seek distribution @500", () => {
  const { c, internal } = controller(500, "on");
  try {
    for (let second = 0; second < 300; second++) frames(c, second);
    gc();
    const heapUsed = process.memoryUsage().heapUsed;
    const checkpoints = internal.checkpoints;
    const retainedTimes = checkpoints.map(({ cp }) => cp.time);
    const atEnd = createHash("sha256").update(JSON.stringify(c.snapshot())).digest("hex");
    const reset = c.lookAhead();
    reset.restore();
    const seeks = [];
    let seed = 20261027;
    for (let i = 0; i < 24; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const target = Math.floor((seed / 2 ** 32) * 300) * 1000;
      // Reuse the five-minute ring for every sample, independent of the preceding seek's truncation.
      reset.restore();
      internal.checkpoints = [...checkpoints];
      const replayMs = c.seekCost(target);
      const start = performance.now();
      c.seek(target);
      const elapsedMs = performance.now() - start;
      seeks.push({
        target,
        replayMs,
        elapsedMs,
        sha256: createHash("sha256").update(JSON.stringify(c.snapshot())).digest("hex"),
      });
    }
    const sorted = seeks.map((s) => s.elapsedMs).sort((a, b) => a - b);
    save("seek.json", {
      revision: revision(),
      node: process.version,
      heapUsed,
      retainedTimes,
      atEnd,
      p50: sorted[11],
      p90: sorted[21],
      p95: sorted[22],
      max: sorted[23],
      seeks,
    });
  } finally {
    c.dispose();
  }
});
