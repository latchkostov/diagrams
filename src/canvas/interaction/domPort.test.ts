import { afterEach, expect, it, vi } from "vitest";
import { createDomPort, dialogTabTarget } from "./domPort";
import { createInteractionController } from "./controller";

afterEach(() => vi.unstubAllGlobals());

it("wraps only boundary Tabs, skipping disabled and hidden modal controls", () => {
  const first = { hasAttribute: () => false, hidden: false };
  const middle = { hasAttribute: () => false, hidden: false };
  const last = { hasAttribute: () => false, hidden: false };
  const panel = {
    querySelectorAll: () => [
      first,
      middle,
      last,
      { hasAttribute: () => true },
      { hasAttribute: () => false, hidden: true },
    ],
  } as unknown as HTMLElement;
  const document = { activeElement: first as object };
  vi.stubGlobal("document", document);
  expect(dialogTabTarget(panel, true)).toBe(last);
  expect(dialogTabTarget(panel, false)).toBeNull();
  document.activeElement = middle;
  expect(dialogTabTarget(panel, true)).toBeNull();
  expect(dialogTabTarget(panel, false)).toBeNull();
  document.activeElement = last;
  expect(dialogTabTarget(panel, false)).toBe(first);
  expect(dialogTabTarget(panel, true)).toBeNull();
  document.activeElement = panel;
  expect(dialogTabTarget(panel, false)).toBe(first);
  expect(dialogTabTarget(panel, true)).toBe(last);
});

it("Undo to a hidden edge falls back once, while an edge waiting to mount remains pending", () => {
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  const frames: (() => void)[] = [];
  const root = { isConnected: true, querySelector: vi.fn(() => null) } as unknown as HTMLElement;
  let visible = true;
  const dom = createDomPort({ root: () => root, hasEdge: () => visible });
  const focus = vi.fn(() => true);
  const controller = createInteractionController(
    { ...dom, active: () => null, focus },
    {
      frame(run) {
        frames.push(run);
        return () => {
          const i = frames.indexOf(run);
          if (i >= 0) frames.splice(i, 1);
        };
      },
      microtask: (run) => run(),
    },
  );
  controller.dispatch({
    type: "selection.changed",
    cause: "undo",
    selection: { nodes: [], edges: ["dependency"] },
    origin: "canvas",
  });
  frames.shift()!();
  expect(controller.phase).toBe("focus-pending");
  expect(frames).toHaveLength(1);
  visible = false;
  frames.shift()!();
  expect(controller.phase).toBe("idle");
  expect(frames).toHaveLength(0);
  expect(focus).toHaveBeenCalledExactlyOnceWith(root, undefined);
});

it("a hidden edge's stale DOM wrapper cannot take focus", () => {
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  const querySelector = vi.fn(() => ({}));
  const root = { querySelector } as unknown as HTMLElement;
  const port = createDomPort({ root: () => root, hasEdge: () => false });
  expect(port.resolve({ kind: "edge", id: "hidden" })).toEqual({ state: "gone" });
  expect(querySelector).not.toHaveBeenCalled();
});
