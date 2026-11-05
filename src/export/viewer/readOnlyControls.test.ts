// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createReadOnlyHistory } from "./readOnlyHistory";
import { useCanvasShortcuts } from "./readOnlyShortcuts";
import type { EditorApi } from "../../editor/types";
import type { CanvasSnapshot } from "../../editor/useHistory";

it("keeps file replacements but records no authoring, transactions or Undo", () => {
  const apply = vi.fn();
  const history = createReadOnlyHistory(apply);
  history.begin("creation");
  history.hint("edit");
  history.beginGesture();
  history.endGesture();
  history.end("creation");
  history.undo();
  history.redo();
  history.renameTitle("before", "after");
  expect(history.canUndo).toBe(false);
  expect(history.canRedo).toBe(false);
  expect(history.open()).toBeUndefined();
  expect(history.top()).toBeUndefined();
  expect(apply).not.toHaveBeenCalled();
  const next = { meta: {}, nodes: [], edges: [] } as unknown as CanvasSnapshot;
  history.replace(next);
  expect(apply).toHaveBeenCalledExactlyOnceWith(next);
});

it("retains Live Tab navigation and annotation links while authoring shortcuts stay inert", async () => {
  const host = document.createElement("div");
  host.dataset.testid = "canvas-wrap";
  const node = document.createElement("div");
  node.className = "react-flow__node";
  node.tabIndex = 0;
  const caption = document.createElement("div");
  caption.dataset.captionRoot = "";
  const link = document.createElement("a");
  link.href = "https://example.com";
  caption.append(link);
  node.append(caption);
  host.append(node);
  document.body.append(host);
  const root = createRoot(document.createElement("div"));
  const navigate = vi.fn(() => true);
  const editor = new Proxy({} as EditorApi, {
    get: () => () => {
      throw new Error("Authoring reached a file");
    },
  });
  function Keys({ live }: { live: boolean }) {
    useCanvasShortcuts(editor, { enabled: false, live, onEscape() {}, onNavigate: navigate });
    return null;
  }
  const key = (key: string, shiftKey = false, ctrlKey = false) => {
    const event = new KeyboardEvent("keydown", { key, shiftKey, ctrlKey, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(event);
    return event;
  };
  try {
    await act(() => root.render(createElement(Keys, { live: true })));
    node.focus();
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link);
    key("Tab", true);
    expect(document.activeElement).toBe(node);
    key("Tab", true);
    expect(navigate).toHaveBeenLastCalledWith("prev", node);
    link.focus();
    key("Tab");
    expect(navigate).toHaveBeenLastCalledWith("next", link);
    for (const [name, ctrl] of [
      ["Delete", false],
      ["F2", false],
      ["z", true],
      ["v", true],
      ["d", true],
    ] as const)
      expect(key(name, false, ctrl).defaultPrevented).toBe(false);
    await act(() => root.render(createElement(Keys, { live: false })));
    navigate.mockClear();
    node.focus();
    expect(key("Tab").defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
