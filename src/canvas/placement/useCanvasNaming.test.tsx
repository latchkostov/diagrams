// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useCanvasNaming } from "./useCanvasEditCommands";
import type { EditorApi } from "../../editor/types";
import type { useHistory } from "../../editor/useHistory";
import type { useRevealSelection } from "../camera";

it("persists placement's name before the camera finishes revealing its new node", async () => {
  const authoredName = "Na";
  const updateNode = vi.fn();
  const editor = { updateNode, getAnnotation: () => undefined } as unknown as EditorApi;
  const history = { end: vi.fn() } as unknown as ReturnType<typeof useHistory>;
  let revealed: (() => void) | undefined;
  const reveal = ((then: () => void) => {
    revealed = then;
  }) as ReturnType<typeof useRevealSelection>["revealSelection"];
  let pick: ReturnType<typeof useCanvasNaming>[1] | undefined;
  const dispatch = vi.fn();
  function Harness() {
    const [, pickNamed] = useCanvasNaming(
      true,
      editor,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { current: vi.fn() },
      history,
      { placing: vi.fn(), dispatch },
      reveal,
    );
    useLayoutEffect(() => {
      pick = pickNamed;
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<Harness />));
    if (!pick) throw new Error("Naming hook did not mount");
    pick(() => ({ id: "new", edge: null, merge: "create:new" }), "Cache");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "N", cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    // The camera callback is deliberately still held; persisted edits must not depend on it.
    expect(updateNode).toHaveBeenLastCalledWith("new", { label: authoredName }, { merge: "create:new" });
    expect(dispatch).not.toHaveBeenCalled();
    revealed?.();
    expect(history.end).toHaveBeenCalledWith("create:new");
    expect(dispatch).toHaveBeenCalledWith({ type: "naming.done", flowId: "new" });
  } finally {
    revealed?.();
    await act(() => root.unmount());
    host.remove();
  }
});
