import { createMachine } from "../lib/machine";
import { t } from "../i18n";
import { readTutorials, savedProgress, writeTutorials } from "./progress";
import { paletteHost } from "../palette/host";
import type { EditorApi } from "../editor/types";
import { nearMiss, observeSteps, resolveSubjects } from "./checks";
import {
  inStep,
  runnerInitial,
  runnerMachine,
  type RunnerCommand,
  type RunnerEvent,
  type RunnerState,
} from "./machine";
import { canvasInteraction } from "../canvas/interaction/canvasInteraction";
import type { Demo, Tutorial } from "./types";

/**
 * The runner: one tutorial's machine (./machine.ts) wired to the sandbox canvas. It observes the canvas through the
 * palette host, which the canvas republishes on every document change, selection and mode switch, and Live's session,
 * which tells its subscribers as its counters change. No timers and no polling: a check is evaluated when something it
 * could depend on changed, and the machine is told only when a step's result flips.
 */
export interface RunnerSnapshot {
  state: RunnerState;
  /** Subjects found in the sandbox (name → node id). */
  subjects: Record<string, string | undefined>;
  /** The node ids selected on the canvas. */
  selected: readonly string[];
  /** What the screen reader hears next (a polite live region). */
  announcement: string;
  /** The current step's expectText near miss, once the learner has finished naming: what's expected, what they typed. */
  nearMiss: { expected: string; typed: string } | null;
}

type Host = Pick<typeof paletteHost, "get" | "subscribe">;

