import { defineMachine, type Transition } from "../../lib/machine";
import type { SlowSource, SlowState } from "./session";
import type { SlowScript } from "./script";
import type { MessageTrace } from "../../sim/types";

export type SlowPhase = "idle" | "capturing" | "armed" | "playing" | "paused" | "finished" | "cancelled" | "error";
export interface SlowMachineState extends SlowState {
  value: SlowPhase;
  /** Identity of asynchronous capture work; late completions never revive an exited take. */
  epoch: number;
}
export type SlowEvent =
  | { type: "start"; source: SlowSource }
  | { type: "captureProgress"; epoch: number; loading: boolean }
  | { type: "captureDone"; epoch: number; script: SlowScript; trace: MessageTrace }
  | { type: "captureEmpty"; epoch: number; node?: string }
  | { type: "captureRefused"; epoch: number }
  | { type: "chunkFailure"; epoch: number; source: SlowSource }
  | { type: "play" | "pause" | "restart" | "exit" | "Escape" | "liveChanged" | "roomChanged" }
  | { type: "seek" | "step"; t: number }
  | { type: "tick"; wallMs: number; speed: number }
  | { type: "speed"; speed: number };
export type SlowCommand =
  | { type: "capture"; source: SlowSource; previous: SlowState["status"] }
  | { type: "release"; resume: boolean; discard?: boolean }
  | { type: "armed" }
  | { type: "replay" }
  | { type: "unavailable"; source: SlowSource }
  | { type: "camera"; on: boolean; take?: boolean; restore?: boolean }
  | { type: "speed"; speed: number };

export const slowInitial: SlowMachineState = {
  value: "idle",
  epoch: 0,
  status: "off",
  playing: false,
  t: 0,
  script: null,
  trace: null,
  take: 0,
  activeRows: [],
  real: 0,
  caption: "",
  done: false,
  loading: false,
};
const clear = (s: SlowMachineState): SlowMachineState => ({ ...slowInitial, epoch: s.epoch + 1, take: s.take });
const current = (s: SlowMachineState, e: { epoch: number }) => s.epoch === e.epoch;
const exit: Transition<SlowMachineState, SlowEvent, SlowCommand> = {
  target: "cancelled",
  guard: (s) => s.status !== "off",
  reduce: clear,
  effects: (s) => [
    { type: "release", resume: true },
    { type: "camera", on: false, restore: s.status === "on" },
  ],
};
const play: Transition<SlowMachineState, SlowEvent, SlowCommand> = {
  target: "playing",
  reduce: (s) => ({
    ...s,
    playing: true,
    t: s.t >= s.script!.duration ? 0 : s.t,
    take: s.t >= s.script!.duration ? s.take + 1 : s.take,
  }),
  effects: (s, _e, n) => (n.take !== s.take ? [{ type: "camera", on: true, take: true }] : []),
};
const seek = (
  target: SlowPhase,
): Transition<SlowMachineState, Extract<SlowEvent, { type: "seek" | "step" }>, SlowCommand> => ({
  target,
  guard: (_s, e) => Number.isFinite(e.t),
  reduce: (s, e) => ({
    ...s,
    t: Math.max(0, Math.min(s.script!.duration, e.t)),
    playing: e.type === "step" ? false : s.playing,
  }),
});
const replayRows = (phase: "playing" | "paused" | "finished") => ({
  play,
  roomChanged: { target: phase, effects: (): SlowCommand[] => [{ type: "camera", on: true, take: true }] },
  pause: { target: "paused" as const, reduce: (s: SlowMachineState) => ({ ...s, playing: false }) },
  restart: {
    target: "playing" as const,
    reduce: (s: SlowMachineState) => ({ ...s, t: 0, playing: true, take: s.take + 1 }),
    effects: (): SlowCommand[] => [{ type: "camera", on: true, take: true }],
  },
  seek: seek(phase === "playing" ? "playing" : "paused"),
  step: seek("paused"),
  speed: {
    target: phase,
    guard: (_s: SlowMachineState, e: { speed: number }) => Number.isFinite(e.speed) && e.speed > 0,
    effects: (_s: SlowMachineState, e: { speed: number }): SlowCommand[] => [{ type: "speed", speed: e.speed }],
  },
});

export const slowMachine = defineMachine<SlowMachineState, SlowEvent, SlowCommand>({
  initial: slowInitial,
  states: ["idle", "capturing", "armed", "playing", "paused", "finished", "cancelled", "error"],
  events: [],
  on: {
    "*": {
      start: {
        target: "capturing",
        reduce: (s) => ({ ...clear(s), status: "capturing" }),
        effects: (s, e) => [
          { type: "camera", on: true },
          { type: "capture", source: e.source, previous: s.status },
        ],
      },
      exit,
      Escape: exit,
      liveChanged: {
        target: "idle",
        reduce: clear,
        effects: () => [
          { type: "release", resume: false, discard: true },
          { type: "camera", on: false },
        ],
      },
    },
    capturing: {
      captureProgress: { target: "capturing", guard: current, reduce: (s, e) => ({ ...s, loading: e.loading }) },
      captureDone: {
        target: "playing",
        guard: current,
        reduce: (s, e) => ({
          ...s,
          status: "on",
          script: e.script,
          trace: e.trace,
          loading: false,
          playing: true,
          take: s.take + 1,
        }),
        effects: () => [{ type: "replay" }, { type: "camera", on: true, take: true }],
      },
      captureEmpty: {
        target: "armed",
        guard: current,
        reduce: (s, e) => ({ ...s, status: "armed", loading: false, armedAt: e.node }),
        effects: () => [{ type: "armed" }, { type: "camera", on: false }],
      },
      captureRefused: {
        target: "cancelled",
        guard: current,
        reduce: clear,
        effects: () => [
          { type: "release", resume: false },
          { type: "camera", on: false },
        ],
      },
      chunkFailure: {
        target: "error",
        guard: current,
        reduce: clear,
        effects: (_s, e) => [
          { type: "release", resume: true },
          { type: "camera", on: false },
          { type: "unavailable", source: e.source },
        ],
      },
    },
    playing: {
      ...replayRows("playing"),
      tick: [
        {
          target: "finished",
          guard: (s, e) => e.wallMs > 0 && s.t + e.wallMs * e.speed >= s.script!.duration,
          reduce: (s) => ({ ...s, t: s.script!.duration, playing: false }),
        },
        {
          target: "playing",
          guard: (_s, e) => e.wallMs > 0,
          reduce: (s, e) => ({ ...s, t: s.t + e.wallMs * e.speed }),
        },
      ],
    },
    paused: replayRows("paused"),
    finished: replayRows("finished"),
  },
});
