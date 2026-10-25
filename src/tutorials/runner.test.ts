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
import { LiveController, structuralKey } from "../live/controller";
import { requestVsMessage } from "./catalog/requestVsMessage";
import { propertySheet } from "./catalog/propertySheet";

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
    getDiagram,
    getDocumentVersion: () => version,
    clearSelection: () => {},
    startEditing: ({ id }: { id: string }) =>
      setMode(editorModeStep(mode, { type: "field.focused", target: id, field: "label" })),
    applyDiagram: edit,
    updateNode: (id: string, patch: Partial<DiagramNode>) =>
      edit({ ...diagram, nodes: diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
    createConnected: ({ from, stencil }: { from: string; stencil: string }) => {
      const id = add(stencil);
      editor.connect(from, id);
      return { id, edge: "edge", merge: "add" };
    },
    connect: (from: string, to: string) =>
      edit({ ...diagram, edges: [...diagram.edges, { id: "edge", from, to, kind: "sync" }] }),
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
  const runner = createTutorialRunner(tutorial, { close: vi.fn(), host });
  cleanup.push(runner.connect());
  return {
    runner,
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

const named = (): DiagramFile => ({
  ...mobileApi.start(),
  nodes: [
    { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0 },
    { id: "api", stencil: "generic.service", label: "Orders API", x: 200, y: 0 },
  ],
  edges: [{ id: "edge", from: "app", to: "api", kind: "sync" }],
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
  expect(savedProgress(newer)).toEqual({ version: 2, step: 0, completed: false });
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
