// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { aiDock, collapseDock } from "./dock";

afterEach(() => {
  aiDock.set({ open: false });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it.each([false, true])("restores close focus only while the dock stays closed (reopen=%s)", (reopen) => {
  const panel = document.createElement("section");
  panel.dataset.testid = "ai-panel";
  panel.tabIndex = -1;
  const rail = document.createElement("button");
  rail.dataset.testid = "ai-rail-open";
  document.body.append(panel, rail);
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  aiDock.set({ open: true });
  panel.focus();
  collapseDock();
  if (reopen) {
    aiDock.set({ open: true });
    panel.focus();
  }
  expect(frame).toBeDefined();
  frame!(0);
  expect(document.activeElement).toBe(reopen ? panel : rail);
});
