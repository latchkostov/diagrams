/* eslint-disable local/no-literal-ui-text -- Diagram labels in these fixtures are test input, not UI copy. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorApi } from "../editor/types";
import type { DiagramFile, DiagramNode } from "../model/types";
import { canvasInteraction } from "../canvas/interaction/canvasInteraction";
import { editorModeStep, initialEditorMode, type EditorModeState } from "../canvas/interaction/mode";
import type { paletteHost, SessionHost } from "../palette/host";
import { mobileApi } from "./catalog/mobileApi";
import { createTutorialRunner } from "./runner";
import { savedProgress, saveProgress } from "./progress";
import type { Tutorial } from "./types";
import type { Demo } from "./types";
import { actionRegistry } from "../editor/actions";
import { dependencyVisibility } from "../canvas/dependencyVisibility";
import { commandPalette } from "./catalog/commandPalette";
import { LiveController, structuralKey } from "../live/controller";
import { requestVsMessage } from "./catalog/requestVsMessage";
import { propertySheet } from "./catalog/propertySheet";
import { planningHost } from "../live/planningHost";
import type { LiveUi } from "../live/context";
import { editorHarness } from "../test/editorHarness";
import { insertOnEdge } from "./catalog/insertOnEdge";
import { beginObservedWork, observationPorts } from "../lib/observations";
import { checksAndFixes } from "./catalog/checksAndFixes";
import { runChecks } from "../checks/run";
import { HistoryController } from "../editor/historyController";
import { toFlow, fromFlow } from "../canvas/convert";
import { importAndReview } from "./catalog/importAndReview";

const cleanup: (() => void)[] = [];
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
});
afterEach(() => {
  cleanup.reverse().forEach((f) => f());
  cleanup.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sandbox(
  tutorial: Tutorial = mobileApi,
  initial: DiagramFile = typeof tutorial.start === "function" ? tutorial.start() : mobileApi.start(),
  deferAdds = false,
  importPractice?: (signal: AbortSignal) => Promise<void>,
) {
  let diagram = initial;
  let version = { identity: {}, revision: 0 };
  let mode = initialEditorMode;
  const changes = new Set<() => void>();
  const modes = new Set<() => void>();
  const sessions = new Set<() => void>();
  const notify = () => changes.forEach((f) => f());
  const setMode = (next: EditorModeState) => {
    mode = next;
    modes.forEach((f) => f());
  };
  const edit = (next: DiagramFile) => {
    diagram = next;
    version = { ...version, revision: version.revision + 1 };
    notify();
  };
  const add = (stencil: string) => {
    const id = `node-${diagram.nodes.length + 1}`;
    const commit = () => edit({ ...diagram, nodes: [...diagram.nodes, { id, stencil, label: "Service", x: 0, y: 0 }] });
    if (deferAdds) queueMicrotask(commit);
    else commit();
    return id;
  };
  const getDiagram = vi.fn(() => diagram);
  const editor = {
    addNode: add,
    getDiagram,
    getDocumentVersion: () => version,
    clearSelection: () => {},
    startEditing: ({ id }: { id: string }) =>
      setMode(editorModeStep(mode, { type: "field.focused", target: id, field: "label" })),
    applyDiagram: edit,
    deleteElements: ({ nodeIds = [] }: { nodeIds?: string[] }) =>
      edit({
        ...diagram,
        nodes: diagram.nodes.filter((n) => !nodeIds.includes(n.id)),
        edges: diagram.edges.filter((e) => !nodeIds.includes(e.from) && !nodeIds.includes(e.to)),
      }),
    updateNode: (id: string, patch: Partial<DiagramNode>) =>
      edit({ ...diagram, nodes: diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
    createConnected: ({ from, stencil }: { from: string; stencil: string }) => {
      const id = add(stencil);
      editor.connect(from, id);
      return { id, edge: "edge", merge: "add" };
    },
    connect: (from: string, to: string) => {
      if (!diagram.edges.some((e) => e.from === from && e.to === to))
        edit({ ...diagram, edges: [...diagram.edges, { id: "edge", from, to, kind: "sync" }] });
    },
  };
  const hostState = {
    canvas: {
      editor: editor as unknown as EditorApi,
      live: false,
      documentId: "sandbox",
      addStencil: add,
      focusNode: vi.fn(),
    },
    live: {
      goLive: vi.fn(() => {
        hostState.canvas.live = true;
        notify();
      }),
      toggle: vi.fn(),
    },
    session: {
      run: () => {},
      subscribe: (f: () => void) => {
        sessions.add(f);
        return () => sessions.delete(f);
      },
    } as SessionHost,
    pendingRun: null,
  };
  cleanup.push(
    canvasInteraction.publish({
      get mode() {
        return mode;
      },
      setGuide: () => {},
      dispatch: (event: { type: "naming.done"; flowId: string }) => setMode(editorModeStep(mode, event)),
      subscribeMode: (f) => {
        const listener = () => f(mode, mode);
        modes.add(listener);
        return () => modes.delete(listener);
      },
    }),
  );
  const host: Pick<typeof paletteHost, "get" | "subscribe"> &
    Partial<Pick<typeof paletteHost, "runSimulation" | "cancelRun">> = {
    get: () => hostState,
    subscribe: (f) => {
      changes.add(f);
      return () => changes.delete(f);
    },
  };
  const close = vi.fn();
  const runner = createTutorialRunner(tutorial, { close, host, initial, importPractice });
  const disconnect = runner.connect();
  cleanup.push(disconnect);
  return {
    disconnect,
    runner,
    close,
    editor,
    getDiagram,
    hostState,
    host,
    publish: notify,
    edit,
    mode: (patch: Partial<EditorModeState>) => {
      mode = { ...mode, ...patch };
      modes.forEach((f) => f());
    },
    tick: () => sessions.forEach((f) => f()),
  };
}

it("independent add demos do not reuse a rail action's stale selected anchor", async () => {
  const s = sandbox();
  const rail = vi.spyOn(s.hostState.canvas, "addStencil").mockImplementation((stencil) => {
    const from = s.getDiagram().nodes[0]?.id;
    const id = s.editor.addNode(stencil);
    if (from) s.editor.connect(from, id);
    return id;
  });
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: "add-app" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.index).toBe(1));
  s.runner.send({ type: "skip", stepId: "add-api" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.index).toBe(2));
  expect(s.getDiagram().nodes).toHaveLength(2);
  expect(s.getDiagram().edges).toEqual([]);
  expect(rail).not.toHaveBeenCalled();
});

it("a successful export belongs to one active step and never advances a later identical step", () => {
  const template = mobileApi.steps[0];
  const tutorial: Tutorial = {
    ...mobileApi,
    id: "port-moments",
    subjects: {},
    steps: ["first", "second"].map((id) => ({
      ...template,
      id,
      check: { kind: "export", format: "svg" },
      demo: [],
      solution: [],
    })),
  };
  const s = sandbox(tutorial);
  const source = { documentId: "sandbox", identity: s.editor.getDocumentVersion().identity };
  observationPorts.exports.publish({ ...source, format: "svg", bytes: 10 });
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state.index).toBe(0);
  observationPorts.exports.publish({ ...source, format: "svg", bytes: 10 });
  expect(s.runner.getSnapshot().state.index).toBe(1);
  s.publish();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  observationPorts.exports.publish({ ...source, identity: {}, format: "svg", bytes: 10 });
  expect(s.runner.getSnapshot().state.value).toBe("active");
  observationPorts.exports.publish({ ...source, format: "svg", bytes: 10 });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

for (const event of ["restart", "exit", "replacement"] as const)
  it(`${event} cancels delayed product work without a demo job`, () => {
    const s = sandbox();
    s.runner.send({ type: "start" });
    const source = { documentId: "sandbox", identity: s.editor.getDocumentVersion().identity };
    const work = beginObservedWork(source);
    if (event === "replacement") {
      s.hostState.canvas.documentId = "replacement";
      s.publish();
    } else s.runner.send({ type: event });
    expect(work.signal.aborted).toBe(true);
  });

for (const event of ["restart", "exit", "replacement"] as const)
  it(`${event} cancels a delayed practice import without writing or advancing`, async () => {
    const tutorial = { ...importAndReview, steps: [importAndReview.steps[0]] };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const apply = vi.fn();
    const s = sandbox(tutorial, undefined, false, async (next) => {
      signal = next;
      await held;
      next.throwIfAborted();
      apply();
    });
    s.runner.send({ type: "start" });
    s.runner.send({ type: "skip", stepId: "import" });
    await vi.waitFor(() => expect(signal).toBeDefined());
    if (event === "replacement") {
      s.hostState.canvas.documentId = "replacement";
      s.publish();
    } else s.runner.send({ type: event });
    expect(signal!.aborted).toBe(true);
    release();
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    expect(s.runner.getSnapshot().state.value).not.toBe("finished");
    expect(s.getDiagram().nodes).toEqual([]);
  });

const named = (): DiagramFile => ({
  ...mobileApi.start(),
  nodes: [
    { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0 },
    { id: "api", stencil: "generic.service", label: "Orders API", x: 200, y: 0 },
  ],
  edges: [{ id: "edge", from: "app", to: "api", kind: "sync" }],
});

it("presents a patch target once while waiting for Live to apply its props", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "metric", subject: "api", field: "processed", op: ">=", value: 1 },
        demo: [{ kind: "patch", subject: "api", patches: [{ op: "set", path: ["replicas"], value: 4 }] }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  const controller = new LiveController(named());
  cleanup.push(() => controller.dispose());
  const select = vi.fn();
  const openInspector = vi.fn();
  const setNodeProps = vi.fn((id: string, props: DiagramNode["props"]) => s.editor.updateNode(id, { props }));
  s.hostState.canvas.editor = { ...s.hostState.canvas.editor, select, openInspector, setNodeProps };
  s.hostState.canvas.live = true;
  s.hostState.session.state = controller.getState;
  cleanup.push(
    planningHost.publish({ controller, simulations: [], events: { open: false, nodeId: null } } as unknown as LiveUi),
  );
  s.publish();
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  s.tick();
  s.tick();
  expect(select).toHaveBeenCalledExactlyOnceWith({ nodeIds: ["api"], edgeIds: [], groupIds: [] });
  expect(openInspector).toHaveBeenCalledExactlyOnceWith("label");
  expect(setNodeProps).toHaveBeenCalledOnce();
  controller.updateDiagram(s.editor.getDiagram());
  s.tick();
  await Promise.resolve();
  expect(select).toHaveBeenCalledOnce();
});

it.each([0, 1500])("Continue waits for external state after a refused note at %s", async (time) => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "field", subject: "api", field: "sublabel", is: () => "Continued" },
        demo: [
          { kind: "continueNote", simulation: "story", atLeastMs: 1500 },
          { kind: "field", subject: "api", field: "sublabel", value: () => "Continued" },
        ],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.hostState.canvas.live = true;
  let waiting = true,
    allowed = false,
    calls = 0,
    now = time;
  s.hostState.session.state = () =>
    ({ running: { id: "story" }, run: { time: now, waiting }, snapshot: { nodes: {} } }) as ReturnType<
      NonNullable<SessionHost["state"]>
    >;
  const resume = vi.fn(() => {
    calls++;
    // Bounded even against the broken synchronous retry loop, so the regression fails without hanging Vitest.
    if (allowed || calls === 3) waiting = false;
    s.tick();
  });
  cleanup.push(
    planningHost.publish({ controller: { resume }, events: { open: false, nodeId: null } } as unknown as LiveUi),
  );
  const update = vi.spyOn(s.editor, "updateNode");
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(resume).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  allowed = true;
  now = 1500;
  s.tick();
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(resume).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenCalledExactlyOnceWith("api", { sublabel: "Continued" });
});

it.each(["inputs", "simulations"] as const)("opens %s independently of the other panel", async (view) => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      { ...mobileApi.steps[0], check: { kind: "liveView", view, open: true }, demo: [{ kind: "openView", view }] },
    ],
  };
  const s = sandbox(tutorial, named());
  s.hostState.canvas.live = true;
  const openCapacity = vi.fn(),
    openPanel = vi.fn();
  const publish = (open: boolean) =>
    cleanup.push(
      planningHost.publish({
        capacityOpen: view === "inputs" ? open : !open,
        panelOpen: view === "simulations" ? open : !open,
        events: { open: false, nodeId: null },
        openCapacity,
        openPanel,
      } as unknown as LiveUi),
    );
  publish(false);
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state.value).toBe("active");
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(view === "inputs" ? openCapacity : openPanel).toHaveBeenCalledOnce();
  expect(view === "inputs" ? openPanel : openCapacity).not.toHaveBeenCalled();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  publish(true);
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("opens Events while slow motion disables engine mutations", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "liveView", view: "events", open: true },
        demo: [{ kind: "openView", view: "events" }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.hostState.canvas.live = true;
  s.hostState.session.disabledHint = "Slow motion";
  const showEvents = vi.fn((nodeId: string | null, open: boolean) => {
    cleanup.push(planningHost.publish({ events: { nodeId, open }, showEvents } as unknown as LiveUi));
  });
  cleanup.push(planningHost.publish({ events: { nodeId: "api", open: false }, showEvents } as unknown as LiveUi));
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(showEvents).toHaveBeenCalledExactlyOnceWith("api", true);
  expect(s.hostState.session.disabledHint).toBe("Slow motion");
});

it("fails an engine-mutating demo while slow motion disables mutations", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "simulation", id: "demo" },
        demo: [{ kind: "runSimulation", id: "demo" }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.hostState.session.disabledHint = "Slow motion";
  s.host.runSimulation = vi.fn(() => true);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("failed"));
  expect(s.host.runSimulation).not.toHaveBeenCalled();
});

it("replaying an add-and-name demo fixes a near miss on the same connected node", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[3],
        demo: [
          { kind: "add", subject: "api", stencil: "generic.service", after: "app" },
          { kind: "rename", subject: "api", label: () => "Orders API" },
        ],
      },
    ],
  };
  const initial = named();
  initial.nodes[1].label = "Order API";
  const s = sandbox(tutorial, initial);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "fix" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(s.getDiagram().nodes).toHaveLength(2);
  expect(s.getDiagram().edges).toHaveLength(1);
  expect(s.getDiagram().nodes[1].label).toBe("Orders API");
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("captures processed counts when the watch step opens, and recaptures after Restart", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      { ...mobileApi.steps[4], id: "live" },
      {
        ...mobileApi.steps[5],
        check: { kind: "compare", left: { sinceStep: { node: "api", metric: "processed" } }, op: ">=", right: 10 },
      },
    ],
  };
  const s = sandbox(tutorial, named());
  let processed = 100;
  s.hostState.session.state = () =>
    ({
      generation: 0,
      diagramBasis: structuralKey(s.getDiagram()),
      snapshot: { nodes: { api: { processed } } },
    }) as unknown as ReturnType<NonNullable<SessionHost["state"]>>;
  s.publish();
  s.runner.send({ type: "start" });
  s.hostState.live.goLive();
  s.tick();
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 1, value: "active" });
  processed = 109;
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  processed = 110;
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("finished");
  s.runner.send({ type: "restart" });
  s.publish();
  s.tick();
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 1, value: "active" });
  processed = 119;
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  processed = 120;
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("waits for an added node to commit before naming it in the same demo", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[3],
        demo: [
          { kind: "add", subject: "api", stencil: "generic.service", after: "app" },
          { kind: "rename", subject: "api", label: () => "Orders API" },
        ],
      },
    ],
  };
  const initial = named();
  initial.nodes.pop();
  initial.edges = [];
  const s = sandbox(tutorial, initial, true);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(s.getDiagram().nodes[1].label).toBe("Orders API");
});

it("waits for a queued saved launch before enabling its source traffic", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[4],
        check: { kind: "simulation", id: "demo", traffic: true },
        demo: [
          { kind: "runSimulation", id: "demo" },
          { kind: "traffic", on: true },
        ],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.hostState.canvas.live = true;
  s.hostState.canvas.editor.getSelection = () => ({ nodeIds: [], edgeIds: [], groupIds: [] });
  let traffic = true,
    id = "free-play";
  s.hostState.session.state = () =>
    ({ traffic, running: { id }, run: { time: 0 }, snapshot: { nodes: {} } }) as unknown as ReturnType<
      NonNullable<SessionHost["state"]>
    >;
  s.host.runSimulation = () => {
    queueMicrotask(() => {
      const canvas = s.hostState.canvas;
      s.hostState.canvas = null as unknown as typeof canvas;
      s.publish();
      s.hostState.canvas = canvas;
      id = "demo";
      s.publish();
      traffic = false;
      s.tick();
    });
    return true;
  };
  const run = vi.fn(() => {
    traffic = true;
    s.tick();
  });
  vi.spyOn(actionRegistry, "build").mockReturnValue([{ type: "item", id: "sim.traffic", label: "Traffic", run }]);
  s.publish();
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(run).toHaveBeenCalledOnce();
});

it("keeps completed naming settled through unrelated edits and matching renames, but reopens for a changed name", () => {
  const s = sandbox(mobileApi, named());
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state.index).toBe(4);
  s.mode({ value: "naming", target: "app" });
  s.editor.updateNode("app", { label: "Another app" });
  expect(s.runner.getSnapshot().state.index).toBe(4);
  s.mode({ value: "field", target: null, field: "sublabel" });
  s.editor.updateNode("api", { sublabel: "HTTP", x: 300 });
  s.mode({ value: "naming", target: "api" });
  expect(s.runner.getSnapshot().state.index).toBe(4);
  s.editor.updateNode("api", { label: "Order API" });
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 3, value: "active" });
  s.editor.updateNode("api", { label: "Orders API" });
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 3, value: "completing" });
  s.mode({ value: "editing", target: null });
  expect(s.runner.getSnapshot().state.index).toBe(4);
});

it("waits for the checked node's initial naming, while another node's name never unsettles it", () => {
  const initial = named();
  initial.nodes[1].label = "Service";
  const s = sandbox(mobileApi, initial);
  s.mode({ value: "naming", target: "api" });
  s.editor.updateNode("api", { label: "Orders API" });
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 3, value: "completing" });
  s.mode({ value: "naming", target: "app" });
  expect(s.runner.getSnapshot().state.index).toBe(4);
});

it("reuses the sandbox document and document checks for live, focus and selection publications", () => {
  const is = vi.fn(() => "Orders API");
  const tutorial = {
    ...mobileApi,
    steps: mobileApi.steps.map((step) =>
      step.id === "name-api" ? { ...step, check: { kind: "label" as const, subject: "api", is } } : step,
    ),
  };
  const s = sandbox(tutorial, named());
  s.runner.send({ type: "start" });
  s.hostState.live.goLive();
  s.getDiagram.mockClear();
  is.mockClear();
  for (let i = 0; i < 24; i++) {
    s.tick();
    s.mode({ selection: ["api"] });
  }
  expect(s.getDiagram).not.toHaveBeenCalled();
  expect(is).not.toHaveBeenCalled();
  s.editor.updateNode("api", { x: 400 });
  expect(s.getDiagram).toHaveBeenCalledTimes(1);
  expect(is).toHaveBeenCalledTimes(1);
  s.runner.send({ type: "skip", stepId: "watch" });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
  s.getDiagram.mockClear();
  for (let i = 0; i < 24; i++) s.tick();
  expect(s.getDiagram).not.toHaveBeenCalled();
  const replacement = vi.fn(s.editor.getDiagram);
  s.hostState.canvas.editor = { ...s.hostState.canvas.editor, getDiagram: replacement };
  s.tick();
  expect(replacement).toHaveBeenCalledTimes(1);
});

it("Continue replays persisted progress through the real runner and Start over resets it", async () => {
  saveProgress(mobileApi, 3, false);
  const s = sandbox();
  expect(s.runner.getSnapshot().state.resumeAt).toBe(3);
  s.runner.send({ type: "resume" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.index).toBe(3));
  await vi.waitFor(() => expect(s.runner.getSnapshot().subjects).toEqual({ app: "node-1", api: "node-2" }));
  expect(s.editor.getDiagram().edges).toMatchObject([{ from: "node-1", to: "node-2" }]);
  expect(s.runner.getSnapshot().state.observed.slice(0, 3)).toEqual([true, true, true]);
  s.runner.send({ type: "restart" });
  expect(s.runner.getSnapshot().state.index).toBe(0);
  expect(s.editor.getDiagram().nodes).toEqual([]);
});

it("Continue after a real Undo reconstructs the absent consumer and waits for refreshed Checks", async () => {
  const s = sandbox(checksAndFixes);
  const checks = (current: ReturnType<typeof sandbox>) =>
    observationPorts.checks.publish({
      documentId: "sandbox",
      identity: current.editor.getDocumentVersion().identity,
      status: "done",
      result: runChecks(current.editor.getDiagram()),
    });
  s.runner.send({ type: "start" });
  checks(s);
  s.runner.send({ type: "skip", stepId: "open" });
  s.runner.send({ type: "skip", stepId: "read" });
  expect(s.runner.getSnapshot().state.index).toBe(2);
  const history = new HistoryController(toFlow(s.editor.getDiagram()), 0);
  s.runner.send({ type: "skip", stepId: "fix" });
  await vi.waitFor(() => expect(s.editor.getDiagram().nodes).toHaveLength(4));
  checks(s);
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.index).toBe(3));
  history.commit(toFlow(s.editor.getDiagram()), "repair", 1);
  const undone = history.step("undo", { nodes: [], edges: [] })!;
  s.edit(fromFlow(undone.meta, undone.nodes, undone.edges));
  checks(s);
  expect(s.runner.getSnapshot().state.index).toBe(4);
  s.runner.send({ type: "exit" });
  s.disconnect();

  const resumed = sandbox(checksAndFixes, undefined, true);
  resumed.runner.send({ type: "resume" });
  await vi.waitFor(() => expect(resumed.editor.getDiagram().nodes).toHaveLength(4));
  checks(resumed);
  await vi.waitFor(() => expect(resumed.editor.getDiagram().nodes).toHaveLength(3));
  // The topology is restored before the async Checks result arrives: control must still be withheld.
  expect(resumed.runner.getSnapshot().state.value).toBe("reconstructing");
  checks(resumed);
  await vi.waitFor(() => expect(resumed.runner.getSnapshot().state).toMatchObject({ value: "active", index: 4 }));
  expect(resumed.runner.getSnapshot().subjects.worker).toBeUndefined();
  expect(runChecks(resumed.editor.getDiagram()).findings).toContainEqual(
    expect.objectContaining({ rule: "no-reader", target: "topic" }),
  );
  resumed.runner.send({ type: "skip", stepId: "reapply" });
  await vi.waitFor(() =>
    expect(resumed.editor.getDiagram().nodes).toContainEqual(
      expect.objectContaining({ id: "node-4", label: "Event worker" }),
    ),
  );
  checks(resumed);
  await vi.waitFor(() => expect(resumed.runner.getSnapshot().state.index).toBe(5));
});

it.each([2, 3])(
  "property-sheet Continue restores Subtitle and Description without repeating Name (step %s)",
  async (step) => {
    saveProgress(propertySheet, step, false);
    const s = sandbox(propertySheet);
    const writes = vi.spyOn(localStorage, "setItem");
    s.runner.send({ type: "resume" });
    await vi.waitFor(() => {
      expect(s.runner.getSnapshot().state).toMatchObject({ index: step, value: "active" });
      expect(s.runner.getSnapshot().state.latched[0]).toBe(true);
      expect(s.runner.getSnapshot().state.observed.slice(1, step)).toEqual(Array(step - 1).fill(true));
      expect(s.runner.getSnapshot().state.settled[1]).toBe(true);
    });
    expect(savedProgress(propertySheet)).toMatchObject({ step, completed: false });
    for (const [, value] of writes.mock.calls) {
      expect(JSON.parse(value).progress[propertySheet.id].step).toBeGreaterThanOrEqual(step);
    }
  },
);

it("demo additions bind their declared subjects even when selectors overlap", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    subjects: { first: { role: "processor" }, second: { role: "processor" } },
    steps: [
      {
        ...mobileApi.steps[0],
        id: "second",
        check: { kind: "node", subject: "second" },
        demo: [{ kind: "add", subject: "second", stencil: "generic.service" }],
      },
      {
        ...mobileApi.steps[0],
        id: "first",
        check: { kind: "node", subject: "first" },
        demo: [{ kind: "add", subject: "first", stencil: "generic.service" }],
      },
      {
        ...mobileApi.steps[2],
        check: { kind: "edge", from: "first", to: "second" },
        demo: [{ kind: "connect", from: "first", to: "second" }],
      },
    ],
  };
  const s = sandbox(tutorial, mobileApi.start(), true);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: "second" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().subjects.second).toBe("node-1"));
  expect(s.runner.getSnapshot().subjects.first).toBeUndefined();
  s.runner.send({ type: "skip", stepId: "first" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.index).toBe(2));
  expect(s.runner.getSnapshot().subjects).toEqual({ first: "node-2", second: "node-1" });
  s.runner.send({ type: "skip", stepId: "connect" });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(s.editor.getDiagram().edges).toMatchObject([{ from: "node-2", to: "node-1" }]);
});

it("preserves completion only within the current tutorial version", () => {
  saveProgress(mobileApi, 0, true);
  saveProgress(mobileApi, 2, false);
  expect(savedProgress(mobileApi)?.completed).toBe(true);
  const newer = { ...mobileApi, version: mobileApi.version + 1 };
  const s = sandbox(newer);
  expect(s.runner.getSnapshot().state.resumeAt).toBe(0);
  s.runner.send({ type: "start" });
  expect(savedProgress(newer)).toEqual({
    version: newer.version,
    step: 0,
    completed: false,
    completedAt: expect.any(Number),
  });
});

it("announces Show me's hint through the runner's status and leaves focus to the controller", () => {
  const s = sandbox();
  s.runner.send({ type: "start" });
  s.runner.send({ type: "showMe" });
  expect(s.runner.getSnapshot().announcement).toBe(mobileApi.steps[0].hint?.());
  expect(s.hostState.canvas.focusNode).not.toHaveBeenCalled();
});

it.each<{ demo: Demo; method: keyof EditorApi; args: unknown[] }>([
  { demo: { kind: "name", subject: "api" }, method: "startEditing", args: [{ kind: "node", id: "api" }] },
  {
    demo: { kind: "field", subject: "api", field: "sublabel", value: () => "Node.js" },
    method: "updateNode",
    args: ["api", { sublabel: "Node.js" }],
  },
  {
    demo: { kind: "insert", edge: ["app", "api"], subject: "gw", stencil: "aws.api-gateway" },
    method: "insertNode",
    args: ["edge", "aws.api-gateway"],
  },
  {
    demo: { kind: "reconnect", edge: ["app", "api"], to: "api" },
    method: "reconnectEdge",
    args: ["edge", "target", "api"],
  },
  {
    demo: { kind: "connect", from: "app", to: "api", targetSide: "top", sourceSide: "right" },
    method: "connect",
    args: ["app", "api", { targetSide: "top", sourceSide: "right" }],
  },
  {
    demo: { kind: "align", subjects: ["app", "api"], mode: "middle" },
    method: "align",
    args: [["app", "api"], "middle"],
  },
  {
    demo: { kind: "prop", subject: "api", props: { concurrency: 12 } },
    method: "setNodeProps",
    args: ["api", { concurrency: 12 }],
  },
  {
    demo: { kind: "prop", edge: ["app", "api"], props: { timeoutMs: 50 } },
    method: "setEdgeProps",
    args: ["edge", { timeoutMs: 50 }],
  },
  {
    demo: { kind: "relation", from: "app", to: "api", relation: "flow", edgeKind: "async" },
    method: "updateEdge",
    args: ["edge", { relation: "flow", kind: "async" }],
  },
  { demo: { kind: "group", subjects: ["app", "api"], boundary: "box" }, method: "groupNodes", args: [["app", "api"]] },
  { demo: { kind: "annotate", annotation: "note" }, method: "addAnnotation", args: ["note"] },
  {
    demo: { kind: "select", subjects: ["api"] },
    method: "select",
    args: [{ nodeIds: ["api"], groupIds: [], edgeIds: [] }],
  },
])("performs $demo.kind through one editor operation", async ({ demo, method, args }) => {
  const tutorial: Tutorial = {
    ...mobileApi,
    subjects: { ...mobileApi.subjects, box: { boundary: true } },
    steps: [{ ...mobileApi.steps[0], check: { kind: "mode", value: "quickAdd" }, demo: [demo] }],
  };
  const s = sandbox(tutorial, named());
  const edit = vi.fn();
  s.hostState.canvas.editor = { ...s.hostState.canvas.editor, [method]: edit };
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(edit).toHaveBeenCalledExactlyOnceWith(...args);
});

it("runs a simulation through the palette queue and cancels pending work on exit", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "simulation", id: "demo" },
        demo: [{ kind: "runSimulation", id: "demo" }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  const runSimulation = vi.fn(() => true),
    cancelRun = vi.fn();
  const runner = createTutorialRunner(tutorial, {
    close: vi.fn(),
    host: { get: () => s.hostState, subscribe: () => () => {}, runSimulation, cancelRun },
  });
  cleanup.push(runner.connect());
  runner.send({ type: "start" });
  runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(runSimulation).toHaveBeenCalledExactlyOnceWith("demo");
  runner.send({ type: "exit" });
  expect(cancelRun).toHaveBeenCalledOnce();
});

it.each([
  [{ kind: "fault", subject: "api", fault: "down" }, "sim.kill", "node"],
  [{ kind: "fault", subject: "api", fault: "slow" }, "sim.slow:5", "node"],
  [{ kind: "fault", subject: "api", fault: "fail" }, "sim.failure:0.5", "node"],
  [{ kind: "fault", edge: ["app", "api"], fault: "cut" }, "sim.cut-link", "edge"],
] as const)("uses the same registry fault action as the palette: %s", async (demo, id, target) => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [{ ...mobileApi.steps[0], check: { kind: "fault", subject: "api" }, demo: [demo] }],
  };
  const s = sandbox(tutorial, named());
  s.hostState.canvas.live = true;
  s.hostState.canvas.editor.getSelection = () => ({ nodeIds: [], edgeIds: [], groupIds: [] });
  const run = vi.fn();
  const build = vi
    .spyOn(actionRegistry, "build")
    .mockReturnValue([
      { type: "item", id: "sim.fault", label: "Fault", children: [{ type: "item", id, label: "Apply", run }] },
    ]);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(run).toHaveBeenCalledOnce();
  expect(build).toHaveBeenCalledWith(expect.objectContaining({ target, mode: "live", surface: "palette" }));
});

it("replays Continuous traffic through the registry once its lazy session and action are ready", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "simulation", id: "demo", traffic: true },
        demo: [{ kind: "traffic", on: true }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.hostState.canvas.live = true;
  s.hostState.canvas.editor.getSelection = () => ({ nodeIds: [], edgeIds: [], groupIds: [] });
  const build = vi.spyOn(actionRegistry, "build").mockReturnValue([]);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  const canvas = s.hostState.canvas;
  s.hostState.canvas = null as unknown as typeof canvas;
  await Promise.resolve();
  expect(build).not.toHaveBeenCalled();
  s.hostState.canvas = canvas;
  let traffic = false;
  s.hostState.session.state = () =>
    ({ traffic, running: { id: "demo" }, run: { time: 0 }, snapshot: { nodes: {} } }) as unknown as ReturnType<
      NonNullable<SessionHost["state"]>
    >;
  s.publish();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  const run = vi.fn(() => {
    traffic = true;
    s.tick();
  });
  build.mockReturnValue([{ type: "item", id: "sim.traffic", label: "Traffic", disabled: true, run }]);
  s.publish();
  expect(run).not.toHaveBeenCalled();
  build.mockReturnValue([{ type: "item", id: "sim.traffic", label: "Traffic", run }]);
  s.publish();
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(run).toHaveBeenCalledOnce();
  expect(build).toHaveBeenCalledWith(expect.objectContaining({ target: "canvas", mode: "live" }));
});

it("rechecks mode checks when the editor mode changes, without a diagram edit", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [{ ...mobileApi.steps[0], check: { kind: "mode", value: "menu" }, sticky: true, demo: [] }],
  };
  const s = sandbox(tutorial);
  s.runner.send({ type: "start" });
  s.mode({ value: "menu" });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("rechecks selection and alignment when only the selection changes", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: {
          kind: "all",
          checks: [
            { kind: "selection", subjects: ["app", "api"] },
            { kind: "aligned", axis: "y" },
          ],
        },
        demo: [],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.runner.send({ type: "start" });
  s.mode({ selection: ["app", "api"] });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("observes remembered dependency visibility and disconnects its subscription", () => {
  const original = dependencyVisibility.get();
  dependencyVisibility.set(true);
  const unsubscribe = vi.fn();
  const subscribe = vi.spyOn(dependencyVisibility, "subscribe");
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [{ ...mobileApi.steps[0], check: { kind: "dependencies", visible: false }, sticky: true, demo: [] }],
  };
  const s = sandbox(tutorial);
  s.runner.send({ type: "start" });
  dependencyVisibility.set(false);
  expect(s.runner.getSnapshot().state.value).toBe("finished");
  expect(subscribe).toHaveBeenCalledOnce();
  // A disconnected runner must not react to later preference changes.
  cleanup.reverse().forEach((fn) => fn());
  cleanup.length = 0;
  s.runner.subscribe(unsubscribe);
  dependencyVisibility.set(true);
  expect(unsubscribe).not.toHaveBeenCalled();
  dependencyVisibility.set(original);
});

it("disconnect removes the dependency visibility listener", () => {
  const { host } = sandbox();
  const subscribe = dependencyVisibility.subscribe;
  const listeners: (() => void)[] = [];
  const disposer = vi.fn();
  vi.spyOn(dependencyVisibility, "subscribe").mockImplementation((listener) => {
    listeners.push(listener);
    disposer.mockImplementation(subscribe(listener));
    return disposer;
  });
  const disconnect = createTutorialRunner(mobileApi, { close: vi.fn(), host }).connect();
  expect(listeners).toHaveLength(1);
  expect(disposer).not.toHaveBeenCalled();
  disconnect();
  expect(disposer).toHaveBeenCalledOnce();
});

it("waits for a boundary's flow id to finish naming", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    subjects: { box: { boundary: true } },
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "label", subject: "box", is: () => "Checkout" },
        settle: "naming",
        demo: [{ kind: "rename", subject: "box", label: () => "Checkout" }],
      },
    ],
  };
  const s = sandbox(tutorial, {
    ...named(),
    groups: [{ id: "box", label: "Boundary", x: 0, y: 0, width: 400, height: 200 }],
  });
  s.mode({ value: "naming", target: "group:box" });
  s.edit({ ...s.editor.getDiagram(), groups: [{ id: "box", label: "Checkout", x: 0, y: 0, width: 400, height: 200 }] });
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state.value).toBe("completing");
  s.mode({ value: "editing", target: null });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("adds a member through the editor and sends Present demos to the app owner", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    subjects: { ...mobileApi.subjects, box: { boundary: true } },
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "member", subject: "api", boundary: "box" },
        demo: [{ kind: "member", subject: "api", boundary: "box" }],
      },
    ],
  };
  const s = sandbox(tutorial, {
    ...named(),
    groups: [{ id: "box", label: "Checkout", x: 0, y: 0, width: 400, height: 200 }],
  });
  const moveIntoBoundary = vi.fn();
  s.hostState.canvas.editor = { ...s.hostState.canvas.editor, moveIntoBoundary };
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(moveIntoBoundary).toHaveBeenCalledExactlyOnceWith(["api"], "box", { signal: expect.any(AbortSignal) });
  const present = vi.fn();
  const runner = createTutorialRunner(
    {
      ...tutorial,
      steps: [{ ...tutorial.steps[0], check: { kind: "presenting", on: true }, demo: [{ kind: "present", on: true }] }],
    },
    { close: vi.fn(), host: s.host, present },
  );
  cleanup.push(runner.connect());
  runner.send({ type: "start" });
  runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(present).toHaveBeenCalledExactlyOnceWith(true);
  runner.appChanged({ presenting: true, sharing: false });
  expect(runner.getSnapshot().state.value).toBe("finished");
});

it("latches Present, waits for Escape, then observes the real Share dialog", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      { ...mobileApi.steps[0], id: "present", check: { kind: "presenting", on: true }, sticky: true, demo: [] },
      {
        ...mobileApi.steps[0],
        id: "leave",
        check: { kind: "presenting", on: false },
        demo: [{ kind: "present", on: false }],
      },
      { ...mobileApi.steps[0], id: "share", check: { kind: "sharing" }, sticky: true, demo: [] },
    ],
  };
  const s = sandbox(tutorial);
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state.index).toBe(0);
  s.runner.appChanged({ presenting: true, sharing: false });
  expect(s.runner.getSnapshot().state.index).toBe(1);
  s.runner.appChanged({ presenting: false, sharing: false });
  expect(s.runner.getSnapshot().state.index).toBe(2);
  s.runner.appChanged({ presenting: false, sharing: true });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("keeps adding from Ctrl+K complete when Go to selects the topic", () => {
  const initial = {
    ...named(),
    nodes: [...named().nodes, { id: "topic", stencil: "kafka.topic", label: "Kafka Topic", x: 500, y: 0 }],
  };
  const s = sandbox(commandPalette, named());
  s.runner.send({ type: "start" });
  s.mode({ selection: ["topic"] });
  s.edit(initial);
  expect(s.runner.getSnapshot().state.index).toBe(1);
  s.mode({ selection: ["api"] });
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 1, value: "active" });
  s.mode({ selection: ["topic"] });
  observationPorts.navigation.publish({
    documentId: "sandbox",
    identity: s.editor.getDocumentVersion().identity,
    nodeId: "topic",
  });
  expect(s.runner.getSnapshot().state).toMatchObject({ value: "active", index: 2 });
});

it("reopens adding from Ctrl+K when the topic is undone before Go to", () => {
  const s = sandbox(commandPalette, named());
  s.runner.send({ type: "start" });
  s.mode({ selection: ["topic"] });
  s.edit({
    ...named(),
    nodes: [...named().nodes, { id: "topic", stencil: "kafka.topic", label: "Kafka Topic", x: 500, y: 0 }],
  });
  s.mode({ selection: ["api"] });
  expect(s.runner.getSnapshot().state.index).toBe(1);
  s.edit(named());
  expect(s.runner.getSnapshot().state).toMatchObject({ index: 0, value: "active" });
});

it("insert-on-edge: Skip removes only the bypass and keeps the gateway selected in the real editor", async () => {
  const s = sandbox(insertOnEdge);
  s.runner.send({ type: "start" });
  const h = editorHarness({
    ...s.getDiagram(),
    nodes: [...s.getDiagram().nodes, { id: "gateway", stencil: "aws.api-gateway", label: "Gateway", x: 270, y: 0 }],
    edges: [
      ...s.getDiagram().edges,
      { id: "upstream", from: "app", to: "gateway", kind: "sync" },
      { id: "downstream", from: "gateway", to: "api", kind: "sync" },
    ],
  });
  // Document replacement uses the real editor's toFlow result, including its selection reset.
  h.deps.history.replace = vi.fn((flow) => {
    h.setNodes(flow.nodes);
    h.deps.setEdges(flow.edges);
    h.commit();
  });
  h.deps.setEditing = vi.fn();
  h.api.select({ nodeIds: ["gateway"] });
  s.hostState.canvas.editor = h.api;
  s.publish();
  const nodes = h.nodes();
  s.runner.send({ type: "skip", stepId: "insert" });
  await Promise.resolve();
  h.commit();
  s.publish();
  await vi.waitFor(() => expect(s.runner.getSnapshot().state).toMatchObject({ index: 1, value: "active" }));
  expect(h.api.getDiagram().edges.map((e) => e.id)).toEqual(["upstream", "downstream"]);
  expect(h.api.getSelection()).toEqual({ nodeIds: ["gateway"], groupIds: [], edgeIds: [] });
  expect(h.nodes()).toEqual(nodes);
  expect(h.deps.history.replace).not.toHaveBeenCalled();
});

it("aligns only the learner's selection when Skip has no explicit subjects", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      { ...mobileApi.steps[0], check: { kind: "mode", value: "quickAdd" }, demo: [{ kind: "align", mode: "middle" }] },
    ],
  };
  const s = sandbox(tutorial, named());
  const align = vi.fn();
  s.hostState.canvas.editor = {
    ...s.hostState.canvas.editor,
    align,
    getSelection: () => ({ nodeIds: ["api"], edgeIds: [], groupIds: [] }),
  };
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(align).toHaveBeenCalledExactlyOnceWith(["api"], "middle");
});

it("aligns fallback ids before React Flow publishes the restored selection", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "aligned", axis: "y", atLeast: 2 },
        demo: [{ kind: "align", mode: "middle", selection: { atLeast: 2, fallback: ["app", "api"] } }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  const align = vi.fn(),
    select = vi.fn();
  s.hostState.canvas.editor = {
    ...s.hostState.canvas.editor,
    align,
    select,
    getSelection: () => ({ nodeIds: [], edgeIds: [], groupIds: [] }),
  };
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await Promise.resolve();
  expect(select).toHaveBeenCalledExactlyOnceWith({ nodeIds: ["app", "api"], groupIds: [], edgeIds: [] });
  expect(align).toHaveBeenCalledExactlyOnceWith(["app", "api"], "middle");
});

it("waits for the rebuilt run before latching traffic after an edge-kind edit", () => {
  const tutorial: Tutorial = {
    ...requestVsMessage,
    steps: requestVsMessage.steps.filter((step) => step.id === "flip" || step.id === "watch-api"),
  };
  const s = sandbox(tutorial, named());
  const before = new LiveController(named()).getState();
  before.snapshot.nodes.api.processed = 50;
  let session = before;
  s.hostState.session.state = () => session;
  s.hostState.canvas.live = true;
  s.publish();
  s.runner.send({ type: "start" });
  s.edit({ ...named(), edges: [{ ...named().edges[0], kind: "async" }] });
  expect(s.runner.getSnapshot().state).toMatchObject({ value: "active", index: 1 });
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  session = {
    ...before,
    generation: before.generation + 1,
    diagramBasis: structuralKey(s.editor.getDiagram()),
    snapshot: {
      ...before.snapshot,
      nodes: { ...before.snapshot.nodes, api: { ...before.snapshot.nodes.api, processed: 0 } },
    },
  };
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("active");
  session.snapshot.nodes.api.processed = 10;
  s.tick();
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("completes watch after pause, rename, undo before diagram sync, and resume without a generation change", () => {
  const tutorial: Tutorial = { ...mobileApi, steps: [mobileApi.steps[5]] };
  const initial = named();
  initial.nodes[0].props = { ratePerSec: 20 };
  const s = sandbox(tutorial, initial);
  const controller = new LiveController(initial, {
    roleOf: (stencil) => (stencil === "client.mobile" ? "source" : "processor"),
  });
  cleanup.push(() => controller.dispose());
  controller.setTraffic(true);
  cleanup.push(controller.subscribe(s.tick));
  s.hostState.session.state = () => controller.getState();
  s.hostState.canvas.live = true;
  s.publish();
  s.runner.send({ type: "start" });
  controller.setPlaying(false);
  const generation = controller.getState().generation;
  s.editor.updateNode("app", { label: "Changed app" });
  s.edit(initial); // Undo before the debounced update reaches Live.
  expect(controller.updateDiagram(s.editor.getDiagram())).toBe("none");
  controller.setPlaying(true);
  controller.advance(2000);
  controller.publish();
  expect(controller.getState().snapshot.nodes.api.processed).toBeGreaterThanOrEqual(10);
  expect(controller.getState().generation).toBe(generation);
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("accepts new-run traffic when Live has already rebuilt before the edited document publishes", () => {
  const tutorial: Tutorial = { ...requestVsMessage, steps: [requestVsMessage.steps[4]] };
  const s = sandbox(tutorial, named());
  let session = new LiveController(named()).getState();
  s.hostState.session.state = () => session;
  s.hostState.canvas.live = true;
  s.publish();
  s.runner.send({ type: "start" });
  session = {
    ...session,
    generation: session.generation + 1,
    diagramBasis: structuralKey({ ...named(), edges: [{ ...named().edges[0], kind: "async" }] }),
  };
  session.snapshot.nodes.api.processed = 10;
  s.edit({ ...named(), edges: [{ ...named().edges[0], kind: "async" }] });
  expect(s.runner.getSnapshot().state.value).toBe("finished");
});

it("starts an example's simulation once its own sandbox publishes, and restores the loaded start on Restart", () => {
  const s = sandbox();
  s.hostState.canvas.documentId = "other";
  const runSimulation = vi.fn(() => true);
  s.host.runSimulation = runSimulation;
  const initial = named();
  const runner = createTutorialRunner(
    { ...mobileApi, start: { example: "retry-storm", simulation: "demo" } },
    { close: vi.fn(), host: s.host, initial, documentId: "sandbox" },
  );
  cleanup.push(runner.connect());
  expect(runSimulation).not.toHaveBeenCalled();
  s.hostState.canvas.documentId = "sandbox";
  s.publish();
  s.publish();
  expect(runSimulation).toHaveBeenCalledExactlyOnceWith("demo");
  runner.send({ type: "start" });
  s.editor.updateNode("api", { label: "Changed" });
  runner.send({ type: "restart" });
  expect(s.editor.getDiagram()).toEqual(initial);
  expect(runSimulation).toHaveBeenCalledTimes(2);
});

it("subscribes to slow motion's published state and cleans up that subscription", () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [{ ...mobileApi.steps[0], check: { kind: "slowmo" }, sticky: true, demo: [] }],
  };
  const s = sandbox(tutorial);
  const listeners = new Set<() => void>();
  let status: "off" | "on" = "off";
  const slowmo = {
    getState: () => ({ status }),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } as SessionHost["slowmo"];
  s.hostState.session = { ...s.hostState.session, slowmo };
  s.hostState.canvas.live = true;
  s.publish();
  s.runner.send({ type: "start" });
  status = "on";
  listeners.forEach((fn) => fn());
  expect(s.runner.getSnapshot().state.value).toBe("finished");
  cleanup.reverse().forEach((fn) => fn());
  cleanup.length = 0;
  expect(listeners.size).toBe(0);
});

it.each([false, true])(
  "waits for a deferred Live session and enabled fault action (cancelled: %s)",
  async (cancelled) => {
    const tutorial: Tutorial = {
      ...mobileApi,
      steps: [
        { ...mobileApi.steps[0], id: "live", check: { kind: "live" }, demo: [{ kind: "live" }] },
        {
          ...mobileApi.steps[0],
          id: "fault",
          check: { kind: "fault", subject: "api", fault: "down" },
          demo: [{ kind: "fault", subject: "api", fault: "down" }],
        },
        { ...mobileApi.steps[0], id: "watch", check: { kind: "processed", subject: "api", atLeast: 1 }, demo: [] },
      ],
    };
    saveProgress(tutorial, 2, false);
    const s = sandbox(tutorial, named());
    const session = s.hostState.session;
    s.hostState.session = null as unknown as SessionHost;
    s.hostState.canvas.editor.getSelection = () => ({ nodeIds: [], edgeIds: [], groupIds: [] });
    const run = vi.fn();
    s.runner.send({ type: "resume" });
    await vi.waitFor(() => expect(s.hostState.canvas.live).toBe(true));
    // Resume must replay the fault after going Live, even while the lazy session is absent.
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    if (cancelled) s.runner.send({ type: "exit" });
    s.hostState.session = session;
    s.publish();
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    let enabled = false;
    const action = {
      id: "sim.kill",
      section: "simulation",
      targets: ["node"] as const,
      modes: ["live"] as const,
      label: "Kill",
      enabled: () => enabled,
      run,
    };
    cleanup.push(actionRegistry.register([action]));
    expect(run).not.toHaveBeenCalled();
    enabled = true;
    cleanup.push(actionRegistry.register([action]));
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(cancelled ? 0 : 1);
  },
);

it("ends active slow motion and waits for simulation switching before Restart", async () => {
  const s = sandbox();
  const runSimulation = vi.fn(() => !s.hostState.session.disabledHint);
  s.host.runSimulation = runSimulation;
  const runner = createTutorialRunner(
    { ...mobileApi, start: { example: "retry-storm", simulation: "demo" } },
    { close: vi.fn(), host: s.host, initial: named() },
  );
  cleanup.push(runner.connect());
  runner.send({ type: "start" });
  runSimulation.mockClear();
  const end = vi.fn();
  s.hostState.session = {
    ...s.hostState.session,
    disabledHint: "Slow motion",
    slowmo: {
      getState: () => ({ status: "on" }),
      subscribe: () => () => {},
      end,
    } as unknown as SessionHost["slowmo"],
  };
  s.publish();
  runner.send({ type: "restart" });
  expect(end).toHaveBeenCalledOnce();
  expect(runSimulation).not.toHaveBeenCalled();
  s.hostState.session = { ...s.hostState.session, disabledHint: undefined };
  s.publish();
  await Promise.resolve();
  expect(runSimulation).toHaveBeenCalledExactlyOnceWith("demo");
  expect(runSimulation).toHaveReturnedWith(true);
});

for (const outcome of ["false", "reject"] as const) {
  it(`recovers an async boundary ${outcome} in place and retries without discarding edits`, async () => {
    const tutorial: Tutorial = {
      ...mobileApi,
      subjects: { ...mobileApi.subjects, box: { boundary: true } },
      steps: [
        {
          ...mobileApi.steps[0],
          check: { kind: "member", subject: "api", boundary: "box" },
          demo: [{ kind: "member", subject: "api", boundary: "box" }],
        },
      ],
    };
    const s = sandbox(tutorial, {
      ...named(),
      groups: [{ id: "box", label: "Checkout", x: 0, y: 0, width: 400, height: 200 }],
    });
    const move = vi
      .fn()
      .mockImplementationOnce(() =>
        outcome === "false" ? Promise.resolve(false) : Promise.reject(new Error("download")),
      )
      .mockImplementation(() => {
        s.edit({
          ...s.editor.getDiagram(),
          nodes: s.editor.getDiagram().nodes.map((n) => (n.id === "api" ? { ...n, group: "box" } : n)),
        });
        return Promise.resolve(true);
      });
    s.hostState.canvas.editor = { ...s.hostState.canvas.editor, moveIntoBoundary: move };
    s.publish();
    s.runner.send({ type: "start" });
    s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
    await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("failed"));
    s.editor.updateNode("api", { description: "My draft" });
    s.runner.send({ type: "retry" });
    await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
    expect(move).toHaveBeenCalledTimes(2);
    expect(s.editor.getDiagram().nodes.find((n) => n.id === "api")?.description).toBe("My draft");
  });
}

for (const cancel of ["restart", "exit", "replace"] as const) {
  it(`cancels delayed demo work on ${cancel}`, async () => {
    const tutorial: Tutorial = {
      ...mobileApi,
      subjects: { ...mobileApi.subjects, box: { boundary: true } },
      steps: [
        {
          ...mobileApi.steps[0],
          check: { kind: "member", subject: "api", boundary: "box" },
          demo: [
            { kind: "member", subject: "api", boundary: "box" },
            { kind: "rename", subject: "api", label: () => "Late overwrite" },
          ],
        },
      ],
    };
    const s = sandbox(tutorial, {
      ...named(),
      groups: [{ id: "box", label: "Checkout", x: 0, y: 0, width: 400, height: 200 }],
    });
    let resolve!: (ok: boolean) => void;
    let signal: AbortSignal | undefined;
    s.hostState.canvas.editor.moveIntoBoundary = vi.fn((_ids, _group, options) => {
      signal = options?.signal;
      return new Promise<boolean>((done) => {
        resolve = done;
      });
    });
    s.runner.send({ type: "start" });
    s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
    await vi.waitFor(() => expect(signal).toBeDefined());
    if (cancel === "replace") {
      s.hostState.canvas.documentId = "replacement";
      s.publish();
    } else s.runner.send({ type: cancel });
    expect(signal!.aborted).toBe(true);
    expect(s.close).toHaveBeenCalledTimes(cancel === "exit" ? 1 : 0);
    resolve(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.runner.getSnapshot().state.value).toBe(cancel === "restart" ? "active" : "closed");
    expect(s.editor.getDiagram().nodes.some((n) => n.label === "Late overwrite")).toBe(false);
  });
}

it("reports an unavailable simulation launch before waiting for its check", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "simulation", id: "missing" },
        demo: [{ kind: "runSimulation", id: "missing" }],
      },
    ],
  };
  const s = sandbox(tutorial, named());
  s.host.runSimulation = vi.fn(() => false);
  s.runner.send({ type: "start" });
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("failed"));
  expect(s.host.runSimulation).toHaveBeenCalledOnce();
});

it("Skip settles a boundary selection using its editor flow ID", async () => {
  const tutorial: Tutorial = {
    ...mobileApi,
    subjects: { box: { boundary: true } },
    steps: [
      {
        ...mobileApi.steps[0],
        check: { kind: "label", subject: "box", is: () => "Checkout" },
        settle: { kind: "selection", subjects: ["box"], tip: () => "Select the boundary" },
        demo: [{ kind: "rename", subject: "box", label: () => "Checkout" }],
      },
    ],
  };
  const s = sandbox(tutorial, {
    ...named(),
    groups: [{ id: "box", label: "Checkout", x: 0, y: 0, width: 400, height: 200 }],
  });
  const select = vi.fn(() => s.mode({ selection: ["group:box"] }));
  s.hostState.canvas.editor.select = select;
  s.runner.send({ type: "start" });
  expect(s.runner.getSnapshot().state.value).toBe("completing");
  s.runner.send({ type: "skip", stepId: tutorial.steps[0].id });
  await vi.waitFor(() => expect(s.runner.getSnapshot().state.value).toBe("finished"));
  expect(select).toHaveBeenCalledWith({ nodeIds: [], groupIds: ["box"], edgeIds: [] });
});

it("Restart requests a fresh history rather than an undoable document replacement", () => {
  const s = sandbox();
  s.runner.send({ type: "start" });
  const apply = vi.spyOn(s.editor, "applyDiagram");
  s.runner.send({ type: "restart" });
  expect(apply).toHaveBeenCalledExactlyOnceWith(mobileApi.start(), { resetHistory: true });
});
