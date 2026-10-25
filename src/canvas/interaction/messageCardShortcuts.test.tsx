// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useCanvasShortcuts } from "../../editor/useCanvasShortcuts";
import type { EditorApi } from "../../editor/types";
import { createMessageCard } from "./messageCard";
import { createInteractionController } from "./controller";
import { useInteractionLifecycle } from "./useInteraction";

it("dispatches viewer card Escape through the controller after dialogs and menus", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const controller = createInteractionController(
    {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => true,
      publish: () => {},
    },
    { frame: () => () => {}, microtask: (run) => run() },
  );
  const card = createMessageCard();
  const detach = controller.attachEscape(card.escape);
  const editor = { getSelection: vi.fn() } as unknown as EditorApi;
  const selectionEscape = vi.fn();
  function Viewer() {
    useInteractionLifecycle(controller);
    useCanvasShortcuts(editor, { enabled: false, onEscape: selectionEscape });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const escape = () => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    await act(() => root.render(<Viewer />));
    for (const role of ["dialog", "menu"]) {
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      host.append(overlay);
      expect(escape()).toBe(false);
      expect(card.getSnapshot()).toBe(true);
      overlay.remove();
    }
    expect(escape()).toBe(true);
    expect(card.getSnapshot()).toBe(false);
    expect(escape()).toBe(false);
    expect(selectionEscape).not.toHaveBeenCalled();
    expect(editor.getSelection).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
    detach();
    vi.unstubAllGlobals();
  }
});
