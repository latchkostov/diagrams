import { expect, it } from "vitest";
import { createMachine, machinePaths, machineStep } from "../../lib/machine";
import { buildScript } from "./script";
import { slowMachine, type SlowEvent } from "./machine";
import type { MessageTrace } from "../../sim/types";
import type { DiagramLike } from "../../trace/journey";

const trace: MessageTrace = {
  rootId: 1,
  type: "request",
  origin: "a",
  startedAt: 0,
  endedAt: 10,
  done: true,
  partial: false,
  truncated: false,
  steps: [],
};
const diagram: DiagramLike = { nodes: [], edges: [] };
const script = buildScript({ trace, diagram, roleOf: () => "processor" });
const events: SlowEvent[] = [
  { type: "start", source: { kind: "next" } },
  { type: "captureProgress", epoch: 1, loading: true },
  { type: "captureEmpty", epoch: 1 },
  { type: "captureRefused", epoch: 1 },
  { type: "chunkFailure", epoch: 1, source: { kind: "next" } },
  { type: "play" },
  { type: "pause" },
  { type: "restart" },
  { type: "seek", t: 10 },
  { type: "step", t: 0 },
  { type: "tick", wallMs: Number.MAX_SAFE_INTEGER, speed: 1 },
  { type: "speed", speed: 0.5 },
  { type: "exit" },
  { type: "Escape" },
  { type: "liveChanged" },
  { type: "roomChanged" },
];
const done: SlowEvent = { type: "captureDone", epoch: 1, script, trace };

it("covers every reachable mode and event through executable paths of depth four", () => {
  const def = { ...slowMachine, events: [...events, done] };
  const paths = machinePaths(def, { maxDepth: 4 });
  expect(new Set(paths.map((p) => p.state.value))).toEqual(new Set(def.states));
  const covered = new Set<string>();
  for (const path of paths) {
    const s = path.state;
    expect(path.events.length).toBeLessThanOrEqual(4);
    expect(s.playing).toBe(s.value === "playing");
    expect(s.status === "on").toBe(["playing", "paused", "finished"].includes(s.value));
    expect(s.t).toBeGreaterThanOrEqual(0);
    if (s.script) expect(s.t).toBeLessThanOrEqual(s.script.duration);
    else expect(s.trace).toBeNull();
    // Exercise all event representatives at each reached state, including ignored events.
    for (const event of def.events) {
      const result = machineStep(def, s, event);
      covered.add(event.type);
      if (!result.accepted) expect(result.state).toBe(s);
    }
  }
  expect(covered).toEqual(new Set(def.events.map((e) => e.type)));
});

it("rejects a late capture completion and failure after Escape and a new start", () => {
  const m = createMachine(slowMachine);
  m.send({ type: "start", source: { kind: "next" } });
  m.send({ type: "Escape" });
  m.send({ type: "start", source: { kind: "next" } });
  const before = m.state;
  expect(m.send(done)).toEqual({ state: before, commands: [] });
  expect(m.send({ type: "chunkFailure", epoch: 1, source: { kind: "next" } })).toEqual({ state: before, commands: [] });
});

it("claims capture before it begins and plans the take before React renders it", () => {
  const m = createMachine(slowMachine);
  expect(m.send({ type: "start", source: { kind: "next" } }).commands).toEqual([
    { type: "camera", on: true },
    { type: "capture", source: { kind: "next" }, previous: "off" },
  ]);
  expect(m.send(done).commands).toEqual([{ type: "replay" }, { type: "camera", on: true, take: true }]);
  expect(m.send({ type: "Escape" }).commands).toContainEqual({ type: "camera", on: false, restore: true });
});
