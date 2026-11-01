import { authoredSimulation } from "./simulations";
import { createMachine } from "../lib/machine";
import { t } from "../i18n";
import { readTutorials, savedProgress, saveProgress, writeTutorials } from "./progress";
import { paletteHost } from "../palette/host";
import type { EditorApi } from "../editor/types";
import {
  baselineKey,
  edgeTargets,
  holds,
  metricValue,
  nearMiss,
  namingSubjects,
  observeSteps,
  resolveSubjects,
  sinceValues,
  subjectFlowId,
  withoutSince,
} from "./checks";
import { createRepairs, type RepairPorts, type RepairTarget } from "./repair";
import {
  inStep,
  runnerInitial,
  runnerMachine,
  type Baseline,
  type RunnerCommand,
  type RunnerEvent,
  type RunnerState,
} from "./machine";
import { canvasInteraction } from "../canvas/interaction/canvasInteraction";
import { liveDiagramReader } from "../live/diagramReader";
import type { Demo, Tutorial } from "./types";
import type { DiagramFile } from "../model/types";
import { actionRegistry, type MenuNode } from "../editor/actions";
import type { SandboxView } from "./checks";
import type { EditorModeState } from "../canvas/interaction/mode";
import { dependencyVisibility } from "../canvas/dependencyVisibility";
import { simulationProjection } from "../sim/simulationContent";
import { planningHost } from "../live/planningHost";
import { capacityOverlay } from "../live/capacityOverlay";
import {
  cancelObservedWork,
  observationPorts,
  sameObservationSource,
  type ProductObservations,
} from "../lib/observations";
import { workbenchDock } from "../canvas/inspector/dockState";
import { tools } from "../canvas/chrome/tools";

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
  /** The connection between two subjects, by "from->to" (checks.ts, edgeTargets): what an edge test id names. */
  edges: Readonly<Record<string, string>>;
}

/** Demos pressing Live's controls: they wait (retrying on each change) until Live's lazy session offers them. */
const live = new Set<Demo["kind"]>([
  // Repairs (./repair.ts) wait for Live's session to show their last write, and for its commands while it mounts.
  "openSequence",
  "draftSimulation",
  "slowControl",
  "patch",
  "saveSimulation",
  "runSimulation",
  "fault",
  "traffic",
  "trace",
  "slowmo",
  "inject",
  "applyFix",
  "inputs",
  "openView",
  "continueNote",
]);

/**
 * A Live action's row as the palette builds it, with the same availability guards: undefined until Live's lazy session
 * has registered it, or while it's disabled. A demo pressing it retries on the next registry or session change.
 */
function liveRow(id: string, items: readonly MenuNode[]): (() => void) | undefined {
  for (const item of items) {
    if (item.type !== "item" || item.disabled) continue;
    if (item.id === id) return item.run;
    const nested = item.children && liveRow(id, item.children);
    if (nested) return nested;
  }
}

type Host = Pick<typeof paletteHost, "get" | "subscribe"> &
  Partial<Pick<typeof paletteHost, "runSimulation" | "cancelRun">>;

