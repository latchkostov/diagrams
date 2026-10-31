// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toFlow } from "../canvas/convert";
import { toast } from "../interop/ui/toast";
import { toast as interaction } from "../interop/ui/toastRuntime";
import { HistoryController } from "./historyController";
import { useHistory, type CanvasSnapshot } from "./useHistory";
import { MERGE_WINDOW_MS } from "./history";

it("a local copy drag stays one undo step across intermediate commits and a long hold", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const snapshot = (copyX?: number): CanvasSnapshot =>
    toFlow({
      format: "diagrams/v1",
      title: "Copy drag",
      edges: [],
      nodes: [
        { id: "original", stencil: "service.node", label: "Original", x: 0, y: 0 },
        ...(copyX === undefined ? [] : [{ id: "copy", stencil: "service.node", label: "Copy", x: copyX, y: 50 }]),
      ],
    });
  let api!: ReturnType<typeof useHistory>;
  let applied: CanvasSnapshot | undefined;
  function Harness({ state }: { state: CanvasSnapshot }) {
    api = useHistory(state, (next) => {
      applied = next;
      root.render(<Harness state={next} />);
    });
    return null;
  }
  const render = (state: CanvasSnapshot) => act(() => root.render(<Harness state={state} />));
  const hold = () => act(() => void vi.advanceTimersByTime(MERGE_WINDOW_MS * 2));
  try {
    await render(snapshot());
    await act(() => api.beginGesture());
    // A copy exists before React Flow marks its first position change as dragging.
    await render(snapshot(0));
    await hold();
    await render(snapshot(100));
    await hold();
    await act(() => api.endGesture());
    await act(() => void vi.runOnlyPendingTimers());
    await act(() => api.undo());
    expect(applied?.nodes.map((node) => node.id)).toEqual(["original"]);
    await act(() => api.redo());
    expect(applied?.nodes.find((node) => node.id === "copy")?.position).toEqual({ x: 100, y: 50 });
    // Ending the gesture releases its merge key: the next edit has its own Undo.
    await render(snapshot(200));
    await hold();
    await act(() => api.undo());
    expect(applied?.nodes.find((node) => node.id === "copy")?.position).toEqual({ x: 100, y: 50 });
    await act(() => api.undo());
    expect(applied?.nodes.map((node) => node.id)).toEqual(["original"]);
  } finally {
    await act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("reuses the rendered snapshot key when validating a retained Undo on selection changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const key = vi.spyOn(HistoryController.prototype, "key");
  let state: CanvasSnapshot = toFlow({
    format: "diagrams/v1",
    title: "Before",
    edges: [],
    nodes: [{ id: "node", stencil: "service.node", label: "Node", x: 0, y: 0 }],
  });
  function Harness({ snapshot }: { snapshot: CanvasSnapshot }) {
    useHistory(snapshot, () => {});
    return null;
  }
  try {
    await act(() => root.render(<Harness snapshot={state} />));
    state = { ...state, meta: { ...state.meta, title: "After" } };
    await act(() => root.render(<Harness snapshot={state} />));
    await act(() => {
      toast.info("Changed", { action: { label: "Undo", run() {}, undoes: true } });
      interaction.contact("focus", true);
    });
    expect(interaction.current?.undoUnavailable).toBe(false);
    key.mockClear();
    state = { ...state, nodes: state.nodes.map((node) => ({ ...node, selected: true })) };
    await act(() => root.render(<Harness snapshot={state} />));
    // One render key, with no extra full-document serialization from toast validation.
    expect(key).toHaveBeenCalledTimes(1);
    expect(interaction.current?.undoUnavailable).toBe(false);
  } finally {
    await act(() => root.unmount());
    interaction.release();
    toast.dismiss();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("capture merges settlement only until debounce expiry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const titled = (title: string): CanvasSnapshot =>
    toFlow({
      format: "diagrams/v1",
      title,
      edges: [],
      nodes: [{ id: "node", stencil: "service.node", label: "Node", x: 0, y: 0 }],
    });
  let api!: ReturnType<typeof useHistory>;
  let applied: CanvasSnapshot | undefined;
  function Harness({ snapshot }: { snapshot: CanvasSnapshot }) {
    api = useHistory(snapshot, (next) => void (applied = next));
    return null;
  }
  const render = (snapshot: CanvasSnapshot) => act(() => root.render(<Harness snapshot={snapshot} />));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  // A tagged edit whose Undo is offered at once: capture records it before the debounce would have.
  const offer = async (tag: string, title: string) => {
    api.hint(tag);
    await render(titled(title));
    await act(() => void toast.info(title, { action: { label: "Undo", run: () => api.undo(), undoes: true } }));
  };
  const undo = async () => {
    await act(() => api.undo());
    await render(applied!);
    return applied!.meta.title;
  };
  try {
    await render(titled("Start"));
    await offer("text-move", "Moved");
    // What settles before the debounce expires (the text's measure) joins the step the Undo names.
    await wait(100);
    await render(titled("Moved and measured"));
    await wait(400);
    expect(interaction.current?.undoUnavailable).toBe(false);
    expect(await undo()).toBe("Start");

    await offer("text-move", "Moved again");
    // Past the debounce, an unrelated edit is a step of its own (still inside the history's merge window).
    await wait(400);
    await render(titled("Unrelated"));
    await wait(400);
    expect(interaction.current?.undoUnavailable).toBe(true);
    expect(await undo()).toBe("Moved again");
    expect(await undo()).toBe("Start");
  } finally {
    await act(() => root.unmount());
    interaction.release();
    toast.dismiss();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
