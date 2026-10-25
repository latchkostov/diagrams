/* eslint-disable local/no-literal-ui-text -- Labels these fake edits write are test input, not UI copy. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasInteraction } from "../canvas/interaction/canvasInteraction";
import {
  editorModeStep,
  initialEditorMode,
  type EditorModeEvent,
  type EditorModeState,
} from "../canvas/interaction/mode";
import { GROUP_PREFIX } from "../canvas/types";
import type { EditorApi } from "../editor/types";
import { LiveController } from "../live/controller";
import { liveActions } from "../live/liveActions";
import { actionRegistry } from "../editor/actions";
import type { AnnotationKind, DiagramEdge, DiagramFile, DiagramNode, Side } from "../model/types";
import type { paletteHost } from "../palette/host";
import { allTutorials as tutorials } from "./catalog";
import { commandPalette } from "./catalog/commandPalette";
import { annotate } from "./catalog/annotate";
import { arrange } from "./catalog/arrange";
import { sharePresent } from "./catalog/sharePresent";
import { insertOnEdge } from "./catalog/insertOnEdge";
import { boundaries } from "./catalog/boundaries";
import { stencils } from "../stencils/registry";
import { editorHarness } from "../test/editorHarness";
import { overlaps } from "../canvas/placement";
import { groupOf } from "../canvas/membership";
import { inStep } from "./machine";
import { savedProgress, saveProgress } from "./progress";
import { createTutorialRunner } from "./runner";
import type { Check, Demo, Tutorial } from "./types";
import { patchProps } from "./paths";
import {
  addNameFixture,
  liveControlsFixture,
  metricsFixture,
  pathsFixture,
  tutorialFixtures,
} from "../test/tutorialFixtures";

/**
 * The runner's completion contract, swept over every step of every tutorial in the catalog (src/tutorials/catalog):
 *
 *   (a) Skip from `active` advances to the next step.
 *   (b) A learner's own edit that leaves its settlement pending (a name still being typed, an annotation's editor still
 *       open, the wrong selection) waits in `completing`; Skip from there advances without repeating an edit.
 *   (c) Continue from a step saved there lands on it (or on the first later step a fresh sandbox already satisfies,
 *       as Skip would), with no extra input and without saving lower progress.
 *   (d) Show me changes neither the selection nor the document, and Skip still advances after it.
 *
 * The sandbox below stands in for the canvas with the editor's real semantics where a step depends on them: a new
 * node is selected, connect is idempotent, an annotation opens its editor (committed with the render, then focused),
 * and the editor's mode is the real reducer (mode.ts). Live is the real controller (src/live/controller.ts) over the
 * sandbox's document, so metric checks read real replicas and counters; its time moves only when a case advances it.
 * A step Skip passes over (its predecessor's demo already did it) can't be current, so its cases assert it's complete
 * instead. The runner's fixture lessons (src/test/tutorialFixtures.ts) go through the same cases as the catalog.
 */

const quarantineReason = "quarantined: see docs/backlog/2026-10-24-tutorials-quarantine.md";
const itFor = (tutorial: Tutorial) =>
  tutorial.quarantined
    ? (name: string, fn: () => void | Promise<void>) => it.skip(`${name} (${quarantineReason})`, fn)
    : it;

