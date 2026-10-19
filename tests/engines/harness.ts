// Runs in the browser under test (tests/engines/digest.spec.ts), and in Node for the expected values: the live
// view's own controller playing a saved simulation, with live tweaks and a scrub back on the way, reporting the run
// digest (src/sim/digest.ts) every 5 simulated seconds and each node's latency percentiles at the end.

import type { DiagramFile, Simulation } from "../../src/model/types";
import { snapshotDigest } from "../../src/sim/digest";
import { LiveController } from "../../src/live/controller";
import { tickTime } from "../../src/live/controlLog";

/** A run's digest, from the controller's detached digest inputs (as shared Live computes it). */
const digestOf = (c: LiveController) => {
  const { snapshot, draws } = c.digestInputs();
  return snapshotDigest(snapshot, draws);
};

export interface EngineRun {
  digests: [ms: number, digest: number][];
  latency: Record<string, [number, number, number]>;
  ms: number;
}

/** Plays `simulation` to `untilMs` (or its end) in 1 s frames, with the same ops every time. */
export function playDigests(diagram: DiagramFile, simulation: Simulation, untilMs: number): EngineRun {
  const c = new LiveController(diagram, { replayDelayMs: 0 });
  c.selectSimulation(simulation);
  c.setPlaying(true);
  const digests: EngineRun["digests"] = [];
  const target = Math.min(untilMs, c.getState().run?.totalMs ?? untilMs);
  const nodes = diagram.nodes.map((n) => n.id);
  // A tweak, an injection and an outage at fixed moments, then a scrub back over all of them.
  const ops: [number, () => void][] = [
    [6_000, () => nodes[1] && c.setNodeProps(nodes[1], { latencyMs: 120 })],
    [9_000, () => nodes[0] && c.inject(nodes[0], 50)],
    [11_000, () => nodes[2] && c.setNodeStatus(nodes[2], "down")],
    [13_000, () => nodes[2] && c.setNodeStatus(nodes[2], "up")],
  ];
  let scrubbed = false;
  let nextDigest = 5_000;
  for (let guard = 0; guard < 10_000; guard++) {
    // The published state lags behind advance(): publish first, so a waiting note or the end is seen.
    c.publish();
    const run = c.getState().run;
    const now = tickTime(c.tick);
    if (run?.done || now >= target) break;
    if (run?.waiting) {
      c.resume();
      continue;
    }
    for (let next = ops[0]; next && now >= next[0]; next = ops[0]) {
      ops.shift();
      next[1]();
    }
    if (!scrubbed && now >= 18_000) {
      scrubbed = true;
      c.seek(7_000);
      nextDigest = 10_000;
      continue;
    }
    c.advance(1000);
    // Every 5 s of simulated time (a note's pause shifts the ticks it lands on: the same in every engine).
    const t = tickTime(c.tick);
    if (t >= nextDigest) {
      digests.push([t, digestOf(c)]);
      while (nextDigest <= t) nextDigest += 5_000;
    }
  }
  // And where it ended (a short simulation may end before its first 5 s).
  digests.push([tickTime(c.tick), digestOf(c)]);
  const snapshot = c.snapshot();
  const latency: EngineRun["latency"] = {};
  for (const [id, node] of Object.entries(snapshot.nodes))
    if (node.latency) latency[id] = [node.latency.p50, node.latency.p95, node.latency.p99];
  return { digests, latency, ms: tickTime(c.tick) };
}

(globalThis as unknown as { __playDigests?: typeof playDigests }).__playDigests = playDigests;
