import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import kafka from "../examples/kafka-order-pipeline.json";
import { runDigest } from "../sim/digest";
import { LiveController } from "./controller";
import { emptyInputs } from "./capacityModel";
import { tickTime } from "./controlLog";

// The control log (shared Live design, P1): every change to a run is an op on the tick it lands on, and a scrub
// back or a rebuild applies the logged tweaks again on their ticks. The run digest (src/sim/digest.ts) says whether
// two runs are in the same state, bit for bit.

const diagram = kafka as unknown as DiagramFile;
/** Two minutes of steady checkouts: long enough to tweak, play on and scrub back. */
const steady: Simulation = {
  id: "steady",
  title: "Steady checkouts",
  seed: 5,
  durationMs: 120_000,
  traffic: [
    {
      id: "checkouts",
      node: "shopper",
      messageType: "OrderRequest",
      shape: { kind: "constant", ratePerSec: 300, durationMs: 120_000 },
    },
  ],
};

function controller(): LiveController {
  const c = new LiveController(diagram, { replayDelayMs: 0 });
  c.selectSimulation(steady);
  c.setPlaying(true);
  return c;
}

/** Plays 16 ms frames until the run reaches `ms` of simulated time (passing any pausing note). */
function playTo(c: LiveController, ms: number) {
  for (let guard = 0; tickTime(c.tick) < ms && guard < 100_000; guard++) {
    c.publish();
    if (c.getState().run?.waiting) c.resume();
    c.advance(16);
  }
}

/** Both runs on exactly the same tick, then their digests. */
function digestAt(c: LiveController, ms: number) {
  c.seek(ms);
  expect(tickTime(c.tick)).toBe(ms);
  return runDigest(c.simEngine);
}

const TWEAK = { node: "inventory", patch: { replicas: 1, latencyMs: 400 } };

afterEach(() => vi.useRealTimers());