export function createTutorialRunner(
  tutorial: Tutorial,
  ports: {
    close(): void;
    host?: Host;
    initial?: DiagramFile;
    documentId?: string;
    present?(on: boolean): void;
    importPractice?(signal: AbortSignal): Promise<void>;
  },
) {
  const host = ports.host ?? paletteHost;
  const authored = typeof tutorial.start === "function" ? tutorial.start() : undefined;
  const initial = ports.initial ?? authored;
  const saved = savedProgress(tutorial);
  const sticky = tutorial.steps.map((s) => !!s.sticky || s.demo.length === 0);
  const dynamic = (check: Tutorial["steps"][number]["check"]): boolean =>
    [
      "freePlay",
      "event",
      "planning",
      "sequence",
      "newRun",
      "draftSimulation",
      "slowControl",
      "navigation",
      "toolSearch",
      "gallery",
      "history",
      "ownedCopy",
      "camera",
      "importReport",
      "absentNode",
      "dock",
      "view",
      "checks",
      "export",
      "import",
      "aiTurn",
      "collaboration",
      "live",
      "processed",
      "metric",
      "compare",
      "liveView",
      "readout",
      "inputs",
      "simulation",
      "expectation",
      "fault",
      "trace",
      "routeEvidence",
      "slowmo",
      "note",
      "mode",
      "selection",
      "aligned",
      "dependencies",
      "presenting",
      "sharing",
    ].includes(check.kind) ||
    (check.kind === "prop" && !!check.effective) ||
    (check.kind === "all" && check.checks.some(dynamic));
  const dynamicChecks = tutorial.steps.map((s) => dynamic(s.check));
  const hasSlowStep = (c: Tutorial["steps"][number]["check"]): boolean =>
    (c.kind === "slowControl" && c.action === "stepped") || (c.kind === "all" && c.checks.some(hasSlowStep));
  const hasNewRun = (c: Tutorial["steps"][number]["check"]): boolean =>
    c.kind === "newRun" || (c.kind === "all" && c.checks.some(hasNewRun));
  const moment = (check: Tutorial["steps"][number]["check"]): boolean =>
    [
      "sequence",
      "planning",
      "slowControl",
      "newRun",
      "export",
      "import",
      "aiTurn",
      "collaboration",
      "checks",
      "gallery",
      "history",
      "ownedCopy",
      "camera",
      "importReport",
      "toolSearch",
      "navigation",
    ].includes(check.kind) ||
    (check.kind === "note" && !!check.currentOnly) ||
    (check.kind === "all" && check.checks.some(moment));
  const momentChecks = tutorial.steps.map((step) => moment(step.check));
  const naming = tutorial.steps.map((s) => namingSubjects(s.check));
  const since = tutorial.steps.map((s) => sinceValues(s.check));
  const historical = tutorial.steps.map((s) => withoutSince(s.check));
  const machine = createMachine({
    ...runnerMachine,
    initial: runnerInitial(sticky, {
      stepIds: tutorial.steps.map((s) => s.id),
      // A settlement has its own action too (finish naming, close the annotation editor, select).
      demos: tutorial.steps.map((s) => s.demo.length > 0 || !!s.settle),
      highlights: readTutorials().highlights ?? true,
      resumeAt: saved && !saved.completed ? saved.step : 0,
    }),
  });
  let state: RunnerState = machine.state;
  let snapshot: RunnerSnapshot = { state, subjects: {}, selected: [], announcement: "", nearMiss: null, edges: {} };
  const listeners = new Set<() => void>();
  let observations: Partial<ProductObservations> = {};
  const publish = (patch: Partial<RunnerSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };
  /** Bumped by Restart and Exit: a demo still running stops there. */
  let generation = 0;
  let operation = new AbortController();
  const activeJobs = new Map<string, object>();
  const cancelWork = () => {
    if (boundDocument?.id) cancelObservedWork({ documentId: boundDocument.id, identity: boundDocument.identity });
    observations = {};
    generation++;
    operation.abort();
    operation = new AbortController();
    activeJobs.clear();
    repairs.reset();
    changed.forEach((f) => f());
  };
  const changed = new Set<() => void>();
  let app = { presenting: false, sharing: false };

  const editor = (): EditorApi | undefined => {
    const canvas = host.get().canvas;
    return !ports.documentId || canvas?.documentId === ports.documentId ? canvas?.editor : undefined;
  };
  let cachedEditor: EditorApi | undefined;
  let readDiagram: ReturnType<typeof liveDiagramReader>;
  let document: ReturnType<EditorApi["getDiagram"]> | undefined;
  let subjects: Record<string, string | undefined> = {};
  const demoBindings = new Map<string, string>();
  let documentChecks: boolean[] = [];
  let topology: string | undefined;
  /** Every edit of props, saved runs, drafts and Inputs a demo makes goes through these (./repair.ts). */
  const repairs = createRepairs(authored?.simulations);
  function view(): SandboxView {
    const h = host.get();
    const ed = h.canvas!.editor;
    if (ed !== cachedEditor) {
      cachedEditor = ed;
      readDiagram = liveDiagramReader(ed);
    }
    const diagram = readDiagram();
    const currentSession = h.session?.state?.();
    if (diagram !== document) {
      topology = JSON.stringify(simulationProjection(diagram, true));
      document = diagram;
      const bindings = { ...subjects };
      // Editor writes can land after the demo returns its id. Keep that declaration until the document reports it.
      for (const [name, id] of demoBindings) {
        if (!diagram.nodes.some((node) => node.id === id) && !diagram.groups?.some((group) => group.id === id))
          continue;
        for (const other of Object.keys(bindings)) if (bindings[other] === id) bindings[other] = undefined;
        bindings[name] = id;
      }
      subjects = resolveSubjects(tutorial, diagram, bindings);
      documentChecks = observeSteps(tutorial, { diagram, live: false, processed: () => 0 }, subjects);
    }
    // Counters prove traffic only in the editor's flow. Undo can restore that basis without a rebuild.
    const session = currentSession?.diagramBasis === topology ? currentSession : undefined;
    const ui = planningHost.get();
    const publishedDock = observationPorts.dock.get();
    const dock =
      publishedDock &&
      publishedDock.documentId === h.canvas!.documentId &&
      publishedDock.identity === ed.getDocumentVersion().identity
        ? publishedDock
        : undefined;
    return {
      diagram,
      live: !!h.canvas!.live,
      session: currentSession,
      sessionId: sessionId(h.session?.state),
      draft: ui?.draft,
      eventNodeId: ui?.events.nodeId,
      trafficReady: !!session,
      mode: canvasInteraction.get()?.mode,
      slowmo: h.session?.slowmo?.getState(),
      dependencies: dependencyVisibility.get(),
      views: {
        inputs: ui?.capacityOpen,
        events: ui?.events.open,
        simulations: ui?.panelOpen,
        capacity: capacityOverlay.get(),
      },
      readout: canvasInteraction.get()?.readouts?.get() ?? null,
      ...app,
      toolSurface: tools.get(),
      observations: {
        ...observations,
        dock: observations.dock ??
          dock ?? {
            documentId: h.canvas!.documentId ?? "",
            identity: ed.getDocumentVersion().identity,
            tab: workbenchDock.get().value,
            snap: workbenchDock.get().snap,
            live: !!h.canvas!.live,
            presenting: app.presenting,
          },
      },
      processed: (id: string) => session?.snapshot.nodes[id]?.processed ?? 0,
    };
  }

  /** Each Live session in turn, by its controller's state reader: a remounted session's generations start again. */
  const sessions = new WeakMap<object, number>();
  let sessionCount = 0;
  const sessionId = (reader: object | undefined) => {
    if (!reader) return undefined;
    if (!sessions.has(reader)) sessions.set(reader, ++sessionCount);
    return sessions.get(reader);
  };

  function send(event: RunnerEvent) {
    const { state: next, commands } = machine.send(event);
    const changed = next !== state;
    if (changed) {
      const step = inStep(state) ? state.index : -1;
      state = next;
      publish({ state });
      if ((inStep(state) ? state.index : -1) !== step) guide();
    }
    for (const c of commands) run(c);
    // Entered, or Skip emptied it: what the step counts starts here, once its commands (Restart's reset) have run.
    if (
      changed &&
      inStep(state) &&
      (since[state.index].length ||
        hasNewRun(tutorial.steps[state.index].check) ||
        hasSlowStep(tutorial.steps[state.index].check)) &&
      host.get().canvas &&
      editor()
    )
      capture(view());
  }

  /**
   * The current step's sinceStep baseline: each reading as soon as Live shows it once the step is current (never
   * earlier), kept in the machine's state. Nothing to send when it has them all, or Live doesn't show them yet.
   */
  function capture(v: SandboxView) {
    if (
      !inStep(state) ||
      (!since[state.index].length &&
        !hasNewRun(tutorial.steps[state.index].check) &&
        !hasSlowStep(tutorial.steps[state.index].check)) ||
      !v.session ||
      v.sessionId === undefined
    )
      return;
    const values: Record<string, readonly [number, number, number]> = {};
    if (hasSlowStep(tutorial.steps[state.index].check) && !state.baseline.slowStep && v.slowmo?.status === "on") {
      // Reading Pause can outlast the journey. Rewind before measuring the learner's next hop.
      if (v.slowmo.script && (v.slowmo.t ?? 0) >= v.slowmo.script.duration && v.slowmo.script.duration > 0) {
        host.get().session?.slowmo?.seek(0);
        capture(view());
        return;
      }
      values.slowStep = [v.slowmo.t ?? 0, 0, 0];
    }
    if (hasNewRun(tutorial.steps[state.index].check) && !state.baseline.newRun)
      values.newRun = [0, v.session.generation, v.sessionId];
    for (const expr of since[state.index]) {
      const key = baselineKey(expr);
      const now = state.baseline[key] ? undefined : metricValue(expr, v, subjects);
      if (now !== undefined) values[key] = [now, v.session.generation, v.sessionId];
    }
    if (Object.keys(values).length) send({ type: "baseline", step: state.index, values: values as Baseline });
  }

  /** The current step's guide for the canvas (quick-add opens searched for its pick); data, never a focus move. */
  let observationStep = -1;
  function guide() {
    const nextStep = inStep(state) ? state.index : -1;
    if (observationStep !== nextStep) {
      observationStep = nextStep;
      delete observations.sequenceExport;
      delete observations.exports;
      delete observations.imports;
      delete observations.ai;
      delete observations.collaboration;
      delete observations.importReport;
      delete observations.camera;
      delete observations.history;
      delete observations.tools;
      delete observations.navigation;
    }
    const step = inStep(state) ? tutorial.steps[state.index] : undefined;
    const quickAdd = step?.guide?.quickAdd?.();
    canvasInteraction.get()?.setGuide(quickAdd ? { quickAdd } : null);
  }

  /** The flow id of step i's subject the learner is naming right now, if any. */
  const namingNow = (i: number, mode: EditorModeState | undefined) =>
    mode?.value === "naming"
      ? naming[i].map((name) => subjectFlowId(subjects[name], document)).find((id) => id === mode.target)
      : undefined;

  /**
   * The annotation whose editor is open: as committed, or already focused (its field's layout effect runs before the
   * canvas reports the commit, so either says so first).
   */
  const annotating = (mode: EditorModeState | undefined) =>
    mode?.annotating ??
    (mode?.value === "naming" && document?.annotations?.some((a) => a.id === mode.target) ? mode.target : undefined);

  /** Live's hover cards attach to the canvas once Live shows them: follow whichever layer is attached now. */
  let readoutLayer: unknown = null;
  let offReadouts: (() => void) | undefined;
  function watchReadouts() {
    const layer = canvasInteraction.get()?.readouts ?? null;
    if (layer === readoutLayer) return;
    offReadouts?.();
    readoutLayer = layer;
    offReadouts = layer?.subscribe(observe);
  }

  let boundDocument: { id: string | undefined; identity: object } | undefined;
  function observe() {
    watchReadouts();
    const h = host.get();
    if (
      boundDocument &&
      h.canvas &&
      (h.canvas.documentId !== boundDocument.id ||
        (h.canvas.editor && h.canvas.editor.getDocumentVersion().identity !== boundDocument.identity))
    ) {
      const demoPending = activeJobs.size > 0 || changed.size > 0;
      cancelWork();
      boundDocument = undefined;
      if (demoPending) {
        send({ type: "documentReplaced" });
        return;
      }
    }
    if (!h.canvas || !editor()) return changed.forEach((f) => f());
    if (!activeJobs.size && !changed.size)
      boundDocument = {
        id: h.canvas.documentId,
        identity: h.canvas.editor.getDocumentVersion().identity,
      };
    const v = view();
    // The editor's mode (src/canvas/interaction/mode.ts): the selection, and whether the learner is mid-naming.
    const mode = canvasInteraction.get()?.mode;
    const selected = mode?.selection ?? [];
    const edges = edgeTargets(v.diagram, subjects);
    if (
      JSON.stringify(subjects) !== JSON.stringify(snapshot.subjects) ||
      selected.join() !== snapshot.selected.join() ||
      JSON.stringify(edges) !== JSON.stringify(snapshot.edges)
    )
      publish({ subjects, selected, edges });
    capture(v);
    const current = inStep(state) ? state.index : -1;
    const met = tutorial.steps.map((s, i) =>
      momentChecks[i] && i !== current
        ? state.observed[i]
        : dynamicChecks[i]
          ? holds(s.check, i === current ? { ...v, baseline: state.baseline } : v, subjects)
          : documentChecks[i],
    );
    const settled = tutorial.steps.map((s, i) => {
      if (!s.settle || (met[i] && state.observed[i] && state.settled[i])) return true;
      if (typeof s.settle === "object")
        return holds({ kind: "selection", subjects: s.settle.subjects, exact: true }, v, subjects);
      if (s.settle === "annotation") return !annotating(mode);
      return !namingNow(i, mode);
    });
    if (met.some((m, i) => m !== state.observed[i]) || settled.some((m, i) => m !== state.settled[i]))
      send({ type: "observe", met, settled });
    // Judged only once naming is over: a name is never "wrong" half typed.
    const step = inStep(state) ? tutorial.steps[state.index] : undefined;
    const miss = step && mode?.value !== "naming" ? nearMiss(step.check, v, subjects) : null;
    if (JSON.stringify(miss) !== JSON.stringify(snapshot.nearMiss)) publish({ nearMiss: miss });
    changed.forEach((f) => f());
  }

  /** Resolves once `ok()` holds, checked after each change the canvas reports; never if the run is replaced. */
  const until = (ok: () => boolean, run: number) =>
    new Promise<boolean>((resolve, reject) => {
      let busy = false,
        done = false;
      const settle = (result: boolean) => {
        done = true;
        changed.delete(check);
        resolve(result);
      };
      // A control pressed in ok() can notify at once (a store Live publishes synchronously): that change is judged
      // by the action's postcondition, never by retrying the press synchronously. A refused Continue may publish
      // without changing state; only a later, external change should try that control again.
      const check = () => {
        if (done) return;
        if (busy) return;
        busy = true;
        try {
          if (run !== generation) settle(false);
          else if (ok()) settle(true);
        } catch (error) {
          done = true;
          changed.delete(check);
          reject(error);
        } finally {
          busy = false;
        }
      };
      changed.add(check);
      check();
    });

  function perform(demo: Demo) {
    const h = host.get();
    const ed = editor();
    // No editor for a moment (the canvas republishing as Live mounts): not done, so a retried control tries again.
    if (!ed) return false;
    view();
    const edge = (pair: readonly [string, string]) =>
      ed.getDiagram().edges.find((e) => e.from === subjects[pair[0]] && e.to === subjects[pair[1]]);
    const repairPorts = (): RepairPorts => ({
      editor: ed,
      live: h.canvas?.live ? planningHost.get() : null,
      liveOn: !!h.canvas?.live,
    });
    switch (demo.kind) {
      case "history": {
        const run = generation;
        return (async () => {
          const done = () => {
            view();
            return demo.absent
              ? !subjects[demo.absent]
              : demo.present
                ? holds({ kind: "label", subject: demo.present.subject, is: demo.present.label }, view(), subjects)
                : false;
          };
          do {
            if (done()) return;
            if (!(demo.action === "undo" ? ed.canUndo() : ed.canRedo())) throw new Error("History unavailable");
            const before = ed.getDocumentVersion().revision;
            ed[demo.action]();
            if (!(await until(() => ed.getDocumentVersion().revision !== before, run))) return false;
          } while (demo.absent || demo.present);
        })();
      }
      case "importFixture":
        if (!ports.importPractice) throw new Error("Import unavailable");
        return ports.importPractice(operation.signal);
      case "stencil": {
        const id = subjects[demo.subject];
        if (id) ed.updateNode(id, { stencil: demo.stencil });
        return;
      }
      case "remove": {
        const id = subjects[demo.subject];
        // The editor may reuse this id on reapply; its next add must await a fresh canvas publication.
        demoBindings.delete(demo.subject);
        if (id) ed.deleteElements({ nodeIds: [id] });
        return;
      }
      case "member": {
        const id = subjects[demo.subject],
          boundary = subjects[demo.boundary];
        if (!id || !boundary) throw new Error("Missing boundary subject");
        return ed.moveIntoBoundary([id], boundary, { signal: operation.signal });
      }
      case "align": {
        const selection = !demo.subjects || demo.selection ? ed.getSelection() : undefined;
        let ids = demo.subjects
          ? demo.subjects.map((s) => subjects[s]).filter((id): id is string => !!id)
          : (selection?.nodeIds ?? []);
        if (
          demo.selection &&
          selection &&
          (selection.nodeIds.length < demo.selection.atLeast ||
            selection.groupIds.length ||
            selection.edgeIds.length ||
            selection.nodeIds.some((id) => !document?.nodes.some((n) => n.id === id)))
        ) {
          ids = demo.selection.fallback.map((s) => subjects[s]).filter((id): id is string => !!id);
          ed.select({ nodeIds: ids, groupIds: [], edgeIds: [] });
        }
        // React Flow publishes the selection later; align the declared ids in this same command.
        ed.align(ids, demo.mode);
        return;
      }
      case "dependencies":
        dependencyVisibility.set(demo.visible);
        return;
      case "present":
        ports.present?.(demo.on);
        return;
      case "name": {
        const id = subjects[demo.subject];
        if (id) ed.startEditing({ kind: "node", id });
        return;
      }
      case "field": {
        const id = subjects[demo.subject];
        if (id) ed.updateNode(id, { [demo.field]: demo.value() });
        return;
      }
      case "reconnect": {
        const id = edge(demo.edge)?.id;
        const to = subjects[demo.to];
        if (id && to) ed.reconnectEdge(id, "target", to);
        return;
      }
      case "insert": {
        const existing = subjects[demo.subject];
        const id = edge(demo.edge)?.id;
        if (existing) {
          const from = subjects[demo.edge[0]],
            to = subjects[demo.edge[1]];
          const upstream = edge([demo.edge[0], demo.subject]);
          const downstream = edge([demo.subject, demo.edge[1]]);
          if (id) {
            // Keep the learner's existing half (and its properties); reuse the original for the missing half.
            if (upstream && downstream) ed.deleteElements({ edgeIds: [id] });
            else if (upstream) ed.reconnectEdge(id, "source", existing);
            else if (downstream) ed.reconnectEdge(id, "target", existing);
            else ed.insertIntoEdge(id, existing);
          } else {
            if (from && !upstream) ed.connect(from, existing);
            if (to && !downstream) ed.connect(existing, to);
          }
          return;
        }
        const made = id ? ed.insertNode(id, demo.stencil) : null;
        if (made) {
          demoBindings.set(demo.subject, made.id);
          document = undefined;
          observe();
        }
        return;
      }
      case "prop": {
        const id = demo.edge ? edge(demo.edge)?.id : subjects[demo.subject];
        if (id && !demo.edge && h.canvas?.live) {
          ed.select({ nodeIds: [id], edgeIds: [], groupIds: [] });
          ed.openInspector("label");
        }
        if (id) {
          if (demo.edge) ed.setEdgeProps(id, demo.props);
          else ed.setNodeProps(id, demo.props);
        }
        return;
      }
      case "patch": {
        const id = demo.edge ? edge(demo.edge)?.id : subjects[demo.subject];
        const target: RepairTarget | undefined = id ? (demo.edge ? { edge: id } : { node: id }) : undefined;
        // Not there (yet): nothing to repair, as for any edit of a missing subject.
        if (!target) return;
        return repairs.repair(repairPorts(), { target, patches: demo.patches, runs: demo.runs }) === "done";
      }
      case "relation": {
        const id = edge([demo.from, demo.to])?.id;
        if (id) ed.updateEdge(id, { relation: demo.relation, ...(demo.edgeKind ? { kind: demo.edgeKind } : {}) });
        return;
      }
      case "group": {
        const ids = demo.subjects.map((s) => subjects[s]);
        if (ids.some((id) => !id)) return;
        // The boundary is there already: bring in only the members it's missing.
        if (subjects[demo.boundary])
          return ed.moveIntoBoundary(ids as string[], subjects[demo.boundary]!, { signal: operation.signal });
        const id = ed.groupNodes(ids as string[]);
        if (id) {
          demoBindings.set(demo.boundary, id);
          document = undefined;
          observe();
        }
        return;
      }
      case "annotate":
        ed.addAnnotation(demo.annotation);
        return;
      case "openSequence": {
        const ui = planningHost.get();
        if (!ui?.controller.getState().trace?.current || !ui.openSequence) return false;
        ui.openSequence();
        return true;
      }
      case "draftSimulation": {
        const ui = planningHost.get();
        if (!h.canvas?.live || !ui?.runDraft) return false;
        const own = ui.draft?.id === demo.simulation.id ? ui.draft : undefined;
        const next = authoredSimulation(ed.getDiagram(), own, {
          kind: "saveSimulation",
          id: demo.simulation.id,
          title: () => demo.simulation.title,
          definition: demo.simulation,
        });
        ui.runDraft(next ?? own ?? demo.simulation);
        return true;
      }
      case "slowControl": {
        const slow = planningHost.get()?.slowmo;
        if (!slow || (demo.action !== "end" && slow.getState().status !== "on")) return false;
        if (demo.action === "pause") slow.pause();
        else if (demo.action === "step") slow.step(1);
        else slow.end();
        return true;
      }
      case "runSimulation":
        // A design study's reference replay restores its authored load and capacity first.
        if (tutorial.study && repairs.reference(repairPorts(), demo.id) === "waiting") return false;
        if (!host.runSimulation || host.runSimulation(demo.id) === false) throw new Error("Simulation unavailable");
        return;
      case "select": {
        const ids = demo.subjects.map((s) => subjects[s]).filter((id): id is string => !!id);
        const groups = new Set(ed.getDiagram().groups?.map((g) => g.id));
        ed.select({
          nodeIds: ids.filter((id) => !groups.has(id)),
          groupIds: ids.filter((id) => groups.has(id)),
          edgeIds: [],
        });
        return;
      }
      case "fault": {
        const id = demo.edge ? edge(demo.edge)?.id : subjects[demo.subject];
        if (!id || !h.canvas?.live || !h.session) return false;
        const group = !!ed.getDiagram().groups?.some((g) => g.id === id);
        const target = demo.edge ? "edge" : group ? "group" : "node";
        const action =
          demo.fault === "cut"
            ? "sim.cut-link"
            : demo.fault === "down"
              ? group
                ? "sim.boundary-down"
                : "sim.kill"
              : demo.restore
                ? "sim.clear-faults"
                : demo.fault === "slow"
                  ? "sim.slow:5"
                  : "sim.failure:0.5";
        const current = view();
        const active = holds(
          { kind: "fault", ...(demo.edge ? { edge: demo.edge } : { subject: demo.subject }), fault: demo.fault },
          current,
          subjects,
        );
        if (active === !demo.restore) return true;
        const apply = liveRow(
          action,
          actionRegistry.build({
            editor: ed,
            mode: "live",
            surface: "palette",
            target,
            ...(demo.edge ? { edgeId: id } : group ? { groupId: id } : { nodeId: id }),
            selection: ed.getSelection(),
          }),
        );
        if (!apply) return false;
        apply();
        return true;
      }
      case "traffic":
      case "trace":
      case "slowmo":
      case "inject":
      case "applyFix": {
        const session = h.session?.state?.();
        if (!h.canvas?.live || !session) return false;
        // Already so (the learner's own toggle, a trace or slow motion under way): nothing to press.
        if (demo.kind === "traffic" && session.traffic === demo.on) return true;
        if (
          demo.kind === "trace" &&
          session.trace &&
          (!demo.deadLetter || session.trace.current?.steps.some((s) => s.kind === "deadletter"))
        )
          return true;
        if (demo.kind === "slowmo" && (h.session?.slowmo?.getState().status ?? "off") !== "off") return true;
        const node = "subject" in demo && demo.subject ? subjects[demo.subject] : undefined;
        if ("subject" in demo && demo.subject && !node) return false;
        const action =
          demo.kind === "traffic"
            ? "sim.traffic"
            : demo.kind === "trace"
              ? demo.deadLetter
                ? "sim.trace-message:dead-letter"
                : node
                  ? "sim.trace-next"
                  : "sim.trace-message:next"
              : demo.kind === "slowmo"
                ? node
                  ? "sim.slowmo-from"
                  : "sim.trace-message:slowmo"
                : demo.kind === "inject"
                  ? `sim.inject:${demo.count}`
                  : "sim.capacity-fix";
        const apply = liveRow(
          action,
          actionRegistry.build({
            editor: ed,
            mode: "live",
            surface: "palette",
            selection: ed.getSelection(),
            ...(node ? { target: "node" as const, nodeId: node } : { target: "canvas" as const }),
          }),
        );
        if (!apply) return false;
        apply();
        return true;
      }
      case "inputs":
        return repairs.inputs(repairPorts(), demo.input, demo.value) === "done";
      case "continueNote": {
        const ui = planningHost.get();
        const session = h.session?.state?.();
        if (!h.canvas?.live || !ui || !session || session.running?.id !== demo.simulation || !session.run) return false;
        // A note pausing the run before then holds it there: continue it, and wait for the run to get on.
        if (session.run.waiting) ui.controller.resume();
        const after = h.session?.state?.();
        return (
          after?.running?.id === demo.simulation &&
          !!after.run &&
          after.run.time >= (demo.atLeastMs ?? 0) &&
          !after.run.waiting
        );
      }
      case "openView": {
        const open = demo.open ?? true;
        if (demo.view === "capacity") return void capacityOverlay.set(open);
        const ui = planningHost.get();
        if (!h.canvas?.live || !ui) return false;
        if (demo.view === "inputs") ui.openCapacity(open);
        else if (demo.view === "events")
          ui.showEvents(demo.subject ? (subjects[demo.subject] ?? null) : ui.events.nodeId, open);
        else if (!open) ui.closePanel();
        else if (!ui.panelOpen) ui.openPanel();
        return true;
      }
      case "saveSimulation":
        // Only what's missing: a simulation the learner saved under this id keeps its own steps and checks.
        return repairs.saveSimulation(repairPorts(), demo) === "done";
      case "add": {
        const after = demo.after ? subjects[demo.after] : undefined;
        const made = subjects[demo.subject];
        // Added already (the learner's own): only what's missing, its connection from `after`.
        if (made) return void (after && ed.connect(after, made));
        let id: string | undefined;
        if (after) id = ed.createConnected({ from: after, stencil: demo.stencil })?.id;
        else {
          ed.clearSelection();
          // A rail action may still see React's previous selection after clearSelection.
          // An independent demo must use the editor's unconnected creation operation.
          id = ed.addNode(demo.stencil);
        }
        if (id) {
          demoBindings.set(demo.subject, id);
          document = undefined;
          observe();
        }
        return;
      }
      case "connect": {
        const from = subjects[demo.from];
        const to = subjects[demo.to];
        if (from && to) ed.connect(from, to, { sourceSide: demo.sourceSide, targetSide: demo.targetSide });
        return;
      }
      case "rename": {
        const id = subjects[demo.subject];
        if (id) {
          if (ed.getDiagram().groups?.some((g) => g.id === id)) ed.updateGroup(id, { label: demo.label() });
          else if (ed.getDiagram().edges.some((edge) => edge.id === id)) ed.updateEdge(id, { label: demo.label() });
          else ed.updateNode(id, { label: demo.label() });
        }
        return;
      }
      case "live":
        h.live?.goLive();
        return;
    }
  }

  /**
   * A settlement's own action, as the learner finishes: Enter in the name field or Esc in the annotation editor (both
   * through the controller's mode and focus policy, once that editor has focus), or the selection. Resolves once the
   * step has settled; nothing to do when it already has.
   */
  async function settle(i: number, run: number): Promise<boolean> {
    const s = tutorial.steps[i].settle;
    if (!s || state.settled[i]) return true;
    if (typeof s === "object") perform({ kind: "select", subjects: s.subjects });
    else {
      const open = () => {
        const mode = canvasInteraction.get()?.mode;
        const id = s === "annotation" ? annotating(mode) : namingNow(i, mode);
        return id && mode?.value === "naming" && mode.target === id ? id : undefined;
      };
      if (!(await until(() => state.settled[i] || !!open(), run))) return false;
      const id = open();
      if (id && !state.settled[i]) canvasInteraction.get()?.dispatch({ type: "naming.done", flowId: id });
    }
    return until(() => state.settled[i], run);
  }

  /**
   * Done for you (Skip, a near miss's fix, Continue's replay) through one completion contract: a step is complete when
   * its check holds and it has settled. Each part runs only while it's missing: the demo's edits while the check
   * doesn't hold, then the settlement's action. So Skip from `completing` never repeats an edit (no second topic).
   */
  async function demos(steps: readonly number[], purpose: "interactive" | "reconstruct") {
    const key = `${purpose}:${steps.join(",")}`;
    if (activeJobs.has(key)) return;
    const job = {};
    activeJobs.set(key, job);
    const run = generation;
    try {
      // Skip pressed before the sandbox canvas is up (its code still downloading): do it once it is.
      if (
        !(await until(() => {
          const ed = editor();
          if (!ed) return false;
          boundDocument = { id: host.get().canvas?.documentId, identity: ed.getDocumentVersion().identity };
          return true;
        }, run))
      )
        return;
      for (const i of steps) {
        if (run !== generation) return;
        if (!state.observed[i]) {
          const actions =
            purpose === "reconstruct"
              ? (tutorial.steps[i].reconstruct ?? tutorial.steps[i].demo)
              : tutorial.steps[i].demo;
          for (const d of actions) {
            // Present once per demo, rather than again on each session acknowledgement.
            // Re-selecting during a pending repair can publish another canvas commit.
            if (d.kind === "patch" && !d.edge && host.get().canvas?.live) {
              view();
              const id = subjects[d.subject];
              const ed = editor();
              if (id && ed) {
                ed.select({ nodeIds: [id], edgeIds: [], groupIds: [] });
                ed.openInspector("label");
              }
            }
            const made =
              d.kind === "add" || d.kind === "insert" ? d.subject : d.kind === "group" ? d.boundary : undefined;
            const bound = made && demoBindings.get(made);
            // Live publishes before its lazy session registers actions. Retry on session/registry changes.
            if (live.has(d.kind)) {
              if (
                !(await until(() => {
                  // Read-only views remain available while slow motion owns engine mutations.
                  if (d.kind !== "openView" && d.kind !== "slowControl" && host.get().session?.disabledHint)
                    throw new Error("Live unavailable");
                  return perform(d) !== false;
                }, run))
              )
                return;
            } else {
              const operationResult = perform(d);
              const result = operationResult instanceof Promise ? await operationResult : operationResult;
              if (run !== generation) return;
              if (result === false) throw new Error("Demo refused");
            }
            // A following history operation must see the committed name, not the preceding render.
            if (
              purpose === "reconstruct" &&
              tutorial.steps.some((step) => step.reconstruct) &&
              d.kind === "rename" &&
              !(await until(() => holds({ kind: "label", subject: d.subject, is: d.label }, view(), subjects), run))
            )
              return;
            // A queued launch can publish free play before its saved run: the step's next control (traffic, a trace)
            // waits for that run, so it's pressed in the run the check reads.
            if (
              d.kind === "runSimulation" &&
              !(await until(() => !!editor() && holds({ kind: "simulation", id: d.id }, view(), subjects), run))
            )
              return;
            // The editor commits a node it made after its call returns: the step's next edit (name it, connect it)
            // waits until the document reports it, rather than finding no subject and doing nothing.
            const id = made && demoBindings.get(made);
            if (id && id !== bound && !(await until(() => subjects[made] === id, run))) return;
          }
          // The next step's demo may need this one's node: wait for the canvas to report it. Replaying a step that
          // counted since it began (Continue), what it counted is history: the rest of its check is what must hold.
          const replayed = purpose === "reconstruct" && (since[i].length > 0 || momentChecks[i]);
          const done = () => state.observed[i] || (replayed && !!editor() && holds(historical[i], view(), subjects));
          if (actions.length && !(await until(done, run))) return;
        }
        if (!(await settle(i, run))) return;
      }
      if (run === generation)
        send(
          purpose === "reconstruct"
            ? { type: "reconstructed" }
            : { type: "observe", met: state.observed, settled: state.settled },
        );
    } catch {
      if (
        run === generation &&
        (purpose === "reconstruct" || steps.some((i) => !state.observed[i] || !state.settled[i]))
      )
        send({ type: "demoFailed", steps, purpose });
    } finally {
      if (activeJobs.get(key) === job) activeJobs.delete(key);
    }
  }

  /** Show me: the target node into view through the canvas camera only. The selection and focus stay the learner's. */
  function reveal(step: number) {
    // Slow motion owns the camera while it plays: Show me never moves it then.
    const slow = host.get().session?.slowmo?.getState().status;
    if (slow && slow !== "off") return;
    const target = tutorial.steps[step]?.targets.find((t) => t.testId.startsWith("node-{"));
    const name = target?.testId.slice(6, -1);
    const id = name ? snapshot.subjects[name] : undefined;
    if (id) host.get().canvas?.revealNode?.(id);
  }

  function run(command: RunnerCommand) {
    switch (command.type) {
      case "demo":
        void demos(command.steps, "interactive");
        return;
      case "reconstruct":
        void demos(command.steps, "reconstruct");
        return;
      case "reset": {
        cancelWork();
        boundDocument = undefined;
        subjects = {};
        demoBindings.clear();
        document = undefined;
        topology = undefined;
        const h = host.get();
        const ed = editor();
        if (!ed) return;
        const simulation = typeof tutorial.start !== "function" ? tutorial.start.simulation : undefined;
        h.session?.slowmo?.end();
        if (!simulation && h.canvas?.live) h.live?.toggle();
        host.cancelRun?.();
        if (initial) ed.applyDiagram(structuredClone(initial), { resetHistory: true });
        if (simulation) {
          const run = generation;
          const ready = () => !host.get().session?.disabledHint;
          if (ready()) host.runSimulation?.(simulation);
          else
            void until(ready, run).then((ok) => {
              if (ok) host.runSimulation?.(simulation);
            });
        }
        return;
      }
      case "reveal":
        publish({ announcement: tutorial.steps[command.step].hint?.() ?? announce(command.step) });
        reveal(command.step);
        return;
      case "announce":
        publish({ announcement: announce(command.step) });
        return;
      case "save":
        saveProgress(tutorial, command.step, command.completed);
        return;
      case "prefs":
        writeTutorials((s) => ({ ...s, highlights: command.highlights }));
        return;
      case "close":
        cancelWork();
        host.cancelRun?.();
        ports.close();
        return;
    }
  }

  function announce(step: number | "finished") {
    if (step === "finished") return t("tutorials.finished");
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
    let startRequested = false;
    let session: unknown;
    let offSession: (() => void) | undefined;
    let offSlow: (() => void) | undefined;
    let interaction: unknown;
    let offMode: (() => void) | undefined;
    const sync = () => {
      const current = host.get().session;
      if (current !== session) {
        offSession?.();
        offSlow?.();
        session = current;
        offSession = current?.subscribe?.(observe);
        offSlow = current?.slowmo?.subscribe(observe);
      }
      const canvas = canvasInteraction.get();
      if (canvas !== interaction) {
        offMode?.();
        interaction = canvas;
        offMode = canvas?.subscribeMode(observe);
        guide();
      }
      observe();
      if (
        !startRequested &&
        typeof tutorial.start !== "function" &&
        tutorial.start.simulation &&
        host.get().canvas &&
        (!ports.documentId || host.get().canvas?.documentId === ports.documentId)
      ) {
        startRequested = true;
        host.runSimulation?.(tutorial.start.simulation);
      }
    };
    const offHost = host.subscribe(sync);
    const offCanvas = canvasInteraction.subscribe(sync);
    const offActions = actionRegistry.subscribe(observe);
    const offDependencies = dependencyVisibility.subscribe(observe);
    const offPlanning = planningHost.subscribe(observe);
    const offOverlay = capacityOverlay.subscribe(observe);
    const offTools = tools.subscribe(observe);
    const watch = <K extends keyof ProductObservations>(key: K) =>
      observationPorts[key].subscribe((event: ProductObservations[K]) => {
        if (
          ["exports", "imports", "ai", "collaboration"].includes(key) &&
          !inStep(state) &&
          !(key === "imports" && state.value === "reconstructing" && tutorial.id === "import-and-review")
        )
          return;
        const canvas = host.get().canvas;
        if (!canvas || event.documentId !== canvas.documentId) return;
        if (
          "identity" in event &&
          !sameObservationSource(event, {
            documentId: canvas.documentId,
            identity: canvas.editor.getDocumentVersion().identity,
          })
        )
          return;
        observations[key] = event;
        observe();
      });
    const offObservations = [
      watch("planning"),
      watch("sequence"),
      watch("sequenceExport"),
      watch("navigation"),
      watch("tools"),
      watch("gallery"),
      watch("history"),
      watch("copied"),
      watch("library"),
      watch("camera"),
      watch("importReport"),
      watch("dock"),
      watch("checks"),
      watch("exports"),
      watch("imports"),
      watch("ai"),
      watch("collaboration"),
    ];
    sync();
    return () => {
      offHost();
      offCanvas();
      offActions();
      offDependencies();
      offPlanning();
      offOverlay();
      offTools();
      offObservations.forEach((off) => off());
      offReadouts?.();
      offSession?.();
      offSlow?.();
      cancelWork();
      host.cancelRun?.();
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
    appChanged(next: typeof app) {
      app = next;
      observe();
    },
    /** Test seam: the cause journal (development and e2e builds). */
    journal: () => machine.journal,
    /** Test seam: the sandbox's saved runs and Live's unsaved draft, the copies a repair chooses between. */
    runs: () => ({ saved: editor()?.getDiagram().simulations ?? [], draft: planningHost.get()?.draft ?? null }),
  };
}