const cleanup: (() => void)[] = [];
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});
afterEach(() => {
  cleanup.reverse().forEach((f) => f());
  cleanup.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const startOf = (tutorial: Tutorial): DiagramFile =>
  structuredClone(
    typeof tutorial.start === "function"
      ? tutorial.start()
      : (JSON.parse(readFileSync(join("src/examples", `${tutorial.start.example}.json`), "utf8")) as DiagramFile),
  );

/**
 * lateAdds: a new node lands in the document after the editor call that made it returns, as the editor's commits do.
 * lazyLive: going live shows free play first; Live's actions arrive a task later, as the lazy session's chunk mounts
 * them, and a queued saved run a task after that (the session's own effect activates it).
 */
function sandbox(tutorial: Tutorial, { lateAdds = false, lazyLive = false } = {}) {
  let diagram = startOf(tutorial);
  let version = 0;
  let mode: EditorModeState = { ...initialEditorMode, annotating: null };
  let made = 0;
  const docs = new Set<() => void>();
  const modes = new Set<(m: EditorModeState, p: EditorModeState) => void>();
  const sessions = new Set<() => void>();
  const notify = () => docs.forEach((f) => f());
  const toMode = (event: EditorModeEvent) => {
    const previous = mode;
    mode = editorModeStep(mode, event);
    if (mode !== previous) modes.forEach((f) => f(mode, previous));
  };
  const select = (ids: readonly string[]) => toMode({ type: "selection", ids });
  /** A document write, and the canvas republishing it. */
  const write = (next: DiagramFile) => {
    diagram = next;
    version++;
    notify();
    // Live takes the edit after the canvas republishes it: props patched in, a topology change rebuilt.
    controller?.updateDiagram(diagram);
  };
  /** A node-adding write: now, or once the editor's call has returned. */
  const commit = (make: () => DiagramFile) => (lateAdds ? queueMicrotask(() => write(make())) : write(make()));
  let controller: LiveController | undefined;
  let offController: (() => void) | undefined;
  let offActions: (() => void) | undefined;
  /** Live's own actions over this run, as its session registers them: Skip's controls press these rows. */
  const actionsOf = (c: LiveController) =>
    liveActions({
      controller: c,
      slowMotionActive: () => false,
      openInject: () => {},
      startStorm: () => {},
      showEvents: () => {},
      trace: () => {},
      tracing: () => null,
      traceNext: (nodeId) => c.traceNext(nodeId),
      traceSlowest: () => {},
      traceDeadLettered: () => {},
      slowMotion: () => {},
      slowMotionTrace: () => {},
      canReplayTrace: () => false,
      endTrace: () => c.endTrace(),
      tracingMessage: () => c.getState().trace !== null,
      saveTweaks: () => {},
      messageType: () => "",
      openRecord: () => {},
    });
  const goLive = (simulation?: string) => {
    hostState.canvas.live = true;
    const mounting = !controller;
    if (!controller) {
      controller = new LiveController(diagram);
      offController = controller.subscribe(() => sessions.forEach((f) => f()));
    }
    const c = controller;
    const publishLive = () => {
      notify();
      sessions.forEach((f) => f());
    };
    // As Live's session does (useLiveSessionState, useLiveCommands): it mounts in free play with Continuous traffic,
    // playing; a saved run starts with its own traffic only (Continuous traffic off), playing.
    const mount = () => {
      if (controller !== c || !mounting) return;
      c.setTraffic(true);
      c.setPlaying(true);
      offActions = actionRegistry.register(actionsOf(c));
    };
    const run = () => {
      if (controller !== c || !simulation) return;
      c.selectSimulation(diagram.simulations?.find((sim) => sim.id === simulation) ?? null);
      c.setTraffic(false);
      c.setPlaying(true);
    };
    if (!lazyLive) {
      mount();
      run();
      return publishLive();
    }
    publishLive();
    setTimeout(() => {
      mount();
      publishLive();
      setTimeout(() => {
        run();
        publishLive();
      }, 0);
    }, 0);
  };
  const leaveLive = () => {
    hostState.canvas.live = false;
    offActions?.();
    offActions = undefined;
    offController?.();
    controller?.dispose();
    controller = undefined;
    notify();
  };
  cleanup.push(() => leaveLive());
  const isGroup = (id: string) => !!diagram.groups?.some((g) => g.id === id);
  const newNode = (stencil: string): DiagramNode => ({
    id: `made-${++made}`,
    stencil,
    label: "New",
    x: 200 * made,
    y: 500,
  });
  const newEdge = (from: string, to: string): DiagramEdge => ({
    id: `edge-${++made}`,
    from,
    to,
    // As the editor infers it: a connection into a topic starts as a Message.
    kind: diagram.nodes.find((n) => n.id === to)?.stencil.startsWith("kafka.") ? "async" : "sync",
  });
  const patchEdge = (id: string, patch: Partial<DiagramEdge>) =>
    write({ ...diagram, edges: diagram.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const editor = {
    getDiagram: () => diagram,
    getDocumentVersion: () => version,
    getSelection: () => ({
      nodeIds: mode.selection.filter((id) => diagram.nodes.some((n) => n.id === id)),
      groupIds: mode.selection.filter((id) => id.startsWith(GROUP_PREFIX)).map((id) => id.slice(GROUP_PREFIX.length)),
      edgeIds: mode.selection.filter((id) => diagram.edges.some((e) => e.id === id)),
    }),
    clearSelection: () => select([]),
    select: ({
      nodeIds = [],
      groupIds = [],
      edgeIds = [],
    }: {
      nodeIds?: string[];
      groupIds?: string[];
      edgeIds?: string[];
    }) => select([...nodeIds, ...groupIds.map((g) => GROUP_PREFIX + g), ...edgeIds]),
    applyDiagram: (next: DiagramFile) => write(structuredClone(next)),
    addStencil(stencil: string) {
      const node = newNode(stencil);
      commit(() => ({ ...diagram, nodes: [...diagram.nodes, node] }));
      select([node.id]);
      return node.id;
    },
    createConnected({ from, stencil }: { from: string; stencil: string }) {
      const node = newNode(stencil);
      const edge = newEdge(from, node.id);
      commit(() => ({ ...diagram, nodes: [...diagram.nodes, node], edges: [...diagram.edges, edge] }));
      select([node.id]);
      return { id: node.id, edge: edge.id, merge: "add" };
    },
    connect(from: string, to: string, sides?: { sourceSide?: Side; targetSide?: Side }) {
      const existing = diagram.edges.find((e) => e.from === from && e.to === to);
      if (existing) {
        // The same pair again: its sides change, never a second connection.
        if (sides) {
          patchEdge(existing.id, sides);
          select([existing.id]);
        }
        return existing.id;
      }
      const edge = { ...newEdge(from, to), ...sides };
      write({ ...diagram, edges: [...diagram.edges, edge] });
      return edge.id;
    },
    updateNode: (id: string, patch: Partial<DiagramNode>) =>
      write({ ...diagram, nodes: diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
    updateGroup: (id: string, patch: { label?: string }) =>
      write({ ...diagram, groups: diagram.groups?.map((g) => (g.id === id ? { ...g, ...patch } : g)) }),
    updateEdge: patchEdge,
    setEdgeProps: (id: string, props: Record<string, unknown>) =>
      patchEdge(id, { props: { ...diagram.edges.find((e) => e.id === id)?.props, ...props } }),
    setNodeProps: (id: string, props: Record<string, unknown>) =>
      editor.updateNode(id, { props: { ...diagram.nodes.find((n) => n.id === id)?.props, ...props } }),
    reconnectEdge: (id: string, end: "source" | "target", to: string) =>
      patchEdge(id, end === "target" ? { to } : { from: to }),
    insertNode(edgeId: string, stencil: string) {
      const old = diagram.edges.find((e) => e.id === edgeId);
      if (!old) return null;
      const node = newNode(stencil);
      write({
        ...diagram,
        nodes: [...diagram.nodes, node],
        edges: [
          ...diagram.edges.filter((e) => e !== old),
          { ...old, to: node.id },
          { ...old, id: `${old.id}-out`, from: node.id },
        ],
      });
      select([node.id]);
      return { id: node.id, edge: old.id, merge: "insert" };
    },
    insertIntoEdge(edgeId: string, id: string) {
      const old = diagram.edges.find((e) => e.id === edgeId);
      if (!old) return false;
      write({
        ...diagram,
        edges: [
          ...diagram.edges.filter((e) => e !== old),
          { ...old, to: id },
          { ...old, id: `${old.id}-out`, from: id },
        ],
      });
      return true;
    },
    async moveIntoBoundary(ids: readonly string[], groupId: string) {
      const h = editorHarness(diagram);
      const changed = await h.api.moveIntoBoundary(ids, groupId);
      if (changed) write(h.api.getDiagram());
      return changed;
    },
    groupNodes(ids: string[]) {
      const id = `box-${++made}`;
      const members = diagram.nodes.filter((n) => ids.includes(n.id));
      const x = Math.min(...members.map((n) => n.x)) - 40,
        y = Math.min(...members.map((n) => n.y)) - 60;
      write({
        ...diagram,
        groups: [...(diagram.groups ?? []), { id, label: "Boundary", x, y, width: 900, height: 300 }],
        nodes: diagram.nodes.map((n) => (ids.includes(n.id) ? { ...n, group: id } : n)),
      });
      select([GROUP_PREFIX + id]);
      // A new boundary's Label takes focus: it's being named.
      toMode({ type: "field.focused", target: GROUP_PREFIX + id });
      return id;
    },
    addAnnotation(kind: AnnotationKind) {
      const id = `ann-${++made}`;
      // In the browser's order: the editor reports its opening editor first (CanvasView's setEditing port), then the
      // annotation is inserted, which something can already observe; in the commit, the editor's field takes focus in
      // its own layout effect (a child's runs first), the canvas reports the selection, then republishes.
      toMode({ type: "annotating", id });
      write({
        ...diagram,
        annotations: [...(diagram.annotations ?? []), { id, kind, text: "", x: 0, y: -300, width: 240, height: 80 }],
      });
      toMode({ type: "field.focused", target: id });
      select([id]);
      notify();
      return id;
    },
    align(ids: string[]) {
      const y = Math.round(
        diagram.nodes.filter((n) => ids.includes(n.id)).reduce((sum, n) => sum + n.y, 0) / Math.max(1, ids.length),
      );
      write({ ...diagram, nodes: diagram.nodes.map((n) => (ids.includes(n.id) ? { ...n, y } : n)) });
    },
    startEditing: ({ kind, id }: { kind: string; id: string }) =>
      toMode({ type: "field.focused", target: kind === "group" ? GROUP_PREFIX + id : id }),
  };
  const hostState = {
    canvas: {
      editor: editor as unknown as EditorApi,
      live: false,
      documentId: undefined as string | undefined,
      addStencil: editor.addStencil,
      // The palette's go-to selects; a tutorial's Show me must use revealNode, which only moves the camera.
      focusNode: vi.fn((id: string) => select([id])),
      revealNode: vi.fn(),
    },
    live: {
      goLive: () => goLive(),
      toggle: () => (hostState.canvas.live ? leaveLive() : goLive()),
    },
    session: {
      run: () => {},
      state: () => controller?.getState(),
      subscribe: (f: () => void) => {
        sessions.add(f);
        return () => void sessions.delete(f);
      },
    },
    pendingRun: null,
  };
  const host: Pick<typeof paletteHost, "get" | "subscribe"> &
    Partial<Pick<typeof paletteHost, "runSimulation" | "cancelRun">> = {
    get: () => hostState as unknown as ReturnType<typeof paletteHost.get>,
    subscribe: (f) => {
      docs.add(f);
      return () => void docs.delete(f);
    },
    runSimulation: (id: string) => {
      goLive(id);
      return true;
    },
    cancelRun: () => {},
  };
  cleanup.push(
    canvasInteraction.publish({
      get mode() {
        return mode;
      },
      setGuide: () => {},
      // The controller: naming.done for the mode, and the focus policy moves focus to the item (row N1). The field
      // that had focus blurs: a name is done, an annotation's editor commits and closes.
      dispatch: (event) => {
        toMode({ type: "naming.done" });
        if (mode.annotating === event.flowId) toMode({ type: "annotating", id: null });
        toMode({ type: "field.left" });
      },
      subscribeMode: (f) => {
        modes.add(f);
        return () => void modes.delete(f);
      },
    }),
  );
  const app = { presenting: false, sharing: false };
  const runner = createTutorialRunner(tutorial, {
    close: vi.fn(),
    host,
    initial: startOf(tutorial),
    present: (on) => {
      app.presenting = on;
      runner.appChanged({ ...app });
    },
  });
  cleanup.push(runner.connect());
  const subject = (name: string) => runner.getSnapshot().subjects[name]!;
  return {
    runner,
    editor,
    hostState,
    get mode() {
      return mode;
    },
    get version() {
      return version;
    },
    get diagram() {
      return diagram;
    },
    toMode,
    subject,
    app,
    /** The sandbox's Live run, while it's live. */
    get live() {
      return controller;
    },
    /** The learner's own edit for a demo, through the UI's editor calls (not the runner's). */
    learn(demo: Demo) {
      const id = (name: string) => subject(name);
      const edge = (pair: readonly [string, string]) =>
        diagram.edges.find((e) => e.from === id(pair[0]) && e.to === id(pair[1]))!;
      switch (demo.kind) {
        case "add":
          return demo.after
            ? editor.createConnected({ from: id(demo.after), stencil: demo.stencil })
            : editor.addStencil(demo.stencil);
        case "connect":
          return editor.connect(id(demo.from), id(demo.to), {
            sourceSide: demo.sourceSide,
            targetSide: demo.targetSide,
          });
        case "reconnect":
          return editor.reconnectEdge(edge(demo.edge).id, "target", id(demo.to));
        case "insert":
          return editor.insertNode(edge(demo.edge).id, demo.stencil);
        case "field":
          return editor.updateNode(id(demo.subject), { [demo.field]: demo.value() });
        case "name":
          return editor.startEditing({ kind: "node", id: id(demo.subject) });
        case "rename":
          return isGroup(id(demo.subject))
            ? editor.updateGroup(id(demo.subject), { label: demo.label() })
            : editor.updateNode(id(demo.subject), { label: demo.label() });
        case "prop":
          return demo.edge
            ? editor.setEdgeProps(edge(demo.edge).id, demo.props)
            : editor.setNodeProps(id(demo.subject), demo.props);
        case "patch": {
          // The learner's own edit to the same effect, through the inspector's prop writes.
          const target = demo.edge ? edge(demo.edge) : diagram.nodes.find((n) => n.id === id(demo.subject))!;
          const changed = patchProps(target.props, demo.patches) ?? {};
          return demo.edge ? editor.setEdgeProps(target.id, changed) : editor.setNodeProps(target.id, changed);
        }
        case "relation":
          return patchEdge(edge([demo.from, demo.to]).id, {
            relation: demo.relation,
            ...(demo.edgeKind ? { kind: demo.edgeKind } : {}),
          });
        case "group":
          return editor.groupNodes(demo.subjects.map(id));
        case "annotate":
          return editor.addAnnotation(demo.annotation);
        case "runSimulation":
          return host.runSimulation!(demo.id);
        case "select":
          return select(demo.subjects.map(id));
        case "member":
          return editor.updateNode(id(demo.subject), { group: id(demo.boundary) });
        case "align":
          return editor.align(demo.subjects ? demo.subjects.map(id) : editor.getSelection().nodeIds);
        case "present":
          app.presenting = demo.on;
          return runner.appChanged({ ...app });
        case "live":
          return goLive();
        case "traffic":
          return controller!.setTraffic(demo.on);
        case "trace":
          return controller!.traceNext();
        case "fault":
          throw new Error("No catalog lesson injects faults yet: model the fault here before adding one.");
      }
    },
  };
}
type Sandbox = ReturnType<typeof sandbox>;

const state = (s: Sandbox) => s.runner.getSnapshot().state;
const beyond = (s: Sandbox, i: number) => state(s).value === "finished" || (inStep(state(s)) && state(s).index > i);

/** A check that needs the run to have played for a while: Live's time has to move for it. */
const needsRunTime = (check: Check): boolean =>
  check.kind === "all" ? check.checks.some(needsRunTime) : check.kind === "simulation" && !!check.atLeastMs;

async function skip(s: Sandbox, tutorial: Tutorial) {
  const before = state(s);
  const step = tutorial.steps[before.index];
  s.runner.send({ type: "skip", stepId: step.id });
  await vi.waitFor(
    () => {
      // Live keeps playing while Skip's edits land, as on the canvas; only a step that needs run time sees it move,
      // so no other step's moment passes early.
      if (needsRunTime(step.check) && s.live?.getState().playing) {
        s.live.advance(250);
        s.live.publish();
      }
      expect(beyond(s, before.index), `Skip on ${step.id}`).toBe(true);
    },
    { timeout: 2000, interval: 1 },
  );
}

/** Start, then Skip until step i is current or passed over. Returns whether i is current. */
async function reach(s: Sandbox, tutorial: Tutorial, i: number): Promise<boolean> {
  s.runner.send({ type: "start" });
  while (inStep(state(s)) && state(s).index < i) await skip(s, tutorial);
  return inStep(state(s)) && state(s).index === i;
}

/** A step Skip passed over is complete: its check holds (or it's a latched moment). */
function expectPassedOver(s: Sandbox, i: number) {
  const st = state(s);
  expect(st.latched[i] || (st.observed[i] && st.settled[i]), "a step passed over is complete").toBe(true);
}

/** The text a step's check reads is still being typed: a label in its name field, an annotation in its editor. */
function typing(s: Sandbox, check: Check): boolean {
  if (check.kind === "all") return check.checks.some((c) => typing(s, c));
  if (check.kind === "annotation") return !!s.mode.annotating;
  if (check.kind !== "label") return false;
  const id = s.runner.getSnapshot().subjects[check.subject];
  return s.mode.value === "naming" && !!id && (s.mode.target === id || s.mode.target === GROUP_PREFIX + id);
}

/** Where Skip lands from the start once it reaches step k: what Continue from k must land on too. */
async function skipLanding(tutorial: Tutorial, k: number) {
  const s = sandbox(tutorial);
  await reach(s, tutorial, k);
  const landed = state(s).value === "finished" ? tutorial.steps.length : state(s).index;
  cleanup.reverse().forEach((f) => f());
  cleanup.length = 0;
  return landed;
}

describe("every tutorial's completion contract", () => {
  for (const tutorial of [...tutorials, ...tutorialFixtures])
    describe(tutorial.id, () => {
      const lessonIt = itFor(tutorial);
      tutorial.steps.forEach((step, i) => {
        for (const perturbation of ["clear selection", "single node", "extra subject-type node"] as const)
          lessonIt(`${step.id}: (e) Skip recovers after ${perturbation} without duplicate subjects`, async () => {
            const s = sandbox(tutorial);
            if (!(await reach(s, tutorial, i))) return expectPassedOver(s, i);
            if (perturbation === "clear selection") s.editor.clearSelection();
            else if (perturbation === "single node") {
              // Empty lessons get a real node too, rather than silently repeating deselection.
              const id = s.diagram.nodes[0]?.id ?? s.editor.addStencil("generic.service");
              s.editor.select({ nodeIds: [id] });
            } else {
              const checkSubjects = (c: Check): string[] =>
                c.kind === "all"
                  ? c.checks.flatMap(checkSubjects)
                  : "subject" in c && c.subject
                    ? [c.subject]
                    : "from" in c
                      ? [c.from, c.to]
                      : "subjects" in c
                        ? [...(c.subjects ?? [])]
                        : [];
              const names = checkSubjects(step.check);
              const spec =
                names.map((name) => tutorial.subjects[name]).find((s) => s?.stencils || s?.role) ??
                Object.values(tutorial.subjects).find((s) => s.stencils || s.role);
              const creates = step.demo.find((d) => d.kind === "add" || d.kind === "insert");
              const stencil =
                creates?.stencil ??
                spec?.stencils?.[0] ??
                stencils.find((s) => s.simRole === spec?.role)?.id ??
                "generic.service";
              s.editor.addStencil(stencil);
            }
            const before = s.diagram.nodes.length;
            const bindings = s.runner.getSnapshot().subjects;
            const missing = new Set(
              step.demo.flatMap((d) =>
                (d.kind === "add" || d.kind === "insert") && !bindings[d.subject] ? [d.subject] : [],
              ),
            );
            if (!beyond(s, i)) await skip(s, tutorial);
            expect(beyond(s, i)).toBe(true);
            expect(s.diagram.nodes).toHaveLength(before + missing.size);
            for (const [name, id] of Object.entries(bindings))
              if (id && !tutorial.subjects[name].edge) expect(s.subject(name)).toBe(id);
            const bound = Object.values(s.runner.getSnapshot().subjects).filter(Boolean);
            expect(new Set(bound).size).toBe(bound.length);
          });

        lessonIt(`${step.id}: (a) Skip from active advances to the next step`, async () => {
          const s = sandbox(tutorial);
          if (!(await reach(s, tutorial, i))) return expectPassedOver(s, i);
          expect(state(s).value).toBe("active");
          await skip(s, tutorial);
        });

        lessonIt(`${step.id}: (b) Skip from completing advances without repeating an edit`, async () => {
          const s = sandbox(tutorial);
          if (!(await reach(s, tutorial, i))) return expectPassedOver(s, i);
          // The learner's own way: in the name field first, then the edits (unless the check already holds). A subject
          // the step adds has no name field until it exists: adding it opens it (quick-add names what it makes).
          const learning = state(s).value === "active";
          const names =
            step.settle === "naming"
              ? [step.check, ...(step.check.kind === "all" ? step.check.checks : [])].flatMap((c) =>
                  c.kind === "label" ? [c.subject] : [],
                )
              : [];
          const openName = (name: string) => {
            const id = s.runner.getSnapshot().subjects[name];
            if (id)
              s.toMode({ type: "field.focused", target: tutorial.subjects[name]?.boundary ? GROUP_PREFIX + id : id });
          };
          if (learning) names.forEach(openName);
          if (learning)
            for (const demo of step.demo) {
              s.learn(demo);
              if ((demo.kind === "add" || demo.kind === "insert") && names.includes(demo.subject))
                openName(demo.subject);
            }
          // A run the check wants to have played for a while: the learner watches it play.
          if (learning && needsRunTime(step.check))
            for (let frame = 0; frame < 400 && !beyond(s, i) && s.live?.getState().playing; frame++) {
              s.live.advance(250);
              s.live.publish();
            }
          if (typing(s, step.check))
            expect(state(s), "never judged while its text is still being typed").toMatchObject({
              index: i,
              value: "completing",
            });
          if (step.settle) expect(state(s)).toMatchObject({ index: i, value: "completing" });
          if (beyond(s, i)) return;
          // Still current: either settling (completing) or a moment the learner can't be modelled doing.
          if (state(s).value !== "completing")
            expect(step.demo, "an edit that holds can't leave its step active").toEqual([]);
          const before = { version: s.version, diagram: s.diagram };
          await skip(s, tutorial);
          if (step.demo.length) {
            expect(s.version, "Skip from completing repeated an edit").toBe(before.version);
            expect(s.diagram).toBe(before.diagram);
          }
        });

        lessonIt(`${step.id}: (c) Continue lands where it was left, with no extra input`, async () => {
          const landing = await skipLanding(tutorial, i);
          saveProgress(tutorial, i, false);
          const writes = vi.spyOn(localStorage, "setItem");
          const s = sandbox(tutorial);
          expect(state(s).resumeAt).toBe(i);
          s.runner.send({ type: i > 0 ? "resume" : "start" });
          // Live plays on while Continue replays a step that needs run time, as on the canvas.
          const replaysRunTime = tutorial.steps.slice(0, i).some((st) => needsRunTime(st.check));
          await vi.waitFor(
            () => {
              if (replaysRunTime && state(s).value === "reconstructing" && s.live?.getState().playing) {
                s.live.advance(250);
                s.live.publish();
              }
              if (landing === tutorial.steps.length) expect(state(s).value).toBe("finished");
              else expect(state(s)).toMatchObject({ index: landing, value: "active" });
            },
            { timeout: 2000, interval: 1 },
          );
          if (landing < tutorial.steps.length) expect(savedProgress(tutorial)).toMatchObject({ step: landing });
          for (const [, value] of writes.mock.calls) {
            const saved = (JSON.parse(value) as { progress?: Record<string, { step: number; completed: boolean }> })
              .progress?.[tutorial.id];
            if (saved && !saved.completed)
              expect(saved.step, "Continue saved lower progress").toBeGreaterThanOrEqual(i);
          }
        });

        lessonIt(`${step.id}: (d) Show me changes neither the selection nor the document`, async () => {
          const s = sandbox(tutorial);
          if (!(await reach(s, tutorial, i))) return expectPassedOver(s, i);
          const before = { selection: s.mode.selection, version: s.version };
          s.runner.send({ type: "showMe" });
          expect(state(s).value).toBe("hinting");
          expect(s.mode.selection).toEqual(before.selection);
          expect(s.version).toBe(before.version);
          expect(s.hostState.canvas.focusNode).not.toHaveBeenCalled();
          const node = step.targets.find((t) => t.testId.startsWith("node-{"));
          if (node && s.runner.getSnapshot().subjects[node.testId.slice(6, -1)])
            expect(s.hostState.canvas.revealNode).toHaveBeenCalledOnce();
          await skip(s, tutorial);
        });
      });
    });
});

describe("completion regressions", () => {
  itFor(arrange)("arrange: Skip recovers after selection is cleared", async () => {
    const s = sandbox(arrange);
    await reach(s, arrange, 1);
    s.editor.clearSelection();
    await skip(s, arrange);
    expect(state(s)).toMatchObject({ index: 2 });
    expect(new Set(s.diagram.nodes.map((n) => n.y)).size).toBe(1);
  });

  itFor(arrange)("arrange: Skip preserves a sufficient learner selection", async () => {
    const s = sandbox(arrange);
    await reach(s, arrange, 1);
    const ids = s.diagram.nodes.slice(1).map((n) => n.id);
    s.editor.select({ nodeIds: ids });
    await skip(s, arrange);
    expect(s.mode.selection).toEqual(ids);
    expect(s.diagram.nodes[0].y).toBe(60);
    expect(new Set(s.diagram.nodes.slice(1).map((n) => n.y)).size).toBe(1);
  });

  for (const original of ["present", "deleted", "partly inserted"] as const)
    itFor(insertOnEdge)(
      `insert-on-edge: Skip reuses a separately added gateway with original connection ${original}`,
      async () => {
        const s = sandbox(insertOnEdge);
        s.runner.send({ type: "start" });
        const gateway = s.editor.addStencil("aws.api-gateway");
        if (original === "deleted") s.editor.applyDiagram({ ...s.diagram, edges: [] });
        if (original === "partly inserted") s.editor.reconnectEdge("call", "target", gateway);
        await skip(s, insertOnEdge);
        expect(state(s)).toMatchObject({ index: 1 });
        expect(s.subject("gw")).toBe(gateway);
        expect(s.diagram.nodes.filter((n) => n.stencil === "aws.api-gateway")).toHaveLength(1);
        expect(s.diagram.edges.map((e) => [e.from, e.to])).toEqual([
          ["app", gateway],
          [gateway, "api"],
        ]);
      },
    );

  it("boundaries: Group repair preserves existing members and places missing ones without overlap in one edit", async () => {
    const s = sandbox(boundaries);
    await reach(s, boundaries, 1);
    const a = s.subject("a"),
      b = s.subject("b");
    const boundary = s.editor.groupNodes([a]);
    const before = s.diagram.nodes.find((n) => n.id === a);
    const version = s.version;
    await skip(s, boundaries);
    expect(s.diagram.nodes.find((n) => n.id === a)).toEqual(before);
    expect(s.diagram.nodes.find((n) => n.id === b)?.group).toBe(boundary);
    expect(s.version).toBe(version + 1);
    const h = editorHarness(s.diagram);
    const boxes = h
      .nodes()
      .filter((n) => n.type === "diagram")
      .map((n) => ({ id: n.id, ...n.position, width: 220, height: 72 }));
    for (const first of boxes)
      for (const second of boxes) if (first !== second) expect(overlaps(first, second)).toBe(false);
  });

  it("the editor repairs several missing boundary members atomically, with growth and collision rules", async () => {
    const h = editorHarness({
      format: "diagrams/v1",
      title: "Boundary repair",
      edges: [],
      groups: [{ id: "box", label: "Boundary", x: -40, y: -64, width: 300, height: 176 }],
      nodes: [
        { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0, group: "box" },
        { id: "b", stencil: "generic.service", label: "B", x: 600, y: 0 },
        { id: "c", stencil: "generic.service", label: "C", x: 1100, y: 0 },
        { id: "outside", stencil: "generic.service", label: "Outside", x: 0, y: 240 },
      ],
    });
    const before = h.nodes();
    expect(await h.api.moveIntoBoundary(["a", "b", "c"], "box")).toBe(true);
    expect(h.nodes().find((n) => n.id === "a")).toBe(before.find((n) => n.id === "a"));
    expect(h.nodes().find((n) => n.id === "outside")).toBe(before.find((n) => n.id === "outside"));
    expect(h.deps.history.hint).toHaveBeenCalledExactlyOnceWith(undefined);
    const d = h.api.getDiagram();
    const boxes = d.nodes.map((n) => ({ ...n, width: 220, height: 72 }));
    for (const node of boxes) {
      expect(groupOf(d.groups!, node)).toBe(node.id === "outside" ? undefined : "box");
      for (const other of boxes) if (other !== node) expect(overlaps(node, other)).toBe(false);
    }
    const repaired = h.nodes();
    expect(await h.api.moveIntoBoundary(["a", "b", "c"], "box")).toBe(true);
    expect(h.nodes()).toBe(repaired);
    expect(h.deps.history.hint).toHaveBeenCalledTimes(1);
  });

  it("keeps each annotation instruction current until its editor closes, then Skip from there closes it", async () => {
    const s = sandbox(annotate);
    s.runner.send({ type: "start" });
    s.editor.addAnnotation("text");
    expect(state(s)).toMatchObject({ index: 0, value: "completing" });
    s.toMode({ type: "field.left" });
    s.toMode({ type: "annotating", id: null });
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
    s.editor.addAnnotation("note");
    expect(state(s)).toMatchObject({ index: 1, value: "completing" });
    await skip(s, annotate);
    expect(s.diagram.annotations?.map((a) => a.kind)).toEqual(["text", "note"]);
    expect(s.mode.annotating).toBeNull();
  });

  itFor(arrange)(
    "Show me on Align middles keeps the box selection, so Align and Skip both finish the step",
    async () => {
      for (const finish of ["align", "skip"] as const) {
        const s = sandbox(arrange);
        await reach(s, arrange, 1);
        const box = s.mode.selection;
        expect(box).toHaveLength(5);
        s.runner.send({ type: "showMe" });
        expect(s.mode.selection).toEqual(box);
        if (finish === "align") s.editor.align([...box]);
        else await skip(s, arrange);
        expect(state(s)).toMatchObject({ index: 2 });
        expect(new Set(s.diagram.nodes.map((n) => n.y)).size).toBe(1);
        cleanup.reverse().forEach((f) => f());
        cleanup.length = 0;
      }
    },
  );

  it("Skip after adding the topic, before selecting Service 1, selects it without a second topic", async () => {
    const s = sandbox(commandPalette);
    s.runner.send({ type: "start" });
    s.editor.addStencil("kafka.topic");
    expect(state(s)).toMatchObject({ index: 0, value: "completing" });
    await skip(s, commandPalette);
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
    expect(s.diagram.nodes.filter((n) => n.stencil === "kafka.topic")).toHaveLength(1);
    expect(s.mode.selection).toEqual([s.subject("anchor")]);
  });

  it("Present, reload, then Continue from Leave lands on Share: the fresh app is not presenting", async () => {
    const first = sandbox(sharePresent);
    first.runner.send({ type: "start" });
    first.runner.appChanged({ presenting: true, sharing: false });
    expect(savedProgress(sharePresent)).toMatchObject({ step: 1 });
    cleanup.reverse().forEach((f) => f());
    cleanup.length = 0;
    const s = sandbox(sharePresent);
    s.runner.send({ type: "resume" });
    await vi.waitFor(() => expect(state(s)).toMatchObject({ index: 2, value: "active" }), { interval: 1 });
    expect(savedProgress(sharePresent)).toMatchObject({ step: 2 });
  });

  it("Skip presses Live's trace once its lazy session has registered the action", async () => {
    const s = sandbox(liveControlsFixture, { lazyLive: true });
    s.runner.send({ type: "start" });
    const traceNext = vi.spyOn(LiveController.prototype, "traceNext");
    await skip(s, liveControlsFixture);
    expect(traceNext).toHaveBeenCalledOnce();
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
  });

  it("Skip turns Continuous traffic on in the queued saved run, never in the free play before it", async () => {
    const s = sandbox(liveControlsFixture, { lazyLive: true });
    await reach(s, liveControlsFixture, 1);
    // Which run each press lands in, as it's pressed.
    const pressedIn: [string | undefined, boolean][] = [];
    const setTraffic = LiveController.prototype.setTraffic;
    vi.spyOn(LiveController.prototype, "setTraffic").mockImplementation(function (this: LiveController, on) {
      pressedIn.push([this.getState().running?.id, on]);
      setTraffic.call(this, on);
    });
    // Leave Live, so Skip's launch is queued behind free play again.
    s.hostState.live.toggle();
    await skip(s, liveControlsFixture);
    // The session's own: free play with traffic, then the saved run without it; then Skip's, in that run.
    expect(pressedIn).toEqual([
      [undefined, true],
      ["flow", false],
      ["flow", true],
    ]);
    expect(s.live!.getState()).toMatchObject({ traffic: true, running: { id: "flow" } });
  });

  it("Skip after the learner's own free-play traffic still leaves the saved run with Continuous traffic on", async () => {
    const s = sandbox(liveControlsFixture);
    await reach(s, liveControlsFixture, 1);
    s.live!.setTraffic(true);
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
    await skip(s, liveControlsFixture);
    expect(s.live!.getState()).toMatchObject({ traffic: true, running: { id: "flow" } });
  });

  it("an edge test id names the connection's id in the sandbox, as it is now", async () => {
    const s = sandbox(liveControlsFixture);
    await reach(s, liveControlsFixture, 2);
    expect(s.runner.getSnapshot().edges["api->config"]).toBe("saved-elsewhere");
    s.editor.applyDiagram({ ...s.diagram, edges: s.diagram.edges.filter((e) => e.id !== "saved-elsewhere") });
    expect(s.runner.getSnapshot().edges["api->config"]).toBeUndefined();
    const id = s.editor.connect(s.subject("api"), s.subject("config"));
    expect(s.runner.getSnapshot().edges["api->config"]).toBe(id);
    expect(s.runner.getSnapshot().edges["config->api"]).toBeUndefined();
  });

  it("patch demos keep the learner's own settings and write only what's missing, once", async () => {
    const s = sandbox(pathsFixture);
    s.runner.send({ type: "start" });
    const edge = () => s.diagram.edges[0];
    const own = [{ key: "Host", secret: true }, { key: "Port" }, { key: "User" }, { key: "Pool" }];
    s.editor.setEdgeProps(edge().id, { settings: own, timeoutMs: 900 });
    await skip(s, pathsFixture);
    await skip(s, pathsFixture);
    const version = s.version;
    await skip(s, pathsFixture);
    expect(state(s).value).toBe("finished");
    expect(s.version, "one edit for the missing retries, none for what's there").toBe(version + 1);
    expect(edge().props).toEqual({ timeoutMs: 900, settings: [...own, { key: "Token", secret: true }] });
    expect(s.diagram.nodes[0].props).toEqual({ retry: { attempts: 3 } });
  });

  it("Skip adds and names a node the editor commits only after its call returns", async () => {
    const s = sandbox(addNameFixture, { lateAdds: true });
    s.runner.send({ type: "start" });
    await skip(s, addNameFixture);
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
    await skip(s, addNameFixture);
    expect(state(s).value).toBe("finished");
    expect(s.diagram.nodes.filter((n) => n.stencil === "generic.service").map((n) => n.label)).toEqual([
      "Orders",
      "Users",
    ]);
    expect(s.diagram.edges.map((e) => [e.from, e.to])).toEqual([
      ["gw", s.subject("orders")],
      ["gw", s.subject("users")],
    ]);
  });

  /** Live's time, in frames, published once: as the canvas's animation loop drives it. */
  const play = (s: Sandbox, ms: number) => {
    for (let t = 0; t < ms; t += 250) s.live!.advance(250);
    s.live!.publish();
  };
  const sinceKey = JSON.stringify({ node: "first", metric: "processed" });

  it("metric expressions read the real run: sums and comparisons hold by themselves, sinceStep from its start", async () => {
    const s = sandbox(metricsFixture);
    expect(await reach(s, metricsFixture, 2)).toBe(true);
    expect(s.live!.getState().snapshot.nodes[s.subject("first")].replicas).toBe(2);
    s.live!.setTraffic(true);
    s.live!.setPlaying(true);
    // Enough traffic that `since` would hold at once if it counted from the run's start.
    play(s, 6000);
    expect(state(s)).toMatchObject({ index: 3, value: "active" });
    const [base, generation] = state(s).baseline[sinceKey];
    expect(generation).toBe(s.live!.getState().generation);
    expect(base).toBe(s.live!.getState().snapshot.nodes[s.subject("first")].processed);
    expect(base).toBeGreaterThanOrEqual(5);
    let processed = base;
    while (state(s).index === 3) {
      expect(processed - base, "sinceStep counted traffic from before its step").toBeLessThan(5);
      play(s, 250);
      processed = s.live!.getState().snapshot.nodes[s.subject("first")].processed;
    }
    expect(processed - base).toBeGreaterThanOrEqual(5);
    // Fewer waiting in the queue than it has delivered: `lower` holds as soon as it's current.
    expect(state(s).value).toBe("finished");
  });

  it("a sinceStep baseline is read at Continue's handover, kept through observations, and emptied by Skip", async () => {
    saveProgress(metricsFixture, 3, false);
    const s = sandbox(metricsFixture);
    const seen: string[] = [];
    s.runner.subscribe(() => {
      const st = state(s);
      if (Object.keys(st.baseline).length) seen.push(`${st.value}:${st.index}`);
    });
    s.runner.send({ type: "resume" });
    await vi.waitFor(() => expect(state(s)).toMatchObject({ index: 3, value: "active" }), { interval: 1 });
    expect(
      seen.every((at) => at === "active:3"),
      "a baseline only ever belongs to the current step",
    ).toBe(true);
    const captured = state(s).baseline[sinceKey];
    expect(captured).toEqual([0, s.live!.getState().generation]);
    s.live!.setTraffic(true);
    s.live!.setPlaying(true);
    play(s, 250);
    expect(state(s).baseline[sinceKey]).toBe(captured);
    await skip(s, metricsFixture);
    expect(state(s).baseline).toEqual({});
  });

  it("a sinceStep delta counts a restarted run from zero, while the step stays current", async () => {
    const s = sandbox(metricsFixture);
    await reach(s, metricsFixture, 2);
    s.live!.setTraffic(true);
    s.live!.setPlaying(true);
    play(s, 6000);
    expect(state(s)).toMatchObject({ index: 3, value: "active" });
    const [base, generation] = state(s).baseline[sinceKey];
    const entries = s.runner.journal().filter((c) => c.to.index === 3 && c.from.index !== 3).length;
    // Live's Restart: the same diagram, a new run whose counters start again, all of it after the step began.
    s.live!.restart();
    expect(s.live!.getState().generation).toBeGreaterThan(generation);
    const first = () => s.live!.getState().snapshot.nodes[s.subject("first")].processed;
    for (let frame = 0; frame < 200 && state(s).index === 3; frame++) play(s, 250);
    expect(state(s).index === 3, "the restarted run's own traffic completes it").toBe(false);
    expect(s.runner.journal().filter((c) => c.to.index === 3 && c.from.index !== 3).length).toBe(entries);
    expect(first()).toBeGreaterThanOrEqual(5);
    expect(first(), "not judged against the old run's baseline").toBeLessThan(base + 5);
  });

  it("an edit that unsettles an earlier Live step re-enters a sinceStep step with a fresh baseline", async () => {
    const s = sandbox(metricsFixture);
    await reach(s, metricsFixture, 2);
    s.live!.setTraffic(true);
    s.live!.setPlaying(true);
    play(s, 6000);
    const [base] = state(s).baseline[sinceKey];
    // A topology edit: until the rebuilt run shows it, the replicas Live shows aren't this diagram's.
    s.editor.connect(s.subject("app"), s.subject("first"));
    expect(state(s)).toMatchObject({ index: 3, value: "active" });
    expect(state(s).baseline[sinceKey][0]).toBeLessThan(base);
    expect(state(s).baseline[sinceKey][1]).toBe(s.live!.getState().generation);
  });
});
