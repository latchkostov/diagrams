// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactFlowState } from "@xyflow/react";
import { placeRegionTitles } from "./regionTitles";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { TitleBands } from "./camera/frameEdges";
import { geometryPreparation } from "./geometryPreparation";

vi.mock("./edges/useEdgeRoute", () => {
  const routes = new Map();
  return { selectRoutes: () => routes };
});
afterEach(() => vi.restoreAllMocks());

it("remeasures a zone label when exact identity scale settles at the same camera transform", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow__node" data-id="zone"><span class="ann-zone-label">Region</span></div>';
  const node = {
    id: "zone",
    type: "annotation",
    data: { kind: "zone" },
    position: { x: 0, y: 0 },
    measured: { width: 500, height: 200 },
    internals: { positionAbsolute: { x: 0, y: 0 } },
  };
  const state = {
    nodes: [node],
    edges: [],
    nodeLookup: new Map([["zone", node]]),
    transform: [0, 0, 0.5],
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const label = root.querySelector<HTMLElement>("span")!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 800));
  const reads = vi
    .spyOn(label, "getBoundingClientRect")
    .mockImplementation(() => new DOMRect(0, 0, 50 / Number(root.style.getPropertyValue("--rf-zoom-exact")), 20));
  const place = vi.spyOn(TitleBands.prototype, "place");
  const options = { style: "straight", direction: "LR" } as const;
  root.style.setProperty("--rf-zoom-exact", "0.5");
  placeRegionTitles(root, state, options);
  expect(place).toHaveBeenLastCalledWith(expect.anything(), { width: 100, height: 20 });
  root.style.setProperty("--rf-zoom-exact", "0.25");
  placeRegionTitles(root, state, options);
  expect(reads).toHaveBeenCalledTimes(2);
  expect(place).toHaveBeenLastCalledWith(expect.anything(), { width: 200, height: 20 });
});

it("shares region geometry between passes and reads all chip sizes before assigning transforms", () => {
  const root = document.createElement("div");
  const nodes = Array.from({ length: 8 }, (_, i) => ({
    id: `group:${i}`,
    type: "boundary",
    data: { label: `Region ${i}`, groupId: String(i) },
    position: { x: i * 600, y: i * 200 },
    measured: { width: 500, height: 100 },
    internals: { positionAbsolute: { x: i * 600, y: i * 200 } },
  }));
  const state = {
    nodes,
    edges: [],
    nodeLookup: new Map(nodes.map((n) => [n.id, n])),
    transform: [0, 0, 0.5],
  } as unknown as ReactFlowState<FlowNode, DiagramFlowEdge>;
  const options = { style: "straight", direction: "LR" } as const;
  root.innerHTML = nodes
    .map((n) => `<button class="detail-group-chip" data-region-id="${n.id}">${n.data.label}</button>`)
    .join("");
  const rootReads = vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  const events: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("button")) {
    Object.defineProperty(el, "offsetWidth", {
      get: () => {
        events.push("read");
        return 80;
      },
    });
    Object.defineProperty(el, "offsetHeight", {
      get: () => {
        events.push("read");
        return 24;
      },
    });
    const style = el.style;
    Object.defineProperty(el, "style", {
      get: () =>
        new Proxy(style, {
          set(target, key, value) {
            if (key === "transform") events.push("write");
            return Reflect.set(target, key, value);
          },
        }),
    });
  }
  const place = vi.spyOn(TitleBands.prototype, "place");
  placeRegionTitles(root, state, options, { phase: "settling", moving: false });
  expect(events).toEqual([]);
  expect(place).not.toHaveBeenCalled();
  placeRegionTitles(root, state, options);
  expect(rootReads).not.toHaveBeenCalled();
  expect(events.filter((v) => v === "read")).toHaveLength(16);
  expect(events.lastIndexOf("read")).toBeLessThan(events.indexOf("write"));
  expect(place).toHaveBeenCalledTimes(8);
  const transforms = [...root.children].map((el) => (el as HTMLElement).style.transform);
  expect(transforms).toEqual(nodes.map(() => "scale(calc(1 / var(--region-zoom, 1))) translate(10px, -28px)"));
  events.length = 0;
  placeRegionTitles(root, state, options);
  expect(events).toEqual([]);
  expect(place).toHaveBeenCalledTimes(8);
  events.length = 0;
  root.style.setProperty("--rf-zoom-exact", "0.48");
  placeRegionTitles(root, state, options);
  expect(events.filter((v) => v === "read")).toHaveLength(16);
  expect(place).toHaveBeenCalledTimes(16);
  root.firstElementChild!.textContent = "A longer region name";
  events.length = 0;
  placeRegionTitles(root, state, options);
  expect(events.filter((v) => v === "read")).toHaveLength(2);
  expect(place).toHaveBeenCalledTimes(24);
  geometryPreparation(root).clear();
  events.length = 0;
  placeRegionTitles(root, state, options);
  expect(events.filter((v) => v === "read")).toHaveLength(16);
});
