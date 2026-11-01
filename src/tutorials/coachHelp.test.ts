import { afterEach, expect, it, vi } from "vitest";
import { machinePaths } from "../lib/machine";
import { COACH_NUDGE_MS, coachHelpMachine, createCoachHelp } from "./coachHelp";

afterEach(() => vi.useRealTimers());
it("offers every help rung before and after the nudge, without advancing the lesson", () => {
  for (const path of machinePaths(coachHelpMachine, { maxDepth: 4 })) {
    expect(path.state.route).toBeGreaterThanOrEqual(0);
    expect(typeof path.state.hint).toBe("boolean");
    expect(typeof path.state.folded).toBe("boolean");
  }
  const help = createCoachHelp();
  help.send({ type: "hint" });
  expect(help.getSnapshot().hint).toBe(true);
  help.send({ type: "elapsed" });
  expect(help.getSnapshot().value).toBe("nudged");
  help.send({ type: "hint" });
  expect(help.getSnapshot()).toMatchObject({ value: "nudged", hint: false });
  help.send({ type: "route", route: 1 });
  expect(help.getSnapshot()).toMatchObject({ value: "waiting", route: 1, hint: false, folded: false });
});
it("nudges once at forty seconds, resets on progress and cancels when the step leaves", () => {
  vi.useFakeTimers();
  const help = createCoachHelp();
  const changed = vi.fn();
  help.subscribe(changed);
  const disconnect = help.connect();
  vi.advanceTimersByTime(COACH_NUDGE_MS - 1);
  expect(help.getSnapshot().value).toBe("waiting");
  help.progress();
  vi.advanceTimersByTime(COACH_NUDGE_MS - 1);
  expect(help.getSnapshot().value).toBe("waiting");
  vi.advanceTimersByTime(1);
  expect(help.getSnapshot().value).toBe("nudged");
  const calls = changed.mock.calls.length;
  vi.advanceTimersByTime(COACH_NUDGE_MS * 2);
  expect(changed).toHaveBeenCalledTimes(calls);
  help.progress();
  disconnect();
  vi.advanceTimersByTime(COACH_NUDGE_MS);
  expect(help.getSnapshot().value).toBe("waiting");
  expect(vi.getTimerCount()).toBe(0);
});

it("starts a fresh wait after a retry reconnects the same step", () => {
  vi.useFakeTimers();
  const help = createCoachHelp();
  const disconnect = help.connect();
  vi.advanceTimersByTime(COACH_NUDGE_MS);
  expect(help.getSnapshot().value).toBe("nudged");
  disconnect();
  const again = help.connect();
  expect(help.getSnapshot().value).toBe("waiting");
  vi.advanceTimersByTime(COACH_NUDGE_MS);
  expect(help.getSnapshot().value).toBe("nudged");
  again();
});
