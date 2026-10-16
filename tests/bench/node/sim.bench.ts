// The simulation, without the browser (docs/BENCHMARKS.md § Metrics): loading a diagram into the engine, the live
// view's per-frame main-thread work (LiveController.advance and snapshot, as LiveSession's tick does them, with a
// publish every UI_MS) at three message rates, the engine's own step, frame() and snapshot(), and playing a saved
// simulation to the end. The particle drawing is the browser's (tests/bench/ui/live.bench.ts).
//
// Message rates: "x1" is free play as it opens (the sources' own rates at the automatic dot scale: about 60 dots a
// second in all, src/sim/scale.ts); "x10" and "x100" set Traffic × to 10 and 100 at the same dot scale, so ten and a
// hundred times as many dots play (until the engine's source budget of 10,000 sampled messages a second stops them).
//
// Gates: loading, frame() and snapshot() grow linearly; a tick with nothing moving grows at most linearly; the same
// seed plays the same run (the determinism every other number rests on).

import { LiveController } from "../../../src/live/controller";
import { emptyInputs, freePlayScale } from "../../../src/live/capacityModel";
import { createEngine } from "../../../src/sim/engine";
import { createSimulationRun } from "../../../src/sim/simulation";
import type { DiagramFile } from "../../../src/model/types";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { serviceMesh } from "../../../src/bench/workloads/mesh";
import {
  cases,
  GATE_LARGE,
  GATE_SMALL,
  measure,
  measureFresh,
  MODE,
  samplesFor,
  suite,
  workload,
  workloadInfo,
} from "./harness";

const s = suite("sim");

/** 60 frames a second, as requestAnimationFrame runs them. */
const FRAME_MS = 1000 / 60;
/** LiveSession publishes the controller's state for React every UI_MS (src/live/LiveSession.tsx). */
const UI_EVERY = Math.round(125 / FRAME_MS);
const RATES = { x1: 1, x10: 10, x100: 100 } as const;

/** A free-play controller playing continuous traffic at `factor` times the sources' rates, one dot scale, warmed up 5 s. */
function liveController(d: DiagramFile, factor: number) {
  const c = new LiveController(d, { seed: 7, replayDelayMs: 0 });
  if (factor !== 1) c.setInputs({ ...emptyInputs(), traffic: factor, scale: freePlayScale(d, emptyInputs()) });
  c.flush();
  c.setTraffic(true);
  c.setPlaying(true);
  for (let i = 0; i < 300; i++) frame(c, i);
  return c;
}

/** What LiveSession's requestAnimationFrame tick asks of the controller. */
function frame(c: LiveController, i: number) {
  c.advance(FRAME_MS);
  c.snapshot();
  if (i % UI_EVERY === 0) c.publish();
}

const LIVE_FAMILIES = ["pipeline", "mesh", "examples"] as const;

for (const { family, n, title } of cases(LIVE_FAMILIES))
  s.timing(`live frames ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    for (const [rate, factor] of Object.entries(RATES)) {
      const c = liveController(d, factor);
      let i = 0;
      // A batch of 60 frames (one second of playback) per sample, so each sample sees the UI publishes too.
      const st = measure(
        () => {
          for (let k = 0; k < 60; k++) frame(c, i++);
        },
        { samples: MODE === "quick" ? 5 : 9, warmup: 1, minMs: 1 },
      );
      const perFrame = {
        ...st,
        median: st.median / 60,
        p90: st.p90 / 60,
        min: st.min / 60,
        max: st.max / 60,
        mean: st.mean / 60,
      };
      s.time(
        "liveFrame",
        perFrame,
        w,
        rate,
        "main-thread ms per animation frame: advance + snapshot (+ publish every 125 ms)",
      );
      const snap = c.snapshot();
      s.count("liveParticles", snap.particles.length, { w, detail: rate });
      s.count("liveInSystem", snap.inSystem, { w, detail: rate });
      s.count("liveTrafficLimited", c.trafficHint() ? 1 : 0, { w, detail: rate });
      c.dispose();
    }
  });

for (const { family, n, title } of cases(LIVE_FAMILIES))
  s.timing(`engine ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    const engine = createEngine({ seed: 1 });
    s.time(
      "engineLoad",
      measure(() => engine.load(d), { samples: samplesFor(n) }),
      w,
    );
    // Steady free-play traffic as it opens, warmed up 5 s.
    const c = liveController(d, 1);
    const e = (c as unknown as { engine: ReturnType<typeof createEngine> }).engine;
    s.time(
      "engineStep",
      measure(() => e.step(FRAME_MS), { samples: samplesFor(n) }),
      w,
      "x1",
    );
    s.time(
      "engineFrame",
      measure(() => e.frame(), { samples: samplesFor(n) }),
      w,
      "x1",
    );
    s.time(
      "engineSnapshot",
      measure(() => e.snapshot(), { samples: samplesFor(n) }),
      w,
      "x1",
    );
    c.dispose();
  });

