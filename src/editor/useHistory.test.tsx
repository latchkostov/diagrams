// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { toFlow } from "../canvas/convert";
import { toast } from "../interop/ui/toast";
import { toast as interaction } from "../interop/ui/toastRuntime";
import { HistoryController } from "./historyController";
import { useHistory, type CanvasSnapshot } from "./useHistory";

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
