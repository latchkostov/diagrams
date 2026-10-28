// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { keepInPane } from "./keepInPane";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("keeps an editor inside the pane after camera moves and restores its title anchor", () => {
  const notifications: (() => void)[] = [];
  const frames: FrameRequestCallback[] = [];
  class Observer {
    constructor(notify: () => void) {
      notifications.push(notify);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("MutationObserver", Observer);
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const pane = document.createElement("div");
  pane.className = "react-flow";
  const viewport = document.createElement("div");
  viewport.className = "react-flow__viewport";
  viewport.style.transform = "scale(1)";
  const editor = document.createElement("div");
  editor.style.translate = "10px 4px";
  pane.append(viewport);
  viewport.append(editor);
  document.body.append(pane);
  let pan = 0;
  vi.spyOn(pane, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, 0, 390, 844));
  vi.spyOn(editor, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(pan + parseFloat(editor.style.translate), 100, 240, 24),
  );
  const restore = keepInPane(editor);
  expect(editor.getBoundingClientRect().left).toBe(10);
  for (const next of [-100, 500]) {
    pan = next;
    viewport.style.transform = `translate(${pan}px, 0px) scale(1)`;
    for (const notify of notifications) notify();
    for (const frame of frames.splice(0)) frame(0);
    const bounds = editor.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(8);
    expect(bounds.right).toBeLessThanOrEqual(382);
  }
  restore();
  expect(editor.style.translate).toBe("10px 4px");
});
