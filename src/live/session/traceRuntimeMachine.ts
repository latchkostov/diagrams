import { defineMachine } from "../../lib/machine";
import type { SlowSource } from "../slowmo/session";

/** Last request wins until handoff. Downloading never owns the camera. Cancellation retires
 * the command, including after failure; readiness alone cannot resurrect it. */
export interface RuntimeState {
  value: "idle" | "waiting" | "failed" | "ready" | "disposed";
  source: SlowSource | null;
}
export type RuntimeEvent =
  { type: "request"; source: SlowSource } | { type: "ready" | "failure" | "cancel" | "dispose" | "connect" };
export type RuntimeCommand = "preserve" | "release" | "handoff";
export const traceRuntimeMachine = defineMachine<RuntimeState, RuntimeEvent, RuntimeCommand>({
  initial: { value: "idle", source: null },
  states: ["idle", "waiting", "failed", "ready", "disposed"],
  events: [
    { type: "request", source: { kind: "next", node: "source" } },
    { type: "request", source: { kind: "root", rootId: 1 } },
    { type: "ready" },
    { type: "failure" },
    { type: "cancel" },
    { type: "dispose" },
  ],
  on: {
    "*": {
      request: {
        target: "waiting",
        guard: (s) => s.value !== "disposed",
        reduce: (s, e) => ({ ...s, source: e.source }),
        effects: (s) => (s.source ? [] : ["preserve"]),
      },
      cancel: {
        target: "idle",
        guard: (s) => s.value !== "disposed",
        reduce: () => ({ value: "idle", source: null }),
        effects: (s) => (s.source ? ["release"] : []),
      },
      dispose: {
        target: "disposed",
        reduce: () => ({ value: "disposed", source: null }),
        effects: (s) => (s.source ? ["release"] : []),
      },
    },
    disposed: { connect: { target: "idle" } },
    waiting: {
      ready: {
        target: "ready",
        reduce: () => ({ value: "ready", source: null }),
        effects: () => ["handoff"],
      },
      failure: { target: "failed" },
    },
    failed: {
      ready: {
        target: "ready",
        reduce: () => ({ value: "ready", source: null }),
        effects: () => ["handoff"],
      },
    },
  },
});
