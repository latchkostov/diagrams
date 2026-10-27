import { afterEach, expect, it, vi } from "vitest";
import { createDomPort, dialogTabTarget } from "./domPort";
import { createInteractionController } from "./controller";

afterEach(() => vi.unstubAllGlobals());

it("waits for a frame-hidden node to be revealed before resolving keyboard focus", () => {
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  class Card {
    style = { visibility: "visible" };
    hidden = true;
    closest() {
      return this.hidden ? this : null;
    }
  }
  vi.stubGlobal("HTMLElement", Card);
  const card = new Card();
  const root = { querySelector: () => card } as unknown as HTMLElement;
  const port = createDomPort({ root: () => root, hasNode: () => true });
  expect(port.resolve({ kind: "node", id: "next" }).state).toBe("waiting");
  card.hidden = false;
  expect(port.resolve({ kind: "node", id: "next" })).toEqual({ state: "ready", el: card, node: "next" });
});

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

it("resolves library and dock controls across the canvas column", () => {
  const search = {};
  const toggle = {};
  const view = { querySelector: (selector: string) => (selector.includes("palette-search") ? search : toggle) };
  const root = {
    closest: (selector: string) => (selector === ".canvas-view" ? view : null),
    parentElement: { querySelector: () => null },
  } as unknown as HTMLElement;
  const port = createDomPort({ root: () => root });
  expect(port.resolve({ kind: "paletteSearch" })).toEqual({ state: "ready", el: search });
  expect(port.resolve({ kind: "inspectorToggle" })).toEqual({ state: "ready", el: toggle });
});

it("R-081d6234ae keyboard focus survives multiple frames of camera culling", () => {
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  class Card {
    style = { visibility: "visible" };
    hidden = true;
    closest() {
      return this.hidden ? this : null;
    }
  }
  vi.stubGlobal("HTMLElement", Card);
  const card = new Card();
  const root = { querySelector: () => card } as unknown as HTMLElement;
  const dom = createDomPort({ root: () => root, hasNode: () => true });
  const frames: (() => void)[] = [];
  const focus = vi.fn(() => true);
  const controller = createInteractionController(
    { ...dom, active: () => null, focus },
    {
      frame(run) {
        frames.push(run);
        return () => {
          const at = frames.indexOf(run);
          if (at >= 0) frames.splice(at, 1);
        };
      },
      microtask: (run) => run(),
    },
  );
  controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "next" } });
  for (let i = 0; i < 5; i++) {
    frames.shift()?.();
    expect(controller.phase).toBe("focus-pending");
    expect(focus).not.toHaveBeenCalled();
  }
  card.hidden = false;
  frames.shift()!();
  expect(focus).toHaveBeenCalledExactlyOnceWith(card, undefined);
});