// A saved simulation played to the end, as Run simulations and a recording do (the pipeline's two).
for (const { family, n, title } of cases(["pipeline"]))
  s.timing(`saved simulations ${title}`, () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    for (const sim of d.simulations ?? []) {
      const play = () => {
        const run = createSimulationRun(d, sim);
        for (let i = 0; i < 60_000 && !run.state().done; i++) run.step(100);
        return run;
      };
      const st = measureFresh(() => play, { samples: n >= 1_500 ? 3 : 5, warmup: 0 });
      s.time("savedSimulation", st, w, sim.id);
      const run = play();
      s.count("savedSimulation-simulatedMs", Math.round(run.state().time), { w, detail: sim.id, unit: "ms" });
    }
  });

s.gating("loading, frames and snapshots grow linearly", () => {
  for (const [name, make] of [
    ["pipeline", eventPipeline],
    ["mesh", serviceMesh],
  ] as const) {
    const small = make(GATE_SMALL);
    const large = make(GATE_LARGE);
    const es = createEngine({ seed: 1 });
    const el = createEngine({ seed: 1 });
    s.growth(
      `engineLoad-${name}`,
      () => es.load(small),
      () => el.load(large),
    );
    const cs = liveController(small, 1);
    const cl = liveController(large, 1);
    const engines = [cs, cl].map((c) => (c as unknown as { engine: ReturnType<typeof createEngine> }).engine);
    s.growth(
      `engineFrame-${name}`,
      () => engines[0].frame(),
      () => engines[1].frame(),
    );
    s.growth(
      `engineSnapshot-${name}`,
      () => engines[0].snapshot(),
      () => engines[1].snapshot(),
    );
    cs.dispose();
    cl.dispose();
  }
});

s.gating("a tick with nothing moving grows at most linearly", () => {
  const small = createEngine({ seed: 1 });
  const large = createEngine({ seed: 1 });
  small.load(eventPipeline(GATE_SMALL));
  large.load(eventPipeline(GATE_LARGE));
  s.growth(
    "idleTick",
    () => small.step(FRAME_MS),
    () => large.step(FRAME_MS),
  );
});

s.gating("the same seed plays the same run", () => {
  const d = eventPipeline(GATE_SMALL);
  const sim = d.simulations?.[0];
  if (!sim) throw new Error("the pipeline saves simulations");
  const play = () => {
    const run = createSimulationRun(d, sim);
    for (let i = 0; i < 200; i++) run.step(100);
    const snap = run.engine.snapshot();
    return Object.values(snap.nodes).reduce((sum, x) => sum + x.processed * 3 + x.failed * 5 + x.deadLettered * 7, 0);
  };
  const a = play();
  const b = play();
  s.count("determinism-checksum-delta", Math.abs(a - b), { limit: 0, op: "==", why: "same seed, same counters" });
});
