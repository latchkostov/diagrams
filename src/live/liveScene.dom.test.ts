// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { LiveScene, type FlowStoreLike } from "./liveScene";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function scene(n: number) {
  const root = document.createElement("div");
  document.body.append(root);
  root.innerHTML = `<svg class="react-flow__edges">${Array.from(
    { length: n },
    (_, i) =>
      `<g class="react-flow__edge" data-id="e${i}" data-live-edge="active"><g class="fe-async"><path class="fe-path react-flow__edge-path" d="M0 0 L60 0" /></g></g>`,
  ).join("")}</svg><span data-testid="badge">0</span>`;
  const lengths = vi.fn(() => 60);
  const points = vi.fn((l: number) => ({ x: l, y: 0 }));
  const paths = [...root.querySelectorAll("path")];
  for (const p of paths) Object.assign(p, { getTotalLength: lengths, getPointAtLength: points });
  const styles = vi.spyOn(window, "getComputedStyle").mockImplementation(
    (el) =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        getPropertyValue: () => "1",
        stroke: el.closest("[data-live-cut]") ? "red" : "blue",
        strokeWidth: "2",
        strokeDasharray: "5 5",
      }) as unknown as CSSStyleDeclaration,
  );
  const lookup = new Map([
    ["node", { internals: { positionAbsolute: { x: 0, y: 0 } }, measured: { width: 100, height: 70 } }],
  ]);
  const nodeReads = vi.spyOn(lookup, Symbol.iterator);
  const state: ReturnType<FlowStoreLike["getState"]> = {
    transform: [0, 0, 1],
    width: 800,
    height: 600,
    nodes: [],
    nodeLookup: lookup,
  };
  const live = new LiveScene(root, { getState: () => state });
  const scans = vi.spyOn(root, "querySelectorAll");
  live.refresh();
  for (let i = 0; i < n; i++) live.want(`e${i}`);
  live.takeChanges();
  return { live, root, paths, lengths, points, styles, scans, nodeReads, state };
}

it.each([64, 512])("does zero geometry/style/selector/node reads over 100 unchanged ticks (%i edges)", (n) => {
  const s = scene(n);
  try {
    expect(s.scans).toHaveBeenCalledTimes(1);
    expect(s.styles).toHaveBeenCalledTimes(1); // one shared style, no ancestor reads
    const march = s.live.march;
    const sample = s.live.samples("e0");
    for (const spy of [s.scans, s.styles, s.lengths, s.points, s.nodeReads]) spy.mockClear();
    const stringify = vi.spyOn(JSON, "stringify");
    for (let tick = 0; tick < 100; tick++) {
      s.live.refresh();
      s.live.readMarch();
      expect(s.live.samples("e0")).toBe(sample);
      expect(s.live.takeChanges()).toBeUndefined();
    }
    for (const spy of [s.scans, s.styles, s.lengths, s.points, s.nodeReads, stringify])
      expect(spy).not.toHaveBeenCalled();
    expect(s.live.march).toBe(march);
    // React and the detail layer may reassert an unchanged attribute during a publish.
    s.paths[0].closest("[data-id]")!.setAttribute("data-live-edge", "active");
    document.body.setAttribute("data-detail-view", "overview");
    s.live.refresh();
    s.styles.mockClear();
    document.body.setAttribute("data-detail-view", "overview");
    s.live.refresh();
    expect(s.styles).not.toHaveBeenCalled();
    document.body.removeAttribute("data-detail-view");
    s.live.refresh();
    s.styles.mockClear();
    s.root.querySelector('[data-testid="badge"]')!.textContent = "1";
    s.live.refresh();
    expect(s.scans).not.toHaveBeenCalled();
    expect(s.styles).not.toHaveBeenCalled();
  } finally {
    s.live.dispose();
  }
});

it("invalidates only the changed edge style, keeps geometry across styles/zoom and resamples a changed d", () => {
  const s = scene(64);
  try {
    const sample = s.live.samples("e0");
    s.styles.mockClear();
    s.lengths.mockClear();
    s.points.mockClear();
    s.scans.mockClear();
    s.paths[0].closest("[data-id]")!.setAttribute("data-live-cut", "1");
    s.live.refresh();
    expect(s.styles).toHaveBeenCalledTimes(1);
    expect(s.live.march[0].color).toBe("red");
    expect(s.live.samples("e0")).toBe(sample);
    expect(s.scans).not.toHaveBeenCalled();
    s.styles.mockClear();
    s.paths[0].setAttribute("d", "M0 0 L60 10");
    s.live.refresh();
    expect(s.scans).toHaveBeenCalledTimes(1);
    expect(s.styles).not.toHaveBeenCalled();
    expect(s.live.march[0].d).toBe("M0 0 L60 10");
    expect(s.live.samples("e0")).not.toBe(sample);
    expect(s.lengths).toHaveBeenCalledTimes(1);
    s.lengths.mockClear();
    s.points.mockClear();
    s.state.transform = [0, 0, 2];
    s.live.refresh();
    expect(s.styles).toHaveBeenCalledTimes(2);
    expect(s.lengths).not.toHaveBeenCalled();
    expect(s.points).not.toHaveBeenCalled();
    s.paths[0].closest("[data-id]")!.remove();
    s.live.refresh();
    expect(s.live.march).toHaveLength(63);
    expect(s.live.ink.has("e0")).toBe(false);
    expect(s.live.takeChanges()?.paths?.remove).toEqual(["e0"]);
  } finally {
    s.live.dispose();
  }
});

it("tracks theme, detail visibility, edge kind and remounts without sampling unchanged geometry", () => {
  const s = scene(8);
  try {
    const sample = s.live.samples("e0");
    s.styles.mockClear();
    document.body.setAttribute("data-theme", "dark");
    s.live.refresh();
    expect(s.styles).toHaveBeenCalledTimes(1);
    const group = s.paths[0].closest("[data-id]")!;
    group.setAttribute("data-detail-hidden", "");
    s.live.refresh();
    expect(s.live.march).toHaveLength(7);
    group.removeAttribute("data-detail-hidden");
    s.live.refresh();
    expect(s.live.march).toHaveLength(8);
    s.paths[0].parentElement!.setAttribute("class", "fe-sync");
    s.live.refresh();
    expect(s.live.march).toHaveLength(7);
    const copy = group.cloneNode(true) as Element;
    group.replaceWith(copy);
    s.live.refresh();
    expect(s.live.samples("e0")).toBe(sample);
  } finally {
    s.live.dispose();
    document.body.removeAttribute("data-theme");
  }
});

it("caches the opacity transition's target rather than its first fading sample", () => {
  const s = scene(8);
  try {
    const animations = vi.fn(() => []);
    Object.assign(s.paths[0], { getAnimations: animations });
    const read = s.styles.getMockImplementation()!;
    s.styles.mockImplementation(
      (el, pseudo) =>
        ({ ...read(el, pseudo), opacity: "0.4", getPropertyValue: () => "0.6" }) as unknown as CSSStyleDeclaration,
    );
    s.paths[0].closest("[data-id]")!.setAttribute("data-live-dim", "1");
    s.live.refresh();
    expect(s.live.march[0].opacity).toBe(0.6);
    expect(animations).not.toHaveBeenCalled();
    s.styles.mockClear();
    s.live.refresh();
    expect(s.styles).not.toHaveBeenCalled();
  } finally {
    s.live.dispose();
  }
});
