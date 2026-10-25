import { describe, expect, it } from "vitest";
import { createMachine, machinePaths, machineStep } from "../lib/machine";
import { firstOpen, inStep, runnerInitial, runnerMachine, type RunnerEvent } from "./machine";

/** Three steps: two states of the diagram, then a sticky moment (traffic seen). */
const def = (resumeAt = 0, highlights = true) => ({
  ...runnerMachine,
  initial: runnerInitial([false, false, true], { highlights, resumeAt }),
});
/** Each step's check; every step settled unless said otherwise. */
const observe = (met: boolean[], settled = met.map(() => true)): RunnerEvent => ({ type: "observe", met, settled });
function play(events: RunnerEvent[], resumeAt = 0) {
  const machine = createMachine(def(resumeAt));
  const commands = events.flatMap((e) => machine.send(e).commands);
  return { state: machine.state, commands };
}

describe("tutorial step runner", () => {
  it("performs a sticky step's demo on Skip and latches only when it holds", () => {
    const definition = {
      ...runnerMachine,
      initial: runnerInitial([true, true], { highlights: true, resumeAt: 0, demos: [true, false] }),
    };
    const m = createMachine(definition);
    m.send({ type: "start" });
    expect(m.send({ type: "skip", stepId: "0" }).commands).toEqual([{ type: "demo", steps: [0] }]);
    expect(m.state.latched).toEqual([false, false]);
    m.send({ type: "observe", met: [true, false], settled: [true, true] });
    expect(m.state.index).toBe(1);
    expect(m.state.latched).toEqual([true, false]);
    m.send({ type: "skip", stepId: "1" });
    expect(m.state.value).toBe("finished");
    for (const path of machinePaths(definition, { maxDepth: 4 })) {
      expect(path.state.latched.every((on, i) => !on || path.state.sticky[i])).toBe(true);
    }
  });
  it("Skip performs a sticky edit's demo before remembering its completion", () => {
    const m = createMachine({
      ...runnerMachine,
      initial: runnerInitial([true, true], {
        highlights: true,
        resumeAt: 0,
        demos: [true, false],
      }),
    });
    m.send({ type: "start" });
    expect(m.send({ type: "skip", stepId: "0" }).commands).toEqual([{ type: "demo", steps: [0] }]);
    expect(m.state.latched).toEqual([false, false]);
    m.send(observe([true, false]));
    expect(m.state.index).toBe(1);
    m.send(observe([false, false]));
    expect(m.state.index).toBe(1);
    m.send({ type: "skip", stepId: "1" });
    expect(m.state.value).toBe("finished");
  });
  it("rejects a skip rendered for an earlier step, including a fast repeat", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    expect(m.send({ type: "skip", stepId: "0" }).commands).toEqual([{ type: "demo", steps: [0] }]);
    m.send(observe([true, false, false]));
    const stale = m.send({ type: "skip", stepId: "0" });
    expect(m.journal.at(-1)?.accepted).toBe(false);
    expect(stale.commands).toEqual([]);
    expect(stale.state.index).toBe(1);
    expect(m.send({ type: "skip", stepId: "1" }).commands).toEqual([{ type: "demo", steps: [1] }]);
  });

  it("starts in the intro, and Start goes to the first step not done", () => {
    expect(play([]).state.value).toBe("intro");
    const { state, commands } = play([observe([true, false, false]), { type: "start" }]);
    expect(state).toMatchObject({ value: "active", index: 1, last: 0 });
    expect(commands).toContainEqual({ type: "announce", step: 1 });
    expect(commands).toContainEqual({ type: "save", step: 1, completed: false });
  });

  it("passes over a step that's already done (the + also connects)", () => {
    const { state } = play([{ type: "start" }, observe([true, true, false])]);
    expect(state).toMatchObject({ value: "active", index: 2, last: 1 });
  });

  it("waits in completing while the learner is still at it, then moves on when they finish", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    // The name matches but is still being typed: done, not yet over.
    const typing = m.send(observe([true, false, false], [false, true, true]));
    expect(typing.state).toMatchObject({ value: "completing", index: 0 });
    expect(typing.commands).toEqual([]);
    // Enter: settled, so the next step.
    const entered = m.send(observe([true, false, false]));
    expect(entered.state).toMatchObject({ value: "active", index: 1, last: 0 });
    expect(entered.commands).toContainEqual({ type: "announce", step: 1 });
  });

  it("goes back a step when its check stops holding (Undo, or leaving Live)", () => {
    const { state, commands } = play([{ type: "start" }, observe([true, true, false]), observe([true, false, false])]);
    expect(state).toMatchObject({ value: "active", index: 1, last: null });
    expect(commands.at(-2)).toEqual({ type: "announce", step: 1 });
  });

  it("keeps a sticky step done once seen, and finishes when every step is held", () => {
    const { state, commands } = play([{ type: "start" }, observe([true, true, true])]);
    expect(state.value).toBe("finished");
    expect(state.latched).toEqual([false, false, true]);
    expect(commands).toContainEqual({ type: "save", step: 0, completed: true });
  });

  it("ignores observations once finished, until Restart", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    m.send(observe([true, true, true]));
    expect(m.send(observe([false, false, false])).state.value).toBe("finished");
    const restart = m.send({ type: "restart" });
    expect(restart.state).toMatchObject({ value: "active", index: 0, latched: [false, false, false] });
    expect(restart.commands[0]).toEqual({ type: "reset" });
  });

  it("Skip asks for a demo on a step that has one, and latches a moment", () => {
    const demo = play([{ type: "start" }, { type: "skip", stepId: "0" }]);
    expect(demo.state).toMatchObject({ value: "active", index: 0 });
    expect(demo.commands).toContainEqual({ type: "demo", steps: [0] });
    const moment = play([{ type: "start" }, observe([true, true, false]), { type: "skip", stepId: "2" }]);
    expect(moment.state.value).toBe("finished");
    expect(moment.state.latched[2]).toBe(true);
  });

  it("a near miss's fix is the step's own demo, and a moment has none", () => {
    expect(play([{ type: "start" }, { type: "fix" }]).commands).toContainEqual({ type: "demo", steps: [0] });
    const m = createMachine(def());
    m.send({ type: "start" });
    m.send(observe([true, true, false]));
    const before = m.state;
    expect(m.send({ type: "fix" })).toEqual({ state: before, commands: [] });
  });

  it("Show me is hinting: once per step, and over when the step changes", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    const shown = m.send({ type: "showMe" });
    expect(shown.state.value).toBe("hinting");
    expect(shown.commands).toEqual([{ type: "reveal", step: 0 }]);
    expect(m.send({ type: "showMe" }).commands).toEqual([]);
    // A fact about another step keeps the hint; this step done ends it.
    expect(m.send(observe([false, true, false])).state.value).toBe("hinting");
    expect(m.send(observe([true, true, false])).state).toMatchObject({ value: "active", index: 2 });
  });

  it("resumes at the saved step by doing the earlier ones", () => {
    const m = createMachine(def(2));
    const { state, commands } = m.send({ type: "resume" });
    expect(state).toMatchObject({ value: "reconstructing", index: 2 });
    expect(commands[0]).toEqual({ type: "reconstruct", steps: [0, 1] });
    expect(m.send(observe([true, false, false])).commands).toEqual([]);
    expect(m.state).toMatchObject({ value: "reconstructing", index: 2 });
    expect(m.send(observe([true, true, false])).commands).toEqual([]);
    const handed = m.send({ type: "reconstructed" });
    expect(handed.state).toMatchObject({ value: "active", index: 2 });
    expect(handed.commands).toContainEqual({ type: "save", step: 2, completed: false });
    expect(play([{ type: "resume" }]).state.value).toBe("intro");
  });

  it("ignores a late reconstruction completion after Exit or Restart", () => {
    for (const type of ["exit", "restart"] as const) {
      const m = createMachine(def(2));
      m.send({ type: "resume" });
      m.send({ type });
      const before = m.state;
      expect(m.send({ type: "reconstructed" })).toEqual({ state: before, commands: [] });
    }
  });

  it("keeps a sinceStep baseline for the current step only: the first reading wins, and entering empties it", () => {
    const reading = (step: number, value: number): RunnerEvent => ({
      type: "baseline",
      step,
      values: { processed: [value, 1] },
    });
    const m = createMachine(def());
    expect(m.send(reading(0, 1)).state.baseline).toEqual({});
    m.send({ type: "start" });
    expect(m.send(reading(1, 5)).state.baseline).toEqual({});
    m.send(reading(0, 3));
    expect(m.send(reading(0, 9)).state.baseline).toEqual({ processed: [3, 1] });
    // Staying on the step keeps it: Show me, a fact about another step, completing.
    m.send({ type: "showMe" });
    m.send(observe([false, true, false]));
    expect(m.send(observe([true, false, false], [false, true, true])).state).toMatchObject({
      value: "completing",
      baseline: { processed: [3, 1] },
    });
    // Moving on empties it, and so does coming back (Undo): what it counts starts again from there.
    expect(m.send(observe([true, false, false])).state).toMatchObject({ index: 1, baseline: {} });
    m.send(reading(1, 4));
    expect(m.send(observe([false, false, false])).state).toMatchObject({ index: 0, baseline: {} });
  });

  it("Skip and Restart empty the baseline, and Continue reads it only after its handover", () => {
    const reading = (step: number): RunnerEvent => ({ type: "baseline", step, values: { processed: [7, 2] } });
    const m = createMachine(def());
    m.send({ type: "start" });
    m.send(reading(0));
    // A step with a demo: Skip counts again from here, while its edit lands.
    expect(m.send({ type: "skip", stepId: "0" }).state).toMatchObject({ index: 0, baseline: {} });
    m.send(observe([true, true, false]));
    m.send(reading(2));
    // A moment: Skip latches it and forgets what it counted.
    expect(m.send({ type: "skip", stepId: "2" }).state).toMatchObject({ value: "finished", baseline: {} });
    expect(m.send(reading(2)).state.baseline).toEqual({});
    m.send({ type: "restart" });
    m.send(reading(0));
    expect(m.send({ type: "restart" }).state).toMatchObject({ index: 0, baseline: {} });

    const resumed = createMachine(def(2));
    resumed.send({ type: "resume" });
    expect(resumed.send(reading(2)).state).toMatchObject({ value: "reconstructing", baseline: {} });
    resumed.send(observe([true, true, false]));
    expect(resumed.send({ type: "reconstructed" }).state).toMatchObject({ value: "active", index: 2, baseline: {} });
    expect(resumed.send(reading(2)).state.baseline).toEqual({ processed: [7, 2] });
  });

  it("rejects an observation of the wrong length (another tutorial's checks)", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    const before = m.state;
    expect(m.send(observe([true])).state).toBe(before);
  });

  it("remembers the highlights switch, and Exit closes from any phase", () => {
    expect(play([{ type: "highlights", on: false }]).commands).toEqual([{ type: "prefs", highlights: false }]);
    for (const events of [
      [],
      [{ type: "start" }],
      [{ type: "start" }, observe([true, true, true])],
    ] as RunnerEvent[][]) {
      const { state, commands } = play([...events, { type: "exit" }]);
      expect(state.value).toBe("closed");
      expect(commands.at(-1)).toEqual({ type: "close" });
    }
  });

  it.each([false, true])("keeps its invariants on every representative path (sticky demo: %s)", (stickyDemo) => {
    const definition = stickyDemo
      ? {
          ...runnerMachine,
          initial: runnerInitial([false, true], {
            highlights: true,
            resumeAt: 0,
            demos: [true, true],
          }),
        }
      : runnerMachine;
    const paths = machinePaths(definition, { maxDepth: 4 });
    expect(new Set(paths.map((p) => p.state.value))).toEqual(
      new Set(["intro", "active", "hinting", "completing", "finished", "closed"]),
    );
    for (const { state } of paths) {
      expect(state.index).toBeGreaterThanOrEqual(0);
      expect(state.index).toBeLessThan(state.observed.length);
      if (inStep(state)) {
        // The pointer is on the first step not held, and completing means its check holds.
        expect(state.index).toBe(firstOpen(state));
        expect(state.observed[state.index]).toBe(state.value === "completing");
      }
      if (state.value === "finished") expect(firstOpen(state)).toBe(state.observed.length);
      // A baseline belongs to the current step: none in the intro, during reconstruction, once finished or closed.
      if (!inStep(state)) expect(state.baseline).toEqual({});
      state.latched.forEach((on, i) => on && expect(state.sticky[i]).toBe(true));
      if (state.value === "closed")
        for (const event of runnerMachine.events) expect(machineStep(runnerMachine, state, event).accepted).toBe(false);
    }
  });
});