describe("the control log", () => {
  it("logs each op on the tick it lands on, in order, and a restart starts a new run", () => {
    const c = controller();
    playTo(c, 1234);
    const tick = c.tick;
    c.setNodeProps(TWEAK.node, TWEAK.patch);
    c.inject("gateway", 5);
    const log = c.controlLog();
    const [props, inject] = log.slice(-2);
    expect(props).toMatchObject({ tick, op: { kind: "props", node: "inventory" } });
    expect(inject).toMatchObject({ tick, op: { kind: "inject", node: "gateway", count: 5 } });
    expect(inject.seq).toBe(props.seq + 1);
    expect(log.every((e, i) => e.seq === i + 1 && e.run === c.runId)).toBe(true);
    const run = c.runId;
    c.restart();
    expect(c.runId).toBe(run + 1);
    expect(c.controlLog().map((e) => e.op.kind)).toEqual(["restart"]);
  });

  it("each op reaches listeners as it's logged", () => {
    const c = controller();
    const seen: string[] = [];
    const off = c.onOp((e) => seen.push(`${e.tick}:${e.op.kind}`));
    playTo(c, 500);
    c.setNodeStatus("payments", "down");
    off();
    c.setNodeStatus("payments", "up");
    expect(seen).toEqual([`${c.tick}:status`]);
  });

  it("a scrub back past a live tweak keeps it: the same state as a run that never scrubbed", () => {
    // Uninterrupted: the tweak at 27 s, then on to 29 s.
    const straight = controller();
    playTo(straight, 27_000);
    straight.setNodeProps(TWEAK.node, TWEAK.patch);
    const expected = digestAt(straight, 29_000);
    // Scrubbed: the same tweak at 27 s, on to 45 s, back to 29 s. The nearest checkpoint (25 s) is from before the
    // tweak, so only the log brings it back.
    const scrubbed = controller();
    playTo(scrubbed, 27_000);
    scrubbed.setNodeProps(TWEAK.node, TWEAK.patch);
    playTo(scrubbed, 45_000);
    expect(digestAt(scrubbed, 29_000)).toBe(expected);
    expect(scrubbed.effectiveProps(TWEAK.node)).toMatchObject(TWEAK.patch);
    expect(scrubbed.getState().tweaks.get(TWEAK.node)?.props).toMatchObject(TWEAK.patch);
    // And the tweak matters: without it the state differs.
    const untouched = controller();
    playTo(untouched, 27_000);
    expect(digestAt(untouched, 29_000)).not.toBe(expected);
  });

  it("injections and statuses replay on their ticks too", () => {
    const act = (c: LiveController) => {
      playTo(c, 16_000);
      c.inject("gateway", 400);
      playTo(c, 17_000);
      c.setNodeStatus("payments", "down");
      playTo(c, 18_500);
      c.setNodeStatus("payments", "up");
    };
    const straight = controller();
    act(straight);
    const expected = digestAt(straight, 19_000);
    // Back to 19 s from 40 s: the nearest checkpoint (15 s) is from before all three.
    const scrubbed = controller();
    act(scrubbed);
    playTo(scrubbed, 40_000);
    expect(digestAt(scrubbed, 19_000)).toBe(expected);
  });

  it("fault overlays survive checkpoint seeks and rate rebuilds", () => {
    vi.useFakeTimers();
    const act = (c: LiveController) => {
      playTo(c, 16_000);
      c.setFault({ kind: "slow", node: "inventory", factor: 5 });
      playTo(c, 17_000);
      c.setFault({ kind: "slow", node: "inventory", factor: 10 });
      playTo(c, 18_000);
      c.setFault({ kind: "boundary", boundary: "aks", down: true });
      playTo(c, 18_500);
      c.setFault({ kind: "fail", node: "payments", rate: 0.5 });
    };
    const read = (c: LiveController) => ({
      faults: c.snapshot().faults,
      inventory: c.snapshot().nodes.inventory.status,
      processed: c.snapshot().nodes.inventory.processed,
      digest: runDigest(c.simEngine),
    });
    const straight = controller();
    act(straight);
    straight.seek(19_000);
    const expected = read(straight);
    // A slowdown (changed once), a boundary down and a failure rate. (This diagram has no network links to cut.)
    expect(expected.faults).toEqual([
      { kind: "slow", node: "inventory", factor: 10 },
      { kind: "boundary", boundary: "aks", down: true },
      { kind: "fail", node: "payments", rate: 0.5 },
    ]);
    // A seek back over all of them from 40 s.
    const scrubbed = controller();
    act(scrubbed);
    playTo(scrubbed, 40_000);
    scrubbed.seek(19_000);
    expect(read(scrubbed)).toEqual(expected);
    // A rebuild at 19 s (an entry rate): the overlays apply again on their ticks.
    const rated = controller();
    rated.setInputs({ ...emptyInputs(), rates: { shopper: 450 } });
    vi.runAllTimers();
    act(rated);
    rated.seek(19_000);
    const ratedExpected = read(rated);
    const rebuilt = controller();
    act(rebuilt);
    rebuilt.seek(19_000);
    rebuilt.setInputs({ ...emptyInputs(), rates: { shopper: 450 } });
    vi.runAllTimers();
    expect(read(rebuilt)).toEqual(ratedExpected);
  });

  it("scrubbing after a rate rebuild preserves later logged tweaks", () => {
    vi.useFakeTimers();
    const rates = { ...emptyInputs(), rates: { shopper: 450 } };
    const act = (c: LiveController) => {
      playTo(c, 27_000);
      c.setNodeProps(TWEAK.node, TWEAK.patch);
      playTo(c, 28_000);
      c.setNodeStatus("payments", "down");
    };
    // Uninterrupted: the rate from the start (a rebuild rewrites history), the tweak and the outage, on to 29 s.
    const straight = controller();
    straight.setInputs(rates);
    vi.runAllTimers();
    act(straight);
    const expected = digestAt(straight, 29_000);
    // The tweak and outage, on to 40 s, the rate rebuilt to 40 s, then back to 29 s: the checkpoints the rebuild
    // took record how far it had replayed, so the seek applies both again.
    const c = controller();
    act(c);
    playTo(c, 40_000);
    c.setInputs(rates);
    vi.runAllTimers();
    expect(tickTime(c.tick)).toBe(40_000);
    expect(digestAt(c, 29_000)).toBe(expected);
    expect(c.effectiveProps(TWEAK.node)).toMatchObject(TWEAK.patch);
    expect(c.snapshot().nodes.payments.status).toBe("down");
  });

  it("a newer Inputs & capacity edit of a property wins over an older live tweak, after any rebuild", () => {
    vi.useFakeTimers();
    const c = controller();
    playTo(c, 20_000);
    c.setNodeProps("inventory", { latencyMs: 400 });
    playTo(c, 25_000);
    const props = { inventory: { latencyMs: 200 } };
    c.setInputs({ ...emptyInputs(), props });
    expect(c.effectiveProps("inventory").latencyMs).toBe(200);
    playTo(c, 30_000);
    c.setInputs({ ...emptyInputs(), props, rates: { shopper: 450 } });
    vi.runAllTimers();
    expect(tickTime(c.tick)).toBe(30_000);
    // The engine agrees with the panel, and the superseded tweak isn't listed as one.
    expect(c.effectiveProps("inventory").latencyMs).toBe(200);
    expect(c.getState().inputs.props).toEqual(props);
    expect(c.getState().tweaks.get("inventory")?.props.latencyMs).toBeUndefined();
    // A tweak of another property, made before, still replays.
    const d = controller();
    playTo(d, 20_000);
    d.setNodeProps("inventory", { latencyMs: 400, replicas: 1 });
    playTo(d, 25_000);
    d.setInputs({ ...emptyInputs(), props });
    playTo(d, 30_000);
    d.setInputs({ ...emptyInputs(), props, rates: { shopper: 450 } });
    vi.runAllTimers();
    expect(d.effectiveProps("inventory")).toMatchObject({ latencyMs: 200, replicas: 1 });
  });

  it("the log owns its ops: changing an object after passing it changes neither the engine nor history", () => {
    const straight = controller();
    playTo(straight, 27_000);
    straight.setNodeProps(TWEAK.node, { ...TWEAK.patch });
    const expected = digestAt(straight, 29_000);
    const c = controller();
    playTo(c, 27_000);
    const patch: { replicas: number; latencyMs: number } = { ...TWEAK.patch };
    c.setNodeProps(TWEAK.node, patch);
    patch.latencyMs = 800;
    playTo(c, 45_000);
    expect(digestAt(c, 29_000)).toBe(expected);
    expect(c.effectiveProps(TWEAK.node).latencyMs).toBe(TWEAK.patch.latencyMs);
    const entry = c.controlLog().find((e) => e.op.kind === "props");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(entry?.op.kind === "props" && Object.isFrozen(entry.op.patch)).toBe(true);
  });

  it("keeps only the latest Inputs snapshot (a slider drag doesn't grow the log)", () => {
    const c = controller();
    playTo(c, 2_000);
    for (let i = 1; i <= 50; i++) c.setInputs({ ...emptyInputs(), traffic: 1 + i / 100 });
    expect(c.controlLog().filter((e) => e.op.kind === "inputs")).toHaveLength(1);
  });

  it("a scrub back before a tweak cuts the log there: the tweak is a branch no longer taken", () => {
    const c = controller();
    playTo(c, 20_000);
    c.setNodeProps(TWEAK.node, TWEAK.patch);
    playTo(c, 40_000);
    c.seek(10_000);
    expect(c.controlLog().some((e) => e.op.kind === "props")).toBe(false);
    expect(c.controlLog().every((e) => e.tick <= c.tick)).toBe(true);
    const untouched = controller();
    expect(digestAt(c, 30_000)).toBe(digestAt(untouched, 30_000));
    expect(c.getState().tweaks.size).toBe(0);
  });

  it("a rate change replays the run to the same moment with the earlier tweak on its tick", () => {
    vi.useFakeTimers();
    // An entry rate: the run can't take it as a patch, so it's rebuilt and replayed to the same moment.
    const inputs = { ...emptyInputs(), rates: { shopper: 450 } };
    // Rates from the start, then the tweak at 20 s: what the rebuilt run must equal.
    const rebuiltFromStart = controller();
    rebuiltFromStart.setInputs(inputs);
    vi.runAllTimers();
    playTo(rebuiltFromStart, 20_000);
    rebuiltFromStart.setNodeProps(TWEAK.node, TWEAK.patch);
    const expected = digestAt(rebuiltFromStart, 30_000);
    // The tweak at 20 s, then the new rate at 30 s: the run replays to 30 s with both.
    const c = controller();
    playTo(c, 20_000);
    c.setNodeProps(TWEAK.node, TWEAK.patch);
    playTo(c, 30_000);
    c.setInputs(inputs);
    vi.runAllTimers();
    expect(tickTime(c.tick)).toBe(30_000);
    expect(runDigest(c.simEngine)).toBe(expected);
    expect(c.getState().tweaks.get(TWEAK.node)?.props).toMatchObject(TWEAK.patch);
  });

  it("tweaks stay run-only: nothing in the log writes the diagram", () => {
    const c = controller();
    const before = JSON.stringify(c.currentDiagram);
    playTo(c, 5_000);
    c.setNodeProps(TWEAK.node, TWEAK.patch);
    c.setNodeStatus("payments", "down");
    c.inject("gateway", 10);
    expect(JSON.stringify(c.currentDiagram)).toBe(before);
  });
});

describe("the run digest", () => {
  it("doesn't depend on frame length: one long step equals many short frames", () => {
    const frames = controller();
    playTo(frames, 20_000);
    const long = controller();
    long.advance(20_000);
    expect(tickTime(long.tick)).toBe(tickTime(frames.tick));
    expect(runDigest(long.simEngine)).toBe(runDigest(frames.simEngine));
  });

  it("is the same for the same run, and moves as the run does", () => {
    const a = controller();
    const b = controller();
    playTo(a, 10_000);
    playTo(b, 10_000);
    expect(runDigest(a.simEngine)).toBe(runDigest(b.simEngine));
    const at10 = runDigest(a.simEngine);
    playTo(a, 15_000);
    expect(runDigest(a.simEngine)).not.toBe(at10);
    expect(runDigest(a.simEngine)).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(runDigest(a.simEngine))).toBe(true);
  });
});