export function createTutorialRunner(tutorial: Tutorial, ports: { close(): void; host?: Host }) {
  const host = ports.host ?? paletteHost;
  const saved = savedProgress(tutorial);
  const sticky = tutorial.steps.map((s) => !!s.sticky || s.demo.length === 0);
  const machine = createMachine({
    ...runnerMachine,
    initial: runnerInitial(sticky, {
      highlights: readTutorials().highlights ?? true,
      resumeAt: saved && !saved.completed ? saved.step : 0,
    }),
  });
  let state: RunnerState = machine.state;
  let snapshot: RunnerSnapshot = { state, subjects: {}, selected: [], announcement: "", nearMiss: null };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<RunnerSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };
  /** Bumped by Restart and Exit: a demo still running stops there. */
  let generation = 0;
  const changed = new Set<() => void>();

  const editor = (): EditorApi | undefined => host.get().canvas?.editor;
  const view = () => {
    const h = host.get();
    const diagram = h.canvas!.editor.getDiagram();
    const nodes = h.session?.state?.().snapshot.nodes;
    return { diagram, live: !!h.canvas!.live, processed: (id: string) => nodes?.[id]?.processed ?? 0 };
  };

  function send(event: RunnerEvent) {
    const { state: next, commands } = machine.send(event);
    if (next !== state) {
      const step = inStep(state) ? state.index : -1;
      state = next;
      publish({ state });
      if ((inStep(state) ? state.index : -1) !== step) guide();
    }
    for (const c of commands) run(c);
  }

  /** The current step's guide for the canvas (quick-add opens searched for its pick); data, never a focus move. */
  function guide() {
    const step = inStep(state) ? tutorial.steps[state.index] : undefined;
    const quickAdd = step?.guide?.quickAdd?.();
    canvasInteraction.get()?.setGuide(quickAdd ? { quickAdd } : null);
  }

  function observe() {
    const h = host.get();
    if (!h.canvas) return changed.forEach((f) => f());
    const v = view();
    const subjects = resolveSubjects(tutorial, v.diagram);
    // The editor's mode (src/canvas/interaction/mode.ts): the selection, and whether the learner is mid-naming.
    const mode = canvasInteraction.get()?.mode;
    const selected = mode?.selection ?? [];
    if (JSON.stringify(subjects) !== JSON.stringify(snapshot.subjects) || selected.join() !== snapshot.selected.join())
      publish({ subjects, selected });
    const met = observeSteps(tutorial, v);
    const settled = tutorial.steps.map((s) => !(s.settle === "naming" && mode?.value === "naming"));
    if (met.some((m, i) => m !== state.observed[i]) || settled.some((m, i) => m !== state.settled[i]))
      send({ type: "observe", met, settled });
    // Judged only once naming is over: a name is never "wrong" half typed.
    const current = inStep(state) ? tutorial.steps[state.index] : undefined;
    const miss = current && mode?.value !== "naming" ? nearMiss(current.check, v, subjects) : null;
    if (JSON.stringify(miss) !== JSON.stringify(snapshot.nearMiss)) publish({ nearMiss: miss });
    changed.forEach((f) => f());
  }

  /** Resolves once `ok()` holds, checked after each change the canvas reports; never if the run is replaced. */
  const until = (ok: () => boolean, run: number) =>
    new Promise<boolean>((resolve) => {
      const check = () => {
        if (run !== generation) {
          changed.delete(check);
          resolve(false);
        } else if (ok()) {
          changed.delete(check);
          resolve(true);
        }
      };
      changed.add(check);
      check();
    });

  function perform(demo: Demo) {
    const h = host.get();
    const ed = editor();
    if (!ed) return;
    const subjects = resolveSubjects(tutorial, ed.getDiagram());
    switch (demo.kind) {
      case "add": {
        const after = demo.after ? subjects[demo.after] : undefined;
        if (after) ed.createConnected({ from: after, stencil: demo.stencil });
        else {
          ed.clearSelection();
          h.canvas?.addStencil(demo.stencil);
        }
        return;
      }
      case "connect": {
        const from = subjects[demo.from];
        const to = subjects[demo.to];
        if (from && to) ed.connect(from, to);
        return;
      }
      case "rename": {
        const id = subjects[demo.subject];
        if (id) ed.updateNode(id, { label: demo.label() });
        return;
      }
      case "live":
        h.live?.goLive();
        return;
    }
  }

  async function demos(steps: readonly number[]) {
    const run = generation;
    // Skip pressed before the sandbox canvas is up (its code still downloading): do it once it is.
    if (!(await until(() => !!host.get().canvas, run))) return;
    for (const i of steps) {
      if (run !== generation) return;
      if (state.observed[i]) continue;
      for (const d of tutorial.steps[i].demo) perform(d);
      // The next step's demo may need this one's node: wait for the canvas to report it.
      if (tutorial.steps[i].demo.length && !(await until(() => state.observed[i], run))) return;
    }
  }

  function reveal(step: number) {
    const target = tutorial.steps[step]?.targets.find((t) => t.testId.startsWith("node-{"));
    const name = target?.testId.slice(6, -1);
    const id = name ? snapshot.subjects[name] : undefined;
    // Through the canvas's own path (Ctrl+K's "go to"): the camera and the focus policy decide the rest.
    if (id) host.get().canvas?.focusNode(id);
  }

  function run(command: RunnerCommand) {
    switch (command.type) {
      case "demo":
        void demos(command.steps);
        return;
      case "reset": {
        generation++;
        const h = host.get();
        if (h.canvas?.live) h.live?.toggle();
        h.canvas?.editor.applyDiagram(tutorial.start());
        return;
      }
      case "reveal":
        reveal(command.step);
        return;
      case "announce":
        publish({ announcement: announce(command.step) });
        return;
      case "save":
        writeTutorials((s) => ({
          ...s,
          progress: {
            ...s.progress,
            [tutorial.id]: {
              version: tutorial.version,
              step: command.step,
              // Finishing once counts for good; starting again doesn't take it away.
              completed: command.completed || !!s.progress?.[tutorial.id]?.completed,
            },
          },
        }));
        return;
      case "prefs":
        writeTutorials((s) => ({ ...s, highlights: command.highlights }));
        return;
      case "close":
        generation++;
        ports.close();
        return;
    }
  }

  function announce(step: number | "finished") {
    if (step === "finished") return t("tutorials.announceFinished", { text: tutorial.finish.text() });
    const s = tutorial.steps[step];
    return t("tutorials.announceStep", {
      step: step + 1,
      total: tutorial.steps.length,
      title: s.title(),
      goal: s.goal(),
    });
  }

  /**
   * Three sources, each a subscription: the palette host (the document, Live on or off), Live's session (its counters)
   * and the canvas's editor mode (its transitions). A check is evaluated when one of them changes.
   */
  function connect() {
    let session: unknown;
    let offSession: (() => void) | undefined;
    let interaction: unknown;
    let offMode: (() => void) | undefined;
    const sync = () => {
      const current = host.get().session;
      if (current !== session) {
        offSession?.();
        session = current;
        offSession = current?.subscribe?.(observe);
      }
      const canvas = canvasInteraction.get();
      if (canvas !== interaction) {
        offMode?.();
        interaction = canvas;
        offMode = canvas?.subscribeMode(observe);
        guide();
      }
      observe();
    };
    const offHost = host.subscribe(sync);
    const offCanvas = canvasInteraction.subscribe(sync);
    sync();
    return () => {
      offHost();
      offCanvas();
      offSession?.();
      offMode?.();
      canvasInteraction.get()?.setGuide(null);
    };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    connect,
    send,
    /** Test seam: the cause journal (development and e2e builds). */
    journal: () => machine.journal,
  };
}
