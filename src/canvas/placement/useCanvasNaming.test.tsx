// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useCanvasNaming } from "./useCanvasEditCommands";
import type { EditorApi } from "../../editor/types";
import type { useHistory } from "../../editor/useHistory";
import type { useRevealSelection } from "../camera";

it("keeps canvas rename callbacks stable across history state snapshots", async () => {
  const editor = {} as EditorApi;
  const finish = vi.fn();
  const openInspector = vi.fn();
  const setEditing = vi.fn();
  const setNaming = vi.fn();
  const rename = { current: vi.fn() };
  const controller = { placing: vi.fn(), dispatch: vi.fn() };
  const reveal = vi.fn() as ReturnType<typeof useRevealSelection>["revealSelection"];
  const callbacks: ReturnType<typeof useCanvasNaming>[0][] = [];
  function Harness() {
    // useHistory returns a fresh snapshot with stable methods after each document edit.
    const history = { end: finish } as unknown as ReturnType<typeof useHistory>;
    const [renameIn] = useCanvasNaming(
      true,
      editor,
      openInspector,
      setEditing,
      setNaming,
      rename,
      history,
      controller,
      reveal,
    );
    useLayoutEffect(() => {
      callbacks.push(renameIn);
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(() => root.render(<Harness />));
    await act(() => root.render(<Harness />));
    expect(callbacks).toHaveLength(2);
    expect(callbacks[1]).toBe(callbacks[0]);
  } finally {
    await act(() => root.unmount());
  }
});

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
