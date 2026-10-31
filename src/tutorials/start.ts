import { loadExample } from "../examples";
import type { Tutorial } from "./types";
import type { DiagramFile } from "../model/types";
import { createMachine, defineMachine } from "../lib/machine";

/** Always a fresh sandbox; never hand an example's cached document to the editor. */
export async function loadTutorialStart(tutorial: Tutorial): Promise<DiagramFile> {
  const diagram = typeof tutorial.start === "function" ? tutorial.start() : await loadExample(tutorial.start.example);
  return { ...structuredClone(diagram), title: tutorial.title() };
}

type StartState = { value: "idle" | "loading" | "ready" | "failed"; request: number; diagram: DiagramFile | null };
type StartEvent =
  | { type: "load" | "cancel" }
  | { type: "resolve"; request: number; diagram: DiagramFile }
  | { type: "reject"; request: number };
export const tutorialStartMachine = defineMachine<StartState, StartEvent, { type: "load"; request: number }>({
  initial: { value: "idle", request: 0, diagram: null },
  states: ["idle", "loading", "ready", "failed"],
  events: [
    { type: "load" },
    { type: "cancel" },
    { type: "resolve", request: 1, diagram: { format: "diagrams/v1", title: "", nodes: [], edges: [] } },
    { type: "reject", request: 1 },
  ],
  on: {
    "*": {
      load: {
        target: "loading",
        reduce: (s) => ({ ...s, request: s.request + 1 }),
        effects: (_s, _e, n) => [{ type: "load", request: n.request }],
      },
    },
    loading: {
      resolve: {
        target: "ready",
        guard: (s, e) => e.request === s.request,
        reduce: (s, e) => ({ ...s, diagram: e.diagram }),
      },
      reject: { target: "failed", guard: (s, e) => e.request === s.request },
      cancel: { target: "idle", reduce: (s) => ({ ...s, request: s.request + 1 }) },
    },
  },
});

/** Cancellation and Retry belong to the loader machine; a late download can never open a departed tutorial. */
export function createTutorialStart(tutorial: Tutorial, load = loadTutorialStart, onFailure = () => {}) {
  const machine = createMachine(tutorialStartMachine);
  const listeners = new Set<() => void>();
  const send = (event: StartEvent) => {
    const before = machine.state;
    const { commands } = machine.send(event);
    if (event.type === "reject" && before !== machine.state) onFailure();
    listeners.forEach((f) => f());
    for (const command of commands)
      void load(tutorial).then(
        (diagram) => send({ type: "resolve", request: command.request, diagram }),
        () => send({ type: "reject", request: command.request }),
      );
  };
  return {
    getSnapshot: () => machine.state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retry: () => send({ type: "load" }),
    connect: () => {
      if (machine.state.value === "idle") send({ type: "load" });
      return () => send({ type: "cancel" });
    },
  };
}
