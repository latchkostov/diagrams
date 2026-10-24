/* eslint-disable local/no-literal-ui-text -- Diagram labels in these fixtures are test input, not UI copy. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorApi } from "../editor/types";
import type { DiagramFile, DiagramNode } from "../model/types";
import { canvasInteraction } from "../canvas/interaction/canvasInteraction";
import { initialEditorMode, type EditorModeState } from "../canvas/interaction/mode";
import type { paletteHost } from "../palette/host";
import { mobileApi } from "./catalog/mobileApi";
import { createTutorialRunner } from "./runner";
import { savedProgress, saveProgress } from "./progress";
import type { Tutorial } from "./types";

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
});

function sandbox(tutorial = mobileApi, initial = tutorial.start(), deferAdds = false) {
  let diagram = initial;
  let version = { identity: {}, revision: 0 };
  let mode = initialEditorMode;
  const changes = new Set<() => void>();
  const modes = new Set<() => void>();
  const sessions = new Set<() => void>();
  const notify = () => changes.forEach((f) => f());
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
    canvas: { editor: editor as unknown as EditorApi, live: false, addStencil: add, focusNode: vi.fn() },
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
    },
    pendingRun: null,
  };
  cleanup.push(
    canvasInteraction.publish({
      get mode() {
        return mode;
      },
      setGuide: () => {},
      subscribeMode: (f) => {
        const listener = () => f(mode, mode);
        modes.add(listener);
        return () => modes.delete(listener);
      },
    }),
  );
  const host: Pick<typeof paletteHost, "get" | "subscribe"> = {
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
  const s = sandbox(tutorial, tutorial.start(), true);
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
