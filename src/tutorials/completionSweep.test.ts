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
import { LiveController, type LiveState } from "../live/controller";
import { liveActions } from "../live/liveActions";
import { addConsumer } from "../live/addConsumer";
import { planningHost } from "../live/planningHost";
import { capacityView } from "../live/capacityView";
import { freePlaySimulation, withFix } from "../live/capacityModel";
import { capacityOverlay } from "../live/capacityOverlay";
import type { LiveUi } from "../live/context";
import type { SlowState } from "../live/slowmo/session";
import { withSavedSimulation } from "./simulations";
import { actionRegistry, type MenuNode } from "../editor/actions";
import { inferKind } from "../stencils/edgeKind";
import type { AnnotationKind, DiagramEdge, DiagramFile, DiagramNode, Expectation, Side } from "../model/types";
import type { paletteHost } from "../palette/host";
import { allTutorials as tutorials } from "./catalog";
import { commandPalette } from "./catalog/commandPalette";
import { annotate } from "./catalog/annotate";
import { arrange } from "./catalog/arrange";
import { sharePresent } from "./catalog/sharePresent";
import { insertOnEdge } from "./catalog/insertOnEdge";
import { boundaries } from "./catalog/boundaries";
import { partitions } from "./catalog/partitions";
import { outbox } from "./catalog/outbox";
import { threadsBlock } from "./catalog/threadsBlock";
import { timeoutsPools } from "./catalog/timeoutsPools";
import { autoscaling } from "./catalog/autoscaling";
import { scaleToZero } from "./catalog/scaleToZero";
import { webhooks } from "./catalog/webhooks";
import { retryStorm } from "./catalog/retryStorm";
import { backoffBudget } from "./catalog/backoffBudget";
import { circuitBreaker } from "./catalog/circuitBreaker";
import { rateLimit } from "./catalog/rateLimit";
import { sharedApiQuotas } from "./catalog/sharedApiQuotas";
import { backlogLag } from "./catalog/backlogLag";
import { dependencies2 } from "./catalog/dependencies2";
import { studyCheckout } from "./catalog/studyCheckout";
import { studyPayments } from "./catalog/studyPayments";
import { dependencyVisibility } from "../canvas/dependencyVisibility";
import { authorADrill } from "./catalog/authorADrill";
import { faults } from "./catalog/faults";
import { stencils } from "../stencils/registry";
import { editorHarness } from "../test/editorHarness";
import { overlaps } from "../canvas/placement";
import { groupOf } from "../canvas/membership";
import { inStep } from "./machine";
import { savedProgress, saveProgress } from "./progress";
import { createTutorialRunner } from "./runner";
import type { Check, Demo, Tutorial, TutorialStep } from "./types";
import { patchProps } from "./paths";
import {
  addNameFixture,
  liveControlsFixture,
  livePanelsFixture,
  metricsFixture,
  pathsFixture,
  savedSimulationsFixture,
  slowMotionFixture,
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
 * lateConnects: a repaired connection also commits after connect returns, including when its nodes already exist.
 * lazyLive: going live shows free play first; Live's actions arrive a task later, as the lazy session's chunk mounts
 * them, and a queued saved run a task after that (the session's own effect activates it).
 */
function sandbox(tutorial: Tutorial, { lateAdds = false, lateConnects = false, lazyLive = false } = {}) {
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
  let offUi: (() => void) | undefined;
  /** Live's panels, as the session holds them; published with its controller (planningHost), as LiveSession does. */
  const panels = { capacityOpen: false, panelOpen: false, events: { open: false, nodeId: null as string | null } };
  /** Live's panels publish as LiveSession renders: after the call that changed them, never inside it. */
  const renderUi = () => queueMicrotask(publishUi);
  const publishUi = () => {
    const c = controller;
    if (!c) return;
    offUi?.();
    offUi = planningHost.publish({
      controller: c,
      ...panels,
      events: { ...panels.events },
      openCapacity: (open = true) => {
        panels.capacityOpen = open;
        if (open) capacityOverlay.showForSession();
        renderUi();
      },
      showEvents: (nodeId: string | null, open = true) => {
        panels.events = { open, nodeId };
        renderUi();
      },
      openPanel: () => {
        panels.panelOpen = true;
        renderUi();
      },
    } as unknown as LiveUi);
  };
  /** Slow motion, as its session publishes it: started by Live's actions, played to the end of its script. */
  const slowListeners = new Set<() => void>();
  const SLOW_SCRIPT = { duration: 1200 };
  let slowState: Pick<SlowState, "status" | "playing" | "t"> & { script: { duration: number } | null } = {
    status: "off",
    playing: false,
    t: 0,
    script: null,
  };
  const setSlow = (next: typeof slowState) => {
    slowState = next;
    slowListeners.forEach((f) => f());
  };
  const slow = {
    getState: () => slowState,
    subscribe: (f: () => void) => {
      slowListeners.add(f);
      return () => void slowListeners.delete(f);
    },
    end: () => setSlow({ status: "off", playing: false, t: 0, script: null }),
    start: () => setSlow({ status: "on", playing: true, t: 0, script: SLOW_SCRIPT }),
    /** Its replay plays on: at the end of the script it stops there (the machine's `finished`). */
    play(ms: number) {
      if (slowState.status !== "on" || !slowState.playing) return;
      const t = Math.min(SLOW_SCRIPT.duration, slowState.t + ms);
      setSlow({ ...slowState, t, playing: t < SLOW_SCRIPT.duration });
    },
  };
  /** The same capacity calculation and saved-run fix as the real Apply fix control. */
  const capacityFix = () => {
    const c = controller;
    if (!c || !capacityOverlay.get()) return undefined;
    const state = c.getState();
    return capacityView(diagram, state.running ?? freePlaySimulation(diagram, state.inputs)).fix ?? undefined;
  };
  /** Live's own actions over this run, as its session registers them: Skip's controls press these rows. */
  const actionsOf = (c: LiveController) =>
    liveActions({
      controller: c,
      slowMotionActive: () => slowState.status !== "off",
      openInject: () => {},
      startStorm: () => {},
      showEvents: () => {},
      trace: () => {},
      tracing: () => null,
      traceNext: (nodeId) => c.traceNext(nodeId),
      traceSlowest: () => {},
      traceDeadLettered: () => {},
      slowMotion: () => slow.start(),
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
      hostState.session.state = c.getState;
      offActions = actionRegistry.register([
        ...actionsOf(c),
        {
          id: "sim.capacity-fix",
          section: "simulation",
          targets: ["canvas"],
          modes: ["live"],
          paletteOnly: true,
          label: "Apply fix",
          when: () => !!capacityFix(),
          run: () => {
            const fix = capacityFix();
            if (!fix) return;
            const base = c.getState().simulation;
            if (base) {
              const next = withFix(base, fix);
              editor.updateMeta({
                simulations: (diagram.simulations ?? []).map((sim) => (sim.id === next.id ? next : sim)),
              });
              c.setBase(next);
            } else {
              for (const change of fix.changes) editor.setNodeProps(change.nodeId, { [change.key]: change.to });
            }
          },
        },
      ]);
      publishUi();
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
    // The canvas republishes as the live view takes over: for a moment there's no editor to act through.
    const editorApi = hostState.canvas.editor;
    if (mounting) hostState.canvas.editor = undefined as unknown as EditorApi;
    publishLive();
    const later = (f: () => void) => setTimeout(f, 0);
    later(() => {
      hostState.canvas.editor = editorApi;
      publishLive();
      later(() => {
        mount();
        publishLive();
        later(() => {
          run();
          publishLive();
        });
      });
    });
  };
  const leaveLive = () => {
    hostState.canvas.live = false;
    slow.end();
    offUi?.();
    offUi = undefined;
    panels.capacityOpen = panels.panelOpen = false;
    panels.events = { open: false, nodeId: null };
    capacityOverlay.endSession();
    hostState.session.state = () => undefined;
    offActions?.();
    offActions = undefined;
    offController?.();
    controller?.dispose();
    controller = undefined;
    notify();
  };
  cleanup.push(() => {
    leaveLive();
    // Module stores outlive a sandbox: the next lesson starts as a fresh app would.
    capacityOverlay.set(false);
  });
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
    kind: inferKind(diagram.nodes.find((n) => n.id === from)?.stencil, diagram.nodes.find((n) => n.id === to)?.stencil),
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
      // Quick-add infers from the new stencil before its node is committed, as the real editor does.
      const edge = {
        ...newEdge(from, node.id),
        kind: inferKind(diagram.nodes.find((n) => n.id === from)?.stencil, stencil),
      };
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
      const publish = () => write({ ...diagram, edges: [...diagram.edges, edge] });
      if (lateConnects) queueMicrotask(publish);
      else publish();
      return edge.id;
    },
    updateNode: (id: string, patch: Partial<DiagramNode>) =>
      write({ ...diagram, nodes: diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
    updateGroup: (id: string, patch: { label?: string }) =>
      write({ ...diagram, groups: diagram.groups?.map((g) => (g.id === id ? { ...g, ...patch } : g)) }),
    updateEdge: patchEdge,
    updateMeta: (patch: Partial<DiagramFile>) => write({ ...diagram, ...patch }),
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
  let readout: { kind: "node" | "edge"; id: string; pinned: boolean } | null = null;
  const readoutListeners = new Set<() => void>();
  const readouts = {
    get: () => readout,
    subscribe: (f: () => void) => {
      readoutListeners.add(f);
      return () => void readoutListeners.delete(f);
    },
  };
  /** The pointer over an item in Live, opening its hover card (or off everything). */
  const hover = (target: { kind: "node" | "edge"; id: string } | null) => {
    readout = target && { ...target, pinned: false };
    readoutListeners.forEach((f) => f());
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
      // Each session publishes its own controller's reader (useLiveSessionState): a remount is another session.
      state: (() => undefined) as () => LiveState | undefined,
      slowmo: slow,
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
      // Live's hover cards: attached while Live shows them, as NodeBadges attaches its readout layer.
      get readouts() {
        return hostState.canvas.live ? readouts : null;
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
  /** A Live registry row, as a menu offers it now (its availability guards included); throws if it isn't offered. */
  function pressRow(id: string, targetId?: string, kind: "node" | "edge" | "group" = "node") {
    const find = (items: MenuNode[]): (() => void) | undefined => {
      for (const item of items) {
        if (item.type !== "item" || item.disabled) continue;
        if (item.id === id) return item.run;
        const nested = item.children && find(item.children);
        if (nested) return nested;
      }
    };
    const run = find(
      actionRegistry.build({
        editor: editor as unknown as EditorApi,
        mode: "live",
        surface: "palette",
        selection: editor.getSelection(),
        ...(targetId === undefined
          ? { target: "canvas" as const }
          : kind === "edge"
            ? { target: "edge" as const, edgeId: targetId }
            : kind === "group"
              ? { target: "group" as const, groupId: targetId }
              : { target: "node" as const, nodeId: targetId }),
      }),
    );
    if (!run) throw new Error(`Live doesn't offer ${id} now`);
    run();
  }
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
    slow,
    hover,
    /** Live's own registry row, pressed as the learner presses it in a menu. */
    press: (id: string, nodeId?: string) => pressRow(id, nodeId),
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
        case "fault": {
          const target = demo.edge ? edge(demo.edge).id : id(demo.subject);
          const group = isGroup(target);
          // An uncut link offers Cut, not Restore: a restore demo has nothing for the learner to do.
          if (
            demo.restore &&
            demo.fault === "cut" &&
            !controller!.getState().snapshot.faults?.some((fault) => fault.kind === "link" && fault.edge === target)
          )
            return;
          // As the Fault menu offers them: Take down and Cut toggle (their Restore is the same row).
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
          return pressRow(action, target, demo.edge ? "edge" : group ? "group" : "node");
        }
        case "slowmo":
          return demo.subject ? pressRow("sim.slowmo-from", id(demo.subject)) : slow.start();
        case "inject":
          return pressRow(`sim.inject:${demo.count}`, id(demo.subject));
        case "applyFix":
          return pressRow("sim.capacity-fix");
        case "inputs":
          return controller!.setInputs({ ...controller!.getState().inputs, [demo.input]: demo.value });
        case "openView": {
          const ui = planningHost.get()!;
          if (demo.view === "capacity") return capacityOverlay.set(true);
          if (demo.view === "inputs") return ui.openCapacity(true);
          if (demo.view === "events") return ui.showEvents(null, true);
          return ui.openPanel();
        }
        case "saveSimulation": {
          const simulations = withSavedSimulation(diagram, demo);
          return simulations && editor.updateMeta({ simulations });
        }
        case "continueNote":
          // The learner reads the note, then presses its Continue.
          if (controller?.getState().run?.waiting) controller.resume();
          return;
      }
    },
  };
}
type Sandbox = ReturnType<typeof sandbox>;

it("author-a-drill: Skip can run after the learner saved their Drill under another id", async () => {
  const s = sandbox(authorADrill);
  const run = authorADrill.steps.findIndex((step) => step.id === "run");
  expect(await reach(s, authorADrill, run)).toBe(true);
  s.editor.updateMeta({
    simulations: s.diagram.simulations?.map((sim) => (sim.id === "simulation" ? { ...sim, id: "learner-drill" } : sim)),
  });
  await skip(s, authorADrill);
  expect(state(s).value).toBe("finished");
  expect(s.diagram.simulations?.some((sim) => sim.id === "learner-drill")).toBe(true);
});

it("author-a-drill: closing the editor at Run keeps progress until the saved Drill is picked", async () => {
  const s = sandbox(authorADrill);
  const run = authorADrill.steps.findIndex((step) => step.id === "run");
  expect(await reach(s, authorADrill, run)).toBe(true);
  cleanup.push(planningHost.publish({ ...planningHost.get()!, panelOpen: false }));
  expect(state(s)).toMatchObject({ index: run, value: "active" });
  s.live!.selectSimulation(s.diagram.simulations!.find((sim) => sim.id === "simulation")!);
  expect(state(s).value).toBe("finished");
});

const state = (s: Sandbox) => s.runner.getSnapshot().state;
const beyond = (s: Sandbox, i: number) => state(s).value === "finished" || (inStep(state(s)) && state(s).index > i);

/** A check that needs the run to have played for a while: Live's time has to move for it. */
const checkNeedsTime = (check: Check): boolean =>
  check.kind === "all" ? check.checks.some(checkNeedsTime) : check.kind === "simulation" && !!check.atLeastMs;
/** A step whose check needs run time, or whose injected messages need it to arrive. */
const needsRunTime = (step: TutorialStep): boolean =>
  checkNeedsTime(step.check) || step.demo.some((d) => d.kind === "inject");

async function skip(s: Sandbox, tutorial: Tutorial) {
  const before = state(s);
  const step = tutorial.steps[before.index];
  s.runner.send({ type: "skip", stepId: step.id });
  await vi.waitFor(
    () => {
      // Live keeps playing while Skip's edits land, as on the canvas; only a step that needs run time sees it move,
      // so no other step's moment passes early.
      if (needsRunTime(step) && s.live?.getState().playing) {
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
  const stored = localStorage.getItem("diagrams.tutorials.v1");
  const s = sandbox(tutorial);
  await reach(s, tutorial, k);
  const landed = state(s).value === "finished" ? tutorial.steps.length : state(s).index;
  cleanup.reverse().forEach((f) => f());
  cleanup.length = 0;
  // This independent probe may finish the lesson; its completion must not become the resume case's saved input.
  if (stored === null) localStorage.removeItem("diagrams.tutorials.v1");
  else localStorage.setItem("diagrams.tutorials.v1", stored);
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
          // Live's panels publish when LiveSession renders, just after the click that opened them.
          if (learning) await new Promise<void>((done) => queueMicrotask(done));
          // A run the check wants to have played for a while: the learner watches it play, pressing Continue on each note
          // the step is about.
          const continues = step.demo.some((d) => d.kind === "continueNote");
          if (learning && needsRunTime(step))
            for (let frame = 0; frame < 400 && !beyond(s, i) && s.live?.getState().playing; frame++) {
              if (continues && s.live.getState().run?.waiting) s.live.resume();
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
          const replaysRunTime = tutorial.steps.slice(0, i).some((st) => needsRunTime(st));
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
          // Slow motion owns the camera while it's on: Show me points without moving it.
          if (s.slow.getState().status !== "off") expect(s.hostState.canvas.revealNode).not.toHaveBeenCalled();
          else if (node && s.runner.getSnapshot().subjects[node.testId.slice(6, -1)])
            expect(s.hostState.canvas.revealNode).toHaveBeenCalledOnce();
          await skip(s, tutorial);
        });
      });
    });
});

