import { expect, expectTypeOf, it } from "vitest";
import { createMachine, defineMachine, describeMachine, machinePaths, type Transition } from "./machine";

type State = { value: "idle" | "running"; count: number };
type Event = { type: "start"; allowed: boolean } | { type: "stop" };
const def = defineMachine<State, Event, string>({
  initial: { value: "idle", count: 0 },
  states: ["idle", "running"],
  events: [{ type: "start", allowed: false }, { type: "start", allowed: true }, { type: "stop" }],
  on: {
    idle: {
      start: [
        {
          target: "running",
          guard: (_s, e) => e.allowed,
          reduce: (s) => ({ ...s, count: s.count + 1 }),
          effects: () => ["begin"],
        },
        { target: "idle", effects: () => ["refused"] },
      ],
    },
    running: { stop: { target: "idle", effects: () => ["cancel"] } },
  },
});

it("decides the first passing guard and returns commands without running work", () => {
  const m = createMachine(def);
  expect(m.send({ type: "stop" })).toEqual({ state: def.initial, commands: [] });
  expect(m.journal[0].accepted).toBe(false);
  expect(m.send({ type: "start", allowed: false }).commands).toEqual(["refused"]);
  expect(m.send({ type: "start", allowed: true })).toEqual({
    state: { value: "running", count: 1 },
    commands: ["begin"],
  });
  expect(def.initial.count).toBe(0);
});

it("keeps only the newest causes in chronological order across ring wraps", () => {
  const m = createMachine(def, { journalSize: 2 });
  for (let i = 0; i < 7; i++) m.send({ type: "stop" });
  expect(m.journal.map((e) => e.seq)).toEqual([6, 7]);
  const copy = m.journal;
  m.send({ type: "start", allowed: true });
  expect(copy.map((e) => e.seq)).toEqual([6, 7]);
  expect(m.journal.map((e) => e.seq)).toEqual([7, 8]);
  const silent = createMachine(def, { journalSize: 0 });
  silent.send({ type: "stop" });
  expect(silent.journal).toEqual([]);
  expect(() => createMachine(def, { journalSize: -1 })).toThrow();
});

it("enumerates executable payload paths and honours the depth, including zero", () => {
  expect(machinePaths(def, { maxDepth: 0 })).toEqual([{ state: def.initial, events: [] }]);
  const paths = machinePaths(def, { maxDepth: 4 });
  expect(new Set(paths.map((p) => p.state.value))).toEqual(new Set(def.states));
  for (const path of paths) {
    const m = createMachine(def);
    for (const e of path.events) m.send(e);
    expect(m.state).toEqual(path.state);
    expect(path.events.length).toBeLessThanOrEqual(4);
  }
  expect(() => machinePaths(def, { maxDepth: -1 })).toThrow();
});

it("describes the same transition table as a dev Mermaid statechart", () => {
  expect(describeMachine(def)).toContain("idle --> running: start [guard]");
  expect(describeMachine(def)).toContain("running --> idle: stop");
});

it("requires the target variant's payload and preserves it after narrowing", () => {
  type Variant = { value: "idle" } | { value: "ready"; script: string };
  type Load = { type: "load"; script: string };
  type Row = Transition<Variant, Load, string>;
  expectTypeOf<{ target: "ready" }>().not.toExtend<Row>();
  expectTypeOf<{ target: "ready"; reduce: () => { value: "idle" } }>().not.toExtend<Row>();
  expectTypeOf<{ target: "ready"; reduce: () => { value: "ready" } }>().not.toExtend<Row>();
  const machine = createMachine(
    defineMachine<Variant, Load, string>({
      initial: { value: "idle" },
      states: ["idle", "ready"],
      events: [{ type: "load", script: "journey" }],
      on: {
        idle: {
          load: {
            target: "ready",
            reduce: (_s, e) => ({ value: "ready", script: e.script }),
            effects: (_s, _e, next) => [next.script],
          },
        },
      },
    }),
  );
  expect(machine.send({ type: "load", script: "journey" }).commands).toEqual(["journey"]);
  const state = machine.state;
  expect(state.value).toBe("ready");
  if (state.value === "ready") expect(state.script).toBe("journey");
});
