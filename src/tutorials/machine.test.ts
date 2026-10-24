import { describe, expect, it } from "vitest";
import { createMachine, machinePaths, machineStep } from "../lib/machine";
import { firstOpen, runnerInitial, runnerMachine, type RunnerEvent } from "./machine";

/** Three steps: two states of the diagram, then a sticky moment (traffic seen). */
const def = (resumeAt = 0, highlights = true) => ({
  ...runnerMachine,
  initial: runnerInitial([false, false, true], { highlights, resumeAt }),
});
const observe = (...met: boolean[]): RunnerEvent => ({ type: "observe", met });
function play(events: RunnerEvent[], resumeAt = 0) {
  const machine = createMachine(def(resumeAt));
  const commands = events.flatMap((e) => machine.send(e).commands);
  return { state: machine.state, commands };
}

describe("tutorial step runner", () => {
  it("starts in the intro, and Start goes to the first step not done", () => {
    expect(play([]).state.value).toBe("intro");
    const { state, commands } = play([observe(true, false, false), { type: "start" }]);
    expect(state).toMatchObject({ value: "step", index: 1, last: 0 });
    expect(commands).toContainEqual({ type: "announce", step: 1 });
    expect(commands).toContainEqual({ type: "save", step: 1, completed: false });
  });

  it("passes over a step that's already done (the + also connects)", () => {
    const { state } = play([{ type: "start" }, observe(true, true, false)]);
    expect(state).toMatchObject({ value: "step", index: 2, last: 1 });
  });

  it("goes back a step when its check stops holding (Undo, or leaving Live)", () => {
    const { state, commands } = play([{ type: "start" }, observe(true, true, false), observe(true, false, false)]);
    expect(state).toMatchObject({ value: "step", index: 1, last: null });
    expect(commands.at(-2)).toEqual({ type: "announce", step: 1 });
  });

  it("keeps a sticky step done once seen, and finishes when every step is held", () => {
    const { state, commands } = play([{ type: "start" }, observe(true, true, true)]);
    expect(state.value).toBe("finished");
    expect(state.latched).toEqual([false, false, true]);
    expect(commands).toContainEqual({ type: "save", step: 0, completed: true });
  });

  it("ignores observations once finished, until Restart", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    m.send(observe(true, true, true));
    expect(m.send(observe(false, false, false)).state.value).toBe("finished");
    const restart = m.send({ type: "restart" });
    expect(restart.state).toMatchObject({ value: "step", index: 0, latched: [false, false, false] });
    expect(restart.commands[0]).toEqual({ type: "reset" });
  });

  it("Skip asks for a demo on a step that has one, and latches a moment", () => {
    const demo = play([{ type: "start" }, { type: "skip" }]);
    expect(demo.state).toMatchObject({ value: "step", index: 0 });
    expect(demo.commands).toContainEqual({ type: "demo", steps: [0] });
    const moment = play([{ type: "start" }, observe(true, true, false), { type: "skip" }]);
    expect(moment.state.value).toBe("finished");
    expect(moment.state.latched[2]).toBe(true);
  });

  it("Show me reveals once per step and resets when the step changes", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    expect(m.send({ type: "showMe" }).commands).toEqual([{ type: "reveal", step: 0 }]);
    expect(m.send({ type: "showMe" }).commands).toEqual([]);
    expect(m.state.shown).toBe(true);
    m.send(observe(true, false, false));
    expect(m.state.shown).toBe(false);
  });

  it("resumes at the saved step by doing the earlier ones", () => {
    const { state, commands } = play([{ type: "resume" }], 2);
    expect(state).toMatchObject({ value: "step", index: 2 });
    expect(commands[0]).toEqual({ type: "demo", steps: [0, 1] });
    // Without saved progress there's nothing to resume.
    expect(play([{ type: "resume" }]).state.value).toBe("intro");
  });

  it("rejects an observation of the wrong length (another tutorial's checks)", () => {
    const m = createMachine(def());
    m.send({ type: "start" });
    const before = m.state;
    expect(m.send(observe(true)).state).toBe(before);
  });

  it("remembers the highlights switch and Exit closes from any phase", () => {
    expect(play([{ type: "highlights", on: false }]).commands).toEqual([{ type: "prefs", highlights: false }]);
    for (const events of [[], [{ type: "start" }], [{ type: "start" }, observe(true, true, true)]] as RunnerEvent[][]) {
      const { state, commands } = play([...events, { type: "exit" }]);
      expect(state.value).toBe("closed");
      expect(commands.at(-1)).toEqual({ type: "close" });
    }
  });

  it("keeps its invariants on every representative path", () => {
    const paths = machinePaths(runnerMachine, { maxDepth: 4 });
    expect(new Set(paths.map((p) => p.state.value))).toEqual(new Set(["intro", "step", "finished", "closed"]));
    for (const { state } of paths) {
      expect(state.index).toBeGreaterThanOrEqual(0);
      expect(state.index).toBeLessThan(state.observed.length);
      // The pointer is on the first open step whenever a step is shown.
      if (state.value === "step") expect(state.index).toBe(Math.min(firstOpen(state), state.observed.length - 1));
      // Only sticky steps latch.
      state.latched.forEach((on, i) => on && expect(state.sticky[i]).toBe(true));
      // Nothing comes back from closed.
      if (state.value === "closed")
        for (const event of runnerMachine.events) expect(machineStep(runnerMachine, state, event).accepted).toBe(false);
    }
  });
});