describe("completion regressions", () => {
  it.each([false, true])(
    "dead-letter-disputes Skip waits for a repaired DLQ connection (editing: %s)",
    async (editing) => {
      const s = sandbox(studyPayments, { lateAdds: true, lateConnects: true, lazyLive: true });
      const i = studyPayments.steps.findIndex((step) => step.id === "dead-letter-disputes");
      expect(await reach(s, studyPayments, i)).toBe(true);
      if (editing) s.hostState.live.toggle();
      const diagram = structuredClone(s.diagram);
      diagram.nodes.push({ id: "learner-dlq", stencil: "aws.sqs", label: "My recovery queue", x: 900, y: 500 });
      s.editor.applyDiagram(diagram);
      expect(s.subject("dlq")).toBe("learner-dlq");
      const from = s.subject("outbox");
      expect(s.diagram.edges.some((edge) => edge.from === from && edge.to === "learner-dlq")).toBe(false);
      await skip(s, studyPayments);
      const repaired = s.diagram.edges.filter((edge) => edge.from === from && edge.to === "learner-dlq");
      expect(repaired).toHaveLength(1);
      expect(repaired[0]).toMatchObject({ kind: "async", relation: "flow", props: { dlq: true } });
      expect(s.diagram.nodes).toEqual(
        diagram.nodes.map((node) =>
          node.id === s.subject("consumer") ? { ...node, props: { ...node.props, failureRate: 1 } } : node,
        ),
      );
      expect(s.live!.getState().snapshot.nodes["learner-dlq"].processed).toBeGreaterThanOrEqual(1);
      expect(beyond(s, i)).toBe(true);
    },
  );

  for (const tutorial of [studyCheckout, studyPayments])
    for (const [i, step] of tutorial.steps.entries()) {
      const relations = (check: Check): Extract<Check, { kind: "relation" }>[] =>
        check.kind === "all" ? check.checks.flatMap(relations) : check.kind === "relation" ? [check] : [];
      for (const required of relations(step.check))
        for (const perturbation of ["learner changed kind", "learner removed a required relationship"] as const)
          it(`${tutorial.id}: ${step.id} Skip recovers after ${perturbation} (${required.from} → ${required.to})`, async () => {
            const s = sandbox(tutorial);
            expect(await reach(s, tutorial, i)).toBe(true);
            // Build the learner's partial outbox in one document write, so a correct intermediate graph cannot
            // advance the milestone before its mistaken relationship lands.
            const diagram = structuredClone(s.diagram);
            const subjects = { ...s.runner.getSnapshot().subjects };
            for (const demo of step.demo) {
              if (demo.kind !== "add") continue;
              const id = subjects[demo.subject] ?? `learner-${demo.subject}`;
              if (!subjects[demo.subject]) {
                diagram.nodes.push({ id, stencil: demo.stencil, label: "Learner", x: 0, y: 500 });
                subjects[demo.subject] = id;
              }
              const from = demo.after && subjects[demo.after];
              if (from && !diagram.edges.some((edge) => edge.from === from && edge.to === id))
                diagram.edges.push({ id: `learner-${from}-${id}`, from, to: id, kind: "async" });
            }
            const from = subjects[required.from]!,
              to = subjects[required.to]!;
            const original = diagram.edges.find((edge) => edge.from === from && edge.to === to)!;
            expect(original).toBeDefined();
            original.props = { ...original.props, latencyMs: 17 };
            if (perturbation === "learner changed kind")
              original.kind = required.edgeKind === "sync" ? "async" : "sync";
            else diagram.edges = diagram.edges.filter((edge) => edge !== original);
            s.editor.applyDiagram(diagram);
            expect(state(s)).toMatchObject({ index: i, value: "active" });
            await skip(s, tutorial);
            const repaired = s.diagram.edges.filter((edge) => edge.from === from && edge.to === to);
            expect(repaired).toHaveLength(1);
            expect(repaired[0].kind).toBe(required.edgeKind);
            expect(repaired[0].relation ?? "flow").toBe(required.relation);
            if (perturbation === "learner changed kind") {
              expect(repaired[0].id).toBe(original.id);
              expect(repaired[0].props?.latencyMs).toBe(17);
            }
            expect(s.diagram.nodes).toHaveLength(diagram.nodes.length);
          });
    }

  it("keep-orders Skip restores the Orders DB Request", async () => {
    const s = sandbox(studyCheckout);
    const i = studyCheckout.steps.findIndex((step) => step.id === "keep-orders");
    expect(await reach(s, studyCheckout, i)).toBe(true);
    s.editor.updateEdge("checkout-orders", { kind: "async" });
    await skip(s, studyCheckout);
    expect(s.diagram.edges.find((edge) => edge.id === "checkout-orders")?.kind).toBe("sync");
    expect(beyond(s, i)).toBe(true);
  });

  it("survive-psp-brownout Skip recovers after learner disabled breaker", async () => {
    const s = sandbox(studyPayments);
    const i = studyPayments.steps.findIndex((step) => step.id === "survive-psp-brownout");
    expect(await reach(s, studyPayments, i)).toBe(true);
    // The inspector's On then Off writes an explicit null, rather than removing the property.
    s.learn({
      kind: "patch",
      edge: ["payments", "psp"],
      patches: [{ op: "set", path: ["caller", "breaker"], value: {} }],
    });
    s.learn({
      kind: "patch",
      edge: ["payments", "psp"],
      patches: [{ op: "set", path: ["caller", "breaker"], value: null }],
    });
    await skip(s, studyPayments);
    expect(s.diagram.edges.find((edge) => edge.id === "payments-psp")?.props?.caller).toMatchObject({ breaker: {} });
    expect(s.live!.getState().snapshot.edges["payments-psp"].breaker?.state).toBe("open");
    expect(beyond(s, i)).toBe(true);
  });

  for (const tutorial of [threadsBlock, timeoutsPools])
    for (const [i, step] of tutorial.steps.entries()) {
      if (!step.demo.some((d) => d.kind === "patch" && d.edge)) continue;
      for (const entry of ["Skip", "Continue"] as const)
        it(`${tutorial.id}: ${entry} past ${step.id} leaves its rerun ready without toggling Live off`, async () => {
          if (entry === "Continue") saveProgress(tutorial, i + 1, false);
          const s = sandbox(tutorial);
          if (entry === "Skip") {
            await reach(s, tutorial, i);
            await skip(s, tutorial);
          } else {
            s.runner.send({ type: "resume" });
            await vi.waitFor(
              () => {
                if (state(s).value === "reconstructing" && s.live?.getState().playing) {
                  s.live.advance(250);
                  s.live.publish();
                }
                expect(state(s).value).toBe("active");
              },
              { timeout: 2000, interval: 1 },
            );
          }
          expect(s.hostState.canvas.live).toBe(true);
          expect(state(s).index).toBe(i + 2);
          expect(tutorial.steps[state(s).index].solution[0]).toHaveProperty("select", "live-sim-picker");
          const rerun = tutorial.steps[state(s).index].demo[0];
          expect(rerun.kind).toBe("runSimulation");
          await s.learn(rerun);
          expect(s.live!.getState().running?.id).toBe(rerun.kind === "runSimulation" ? rerun.id : "");
        });
    }

  it("timeouts-pools: leaving Live for the second edit keeps earlier entry complete and the next entry pending", async () => {
    const s = sandbox(timeoutsPools);
    const pool = timeoutsPools.steps.findIndex((step) => step.id === "pool-40");
    await reach(s, timeoutsPools, pool);
    s.hostState.live.toggle();
    expect(state(s)).toMatchObject({ index: pool, value: "active" });
    await s.learn(timeoutsPools.steps[pool].demo[0]);
    expect(state(s)).toMatchObject({ index: pool + 1, value: "active" });
    expect(s.hostState.canvas.live).toBe(false);
    expect(timeoutsPools.steps[pool + 1].solution).toEqual([{ click: "live-toggle" }]);
    s.hostState.live.toggle();
    expect(state(s)).toMatchObject({ index: pool + 2, value: "active" });
  });

  it("autoscaling cannot latch replicas-grow behind the setting step with its readout closed", async () => {
    const s = sandbox(autoscaling);
    await reach(s, autoscaling, 1);
    for (let t = 0; t < 9000; t += 10) s.live!.advance(10);
    s.live!.publish();
    expect(s.live!.getState().snapshot.nodes[s.subject("caller")].replicas).toBeGreaterThan(4);
    expect(state(s).latched[2]).toBe(false);
    await s.learn(autoscaling.steps[1].demo[0]);
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    // Changing the scaling policy rebuilds the run. It must still wait for a readout once the fleet grows again.
    for (let t = 0; t < 9000; t += 10) s.live!.advance(10);
    s.live!.publish();
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    s.hover({ kind: "node", id: s.subject("caller") });
    expect(state(s).value).toBe("finished");
  });

  it("scale-to-zero: a late readout still observes the cold start", async () => {
    const s = sandbox(scaleToZero);
    const coldStart = scaleToZero.steps.findIndex((step) => step.id === "cold-start");
    await reach(s, scaleToZero, coldStart);
    // The learner reads the instructions away from the node for longer than the entire saved run.
    for (let frame = 0; frame < 700; frame++) play(s, 100);
    expect(state(s)).toMatchObject({ index: coldStart, value: "active" });
    expect(s.live!.getState().snapshot.nodes[s.subject("worker")].fleet!.starting).toBeGreaterThanOrEqual(1);
    s.hover({ kind: "node", id: s.subject("worker") });
    expect(state(s).value).toBe("finished");
  });

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

  itFor(dependencies2)("dependencies-2 shows hidden Dependencies before targeting Config", () => {
    const previous = dependencyVisibility.get();
    cleanup.push(() => dependencyVisibility.set(previous));
    dependencyVisibility.set(false);
    const s = sandbox(dependencies2);
    s.runner.send({ type: "start" });
    expect(dependencies2.steps[state(s).index].id).toBe("show-dependencies");
    dependencyVisibility.set(true);
    expect(dependencies2.steps[state(s).index].id).toBe("add-setting");
  });

  it("partitions retains read-idle until acknowledged", async () => {
    const s = sandbox(partitions);
    s.live!.advance(250);
    s.live!.publish();
    expect(s.live!.getState().snapshot.nodes[s.subject("consumers")].idleReplicas).toBeGreaterThan(0);
    s.runner.send({ type: "start" });
    expect(state(s)).toMatchObject({ index: 0, value: "active" });
    s.live!.advance(250);
    s.live!.publish();
    expect(state(s)).toMatchObject({ index: 0, value: "active" });
    await skip(s, partitions);
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
  });

  it("outbox preserves the reading instruction through Continue and can Skip it", async () => {
    const s = sandbox(outbox);
    await reach(s, outbox, 1);
    s.learn({ kind: "runSimulation", id: "happy-path" });
    s.live!.advance(250);
    s.live!.publish();
    expect(s.live!.getState().run?.waiting).toBe(true);
    expect(outbox.steps[state(s).index].id).toBe("read-happy-path");
    s.live!.resume();
    expect(outbox.steps[state(s).index].id).toBe("read-happy-path");
    await skip(s, outbox);
    expect(outbox.steps[state(s).index].id).toBe("watch-compensation");
    s.learn({ kind: "runSimulation", id: "declines" });
    for (let frame = 0; frame < 40; frame++) s.live!.advance(250);
    s.live!.publish();
    expect(s.live!.getState().run!.time).toBeGreaterThanOrEqual(2500);
    expect(state(s)).toMatchObject({ index: 3, value: "active" });
    await skip(s, outbox);
    expect(state(s).value).toBe("finished");
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

  it.each(["menu", "Skip"] as const)("faults: Restore completes with an additional slowdown (%s)", async (finish) => {
    const s = sandbox(faults);
    expect(await reach(s, faults, 1)).toBe(true);
    const api = s.subject("api");
    s.press("sim.slow:5", api);
    s.press("sim.kill", api);
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    if (finish === "menu") s.press("sim.kill", api);
    else await skip(s, faults);
    expect(state(s).value).toBe("finished");
    expect(s.live!.getState().snapshot.nodes[api].status).toBe("up");
    expect(s.live!.getState().snapshot.faults).toContainEqual({ kind: "slow", node: api, factor: 5 });
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

  it("retry-storm: reading the caller leads to failed attempts and the saved failed backlog expectation", async () => {
    const s = sandbox(retryStorm);
    s.runner.send({ type: "start" });
    expect(retryStorm.steps[state(s).index].id).toBe("watch-waiting");
    s.hover({ kind: "node", id: s.subject("caller") });
    expect(retryStorm.steps[state(s).index].id).toBe("watch-failed");
    play(s, 2000);
    expect(s.live!.getState().snapshot.nodes[s.subject("callee")].failed).toBeGreaterThan(0);
    expect(retryStorm.steps[state(s).index].id).toBe("expect-backlog");
    play(s, 58000);
    expect(state(s).value).toBe("finished");
    expect(s.live!.getState().run!.expectations).toContainEqual(
      expect.objectContaining({ id: "backlog", status: "fail" }),
    );
  });

  it("backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers", async () => {
    const s = sandbox(backoffBudget);
    await reach(s, backoffBudget, 3);
    const edge = s.diagram.edges.find((e) => e.from === s.subject("caller") && e.to === s.subject("callee"))!;
    expect(edge.props).toMatchObject({ caller: { retry: { backoffMs: 100, budget: { percent: 20 } } } });
    const seed = s.live!.getState().running!.seed;
    play(s, 60000);
    expect(backoffBudget.steps[state(s).index].id).toBe("run-budget");
    expect(s.live!.getState().run!.expectations).toContainEqual(
      expect.objectContaining({ id: "backlog", status: "fail" }),
    );
    await skip(s, backoffBudget);
    expect(s.live!.getState().running!.seed).toBe(seed);
    expect(backoffBudget.steps[state(s).index].id).toBe("compare");
    play(s, 60000);
    expect(state(s).value).toBe("finished");
    for (const id of ["backlog", "goodput"])
      expect(s.live!.getState().run!.expectations).toContainEqual(expect.objectContaining({ id, status: "pass" }));
  });

  it.each([0, 37, undefined])(
    "backoff-budget: Skip repairs percent and preserves a customized floor (%s)",
    async (minPerSec) => {
      const s = sandbox(backoffBudget);
      await reach(s, backoffBudget, 1);
      const edge = s.diagram.edges.find((e) => e.from === s.subject("caller") && e.to === s.subject("callee"))!;
      s.editor.setEdgeProps(edge.id, {
        caller: {
          retry: {
            backoffMs: 100,
            maxAttempts: 7,
            budget: { percent: 60, ...(minPerSec === undefined ? {} : { minPerSec }) },
          },
        },
      });
      await skip(s, backoffBudget);
      expect(s.diagram.edges.find((e) => e.id === edge.id)!.props).toMatchObject({
        caller: { retry: { backoffMs: 100, maxAttempts: 7, budget: { percent: 20, minPerSec: minPerSec ?? 10 } } },
      });
      expect(state(s).index).toBe(2);
    },
  );

  it.each([{}, { failurePercent: 25, minimumCalls: 8, openMs: 9000 }])(
    "circuit-breaker: accepts enabled configuration %j without overwriting it",
    (breaker) => {
      const s = sandbox(circuitBreaker);
      s.runner.send({ type: "start" });
      expect(state(s).index).toBe(0);
      const edge = s.diagram.edges.find((e) => e.from === s.subject("caller") && e.to === s.subject("callee"))!;
      s.editor.setEdgeProps(edge.id, { caller: { breaker } });
      expect(state(s)).toMatchObject({ index: 1, value: "active" });
      expect(s.diagram.edges.find((e) => e.id === edge.id)!.props).toMatchObject({ caller: { breaker } });
    },
  );

  it("circuit-breaker: initial Closed never completes recovery; real playback opens, tests and closes", async () => {
    const s = sandbox(circuitBreaker);
    await reach(s, circuitBreaker, 2);
    expect(state(s).latched[4]).toBe(false);
    const seen = new Set<string>();
    for (let frame = 0; frame < 240 && state(s).value !== "finished"; frame++) {
      play(s, 250);
      const edge = s.diagram.edges.find((e) => e.from === s.subject("caller") && e.to === s.subject("callee"))!;
      const reading = s.live!.getState().snapshot.edges[edge.id]?.breaker?.state;
      if (reading) seen.add(reading);
    }
    expect(seen).toEqual(new Set(["closed", "open", "half-open"]));
    expect(state(s).value).toBe("finished");
    expect(state(s).latched.slice(2)).toEqual([true, true, true]);
  });

  it("shared-api-quotas: reaching the comparison actually selects the smaller batch", async () => {
    const s = sandbox(sharedApiQuotas);
    await reach(s, sharedApiQuotas, 4);
    expect(sharedApiQuotas.steps[state(s).index].id).toBe("served");
    expect(s.live!.getState().running!.id).toBe("within-budget");
  });

  it("backlog-lag: the connected consumer keeps up in the rebuilt run", async () => {
    const s = sandbox(backlogLag);
    await reach(s, backlogLag, 3);
    expect(backlogLag.steps[state(s).index].id).toBe("consumer-progress");
    expect(s.live!.getState().snapshot.nodes[s.subject("worker")].processed).toBe(0);
    s.hover({ kind: "node", id: s.subject("worker") });
    expect(state(s).value).toBe("active");
    play(s, 10000);
    expect(state(s).value).toBe("finished");
    expect(s.live!.getState().snapshot.nodes[s.subject("worker")].processed).toBeGreaterThanOrEqual(50);
    expect(s.live!.getState().snapshot.nodes[s.subject("queue")].backlog).toBeLessThanOrEqual(10);
  });

  it("backlog-lag: Add a consumer advances with an unrelated service", async () => {
    const s = sandbox(backlogLag);
    expect(await reach(s, backlogLag, 2)).toBe(true);
    const unrelated = s.editor.addStencil("generic.service");
    const consumer = addConsumer(s.editor as unknown as EditorApi, s.subject("queue"));
    expect(consumer).not.toBeNull();
    expect(consumer).not.toBe(unrelated);
    expect(state(s)).toMatchObject({ index: 3, value: "active" });
    expect(s.subject("worker")).toBe(consumer);
    play(s, 10000);
    s.hover({ kind: "node", id: unrelated });
    expect(state(s)).toMatchObject({ index: 3, value: "active" });
    s.hover({ kind: "node", id: consumer! });
    expect(state(s).value).toBe("finished");
    expect(s.live!.getState().snapshot.nodes[consumer!].processed).toBeGreaterThanOrEqual(50);
  });

  it("rate-limit's edited inline quota refuses excess requests before the API", async () => {
    const s = sandbox(rateLimit);
    await reach(s, rateLimit, 2);
    s.hover({ kind: "node", id: s.subject("limiter") });
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    s.hover(null);
    play(s, 10000);
    expect(s.live!.getState().snapshot.nodes[s.subject("limiter")].rejected).toBeGreaterThanOrEqual(10);
    expect(s.live!.getState().snapshot.nodes[s.subject("api")].processed).toBeGreaterThan(0);
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    expect(state(s).latched[2]).toBe(false);
    s.hover({ kind: "node", id: s.subject("api") });
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    s.hover({ kind: "node", id: s.subject("limiter") });
    expect(state(s).value).toBe("finished");
  });

  it("webhooks: Skip continues the paused note and watching completes expect-parked", async () => {
    const s = sandbox(webhooks);
    expect(await reach(s, webhooks, 1)).toBe(true);
    play(s, 6500);
    expect(s.live!.getState().run).toMatchObject({ time: 6500, waiting: true });
    await skip(s, webhooks);
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    expect(s.live!.getState().run).toMatchObject({ waiting: false });
    play(s, 3000);
    expect(s.live!.getState().run!.expectations).toContainEqual(
      expect.objectContaining({ id: "parked", status: "pass" }),
    );
    expect(state(s).value).toBe("finished");
  });

  it("webhooks: resume at expect-parked continues the note before watching completes", async () => {
    saveProgress(webhooks, 2, false);
    const s = sandbox(webhooks);
    s.runner.send({ type: "resume" });
    for (let frame = 0; frame < 400 && state(s).value === "reconstructing"; frame++) {
      if (s.live?.getState().playing) play(s, 250);
      await Promise.resolve();
    }
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    expect(s.live!.getState().run).toMatchObject({ waiting: false });
    expect(s.live!.getState().run!.time).toBeGreaterThanOrEqual(6500);
    play(s, 3000);
    expect(s.live!.getState().run!.expectations).toContainEqual(
      expect.objectContaining({ id: "parked", status: "pass" }),
    );
    expect(state(s).value).toBe("finished");
  });

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
    // Bounded: traffic that stops flowing fails here, rather than hanging the worker.
    for (let frame = 0; frame < 400 && state(s).index === 3; frame++) {
      expect(processed - base, "sinceStep counted traffic from before its step").toBeLessThan(5);
      play(s, 250);
      processed = s.live!.getState().snapshot.nodes[s.subject("first")].processed;
    }
    expect(state(s).index, "the step advanced on its own traffic").not.toBe(3);
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
    expect(captured).toEqual([0, s.live!.getState().generation, expect.any(Number)]);
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
  it("Continue replays a sinceStep step that has a demo: what it counted is history, the rest must hold", async () => {
    const tutorial: Tutorial = {
      ...metricsFixture,
      steps: [
        { ...metricsFixture.steps[0], sticky: true },
        {
          ...metricsFixture.steps[3],
          id: "slowed",
          check: {
            kind: "all",
            checks: [
              { kind: "fault", subject: "first", fault: "slow" },
              { kind: "compare", left: { sinceStep: { node: "first", metric: "processed" } }, op: ">=", right: 5 },
            ],
          },
          demo: [{ kind: "fault", subject: "first", fault: "slow" }],
        },
        {
          ...metricsFixture.steps[3],
          id: "restored",
          check: { kind: "fault", subject: "first", absent: true },
          sticky: undefined,
          demo: [{ kind: "fault", subject: "first", fault: "slow", restore: true }],
        },
      ],
    };
    saveProgress(tutorial, 2, false);
    const s = sandbox(tutorial);
    s.runner.send({ type: "resume" });
    await vi.waitFor(() => expect(state(s)).toMatchObject({ index: 2, value: "active" }), { interval: 1 });
    // Replayed: the Fault is on again, and nothing waited for ten more messages.
    expect(s.live!.getState().snapshot.faults).toContainEqual(expect.objectContaining({ kind: "slow" }));
  });

  it("a sinceStep step counts a remounted Live session from zero, though its runs number from 1 again", async () => {
    const tutorial: Tutorial = {
      ...metricsFixture,
      steps: [
        {
          ...metricsFixture.steps[0],
          id: "warm",
          check: { kind: "compare", left: { node: "first", metric: "processed" }, op: ">=", right: 20 },
          sticky: true,
          demo: [{ kind: "live" }],
        },
        {
          ...metricsFixture.steps[3],
          check: { kind: "compare", left: { sinceStep: { node: "first", metric: "processed" } }, op: ">=", right: 40 },
        },
      ],
    };
    const s = sandbox(tutorial);
    s.runner.send({ type: "start" });
    s.hostState.live.goLive();
    for (let frame = 0; frame < 200 && state(s).index === 0; frame++) play(s, 250);
    expect(state(s)).toMatchObject({ index: 1, value: "active" });
    const [base, generation, session] = state(s).baseline[sinceKey];
    expect(base).toBeGreaterThanOrEqual(20);
    // Leave Live and come back: another session, whose first run is generation `generation` again.
    s.hostState.live.toggle();
    s.hostState.live.toggle();
    expect(s.live!.getState().generation).toBe(generation);
    expect(state(s).baseline[sinceKey]).toEqual([base, generation, session]);
    const first = () => s.live!.getState().snapshot.nodes[s.subject("first")].processed;
    for (let frame = 0; frame < 400 && state(s).value !== "finished"; frame++) play(s, 250);
    expect(state(s).value, "the new session's own traffic completes it").toBe("finished");
    expect(first(), "counted from zero, not from the old session's baseline").toBeLessThan(base + 40);
  });

  it("Skip continues each note on the way to the one its step is about", async () => {
    const s = sandbox(savedSimulationsFixture);
    await reach(s, savedSimulationsFixture, 1);
    expect(s.live!.getState().run).toMatchObject({ waiting: true });
    await skip(s, savedSimulationsFixture);
    expect(state(s).index).toBeGreaterThan(1);
    expect(s.live!.getState().run!.time).toBeGreaterThanOrEqual(1500);
    expect(s.live!.getState().run!.waiting).toBe(false);
  });

  it("Continue replays a continued note: the run is past it when the learner lands", async () => {
    saveProgress(savedSimulationsFixture, 2, false);
    const s = sandbox(savedSimulationsFixture);
    s.runner.send({ type: "resume" });
    for (let frame = 0; frame < 400 && state(s).value === "reconstructing"; frame++) {
      if (s.live?.getState().playing) play(s, 250);
      await Promise.resolve();
    }
    expect(state(s)).toMatchObject({ index: 2, value: "active" });
    expect(s.live!.getState().run).toMatchObject({ waiting: false });
    expect(s.live!.getState().run!.time).toBeGreaterThanOrEqual(1500);
  });

  it("an expectation either way completes its step once Live decides it, here failed", async () => {
    const s = sandbox(savedSimulationsFixture);
    await reach(s, savedSimulationsFixture, 2);
    for (let frame = 0; frame < 100 && state(s).index === 2; frame++) play(s, 250);
    expect(s.live!.getState().run!.expectations[0].status).toBe("fail");
    expect(state(s).index).toBe(3);
  });

  it("saveSimulation keeps the learner's own simulation and adds only the Drill step it lacks", async () => {
    const expectation: Expectation = {
      id: "served",
      label: "Served",
      metric: { node: "api", field: "processed" },
      op: ">=",
      value: 5,
      when: "end",
    };
    const missing: Expectation = { ...expectation, id: "more", value: 10 };
    const tutorial: Tutorial = {
      ...savedSimulationsFixture,
      steps: savedSimulationsFixture.steps.map((step) => ({
        ...step,
        demo: step.demo.map((demo) =>
          demo.kind === "saveSimulation" ? { ...demo, expectations: [expectation, missing] } : demo,
        ),
      })),
    };
    const s = sandbox(tutorial);
    await reach(s, tutorial, 4);
    const own = {
      id: "simulation",
      title: "Mine",
      seed: 9,
      traffic: [],
      timeline: [{ atMs: 0, action: { do: "note" as const, text: "Mine" } }],
      expectations: [{ ...expectation, label: "My threshold", value: 99 }],
    };
    s.editor.updateMeta({ simulations: [...(s.diagram.simulations ?? []), own] });
    const version = s.version;
    await skip(s, tutorial);
    expect(s.version, "one edit").toBe(version + 1);
    const saved = s.diagram.simulations!.filter((sim) => sim.id === "simulation");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: "Mine", seed: 9 });
    expect(saved[0].timeline).toEqual([
      own.timeline[0],
      expect.objectContaining({
        atMs: 1000,
        action: expect.objectContaining({ do: "fault", drill: "slow-dependency" }),
      }),
    ]);
    expect(saved[0].expectations).toEqual([own.expectations[0], missing]);
    const demo = tutorial.steps[4].demo[0];
    if (demo.kind !== "saveSimulation") throw new Error("Expected a save demo");
    expect(withSavedSimulation(s.diagram, demo), "repeating the save is a no-op").toBeNull();
  });

  it("slow motion's journey played to the end completes its step by itself", async () => {
    const s = sandbox(slowMotionFixture);
    expect(await reach(s, slowMotionFixture, 2)).toBe(true);
    s.slow.play(600);
    expect(state(s).index).toBe(2);
    s.slow.play(600);
    expect(state(s).value).toBe("finished");
  });

  it("a hover card on the subject completes its step, and on another item it doesn't", async () => {
    const s = sandbox(livePanelsFixture);
    const hover = livePanelsFixture.steps.findIndex((st) => st.id === "hover");
    expect(await reach(s, livePanelsFixture, hover)).toBe(true);
    s.hover({ kind: "node", id: s.subject("db") });
    expect(state(s).index).toBe(hover);
    s.hover({ kind: "node", id: s.subject("api") });
    expect(state(s).index).toBe(hover + 1);
  });
});
