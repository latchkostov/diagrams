import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NodeDetails } from "./NodeDetails";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "../sim/engine";
import "../sim/cache/cacheRuntime";
import { compileTopology } from "../sim/topology";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import type { BadgeProps } from "./NodeBadges";
import type { SimSnapshot } from "../sim/types";

const state = vi.hoisted(() => ({ snapshot: undefined as SimSnapshot | undefined }));
vi.mock("./context", () => ({
  useLive: () => ({
    controller: { getState: () => ({ snapshot: state.snapshot }), effectiveProps: () => ({}) },
  }),
}));
vi.mock("./HoverCard", () => ({ HoverCard: () => null }));

it("keeps origin hover work linear with parallel incoming cache connections", () => {
  const run = (count: number) => {
    const d = cacheFixture();
    d.edges = Array.from({ length: count }, (_, i) => ({ ...d.edges[1], id: `parallel-${i}` }));
    const e = createEngine({ seed: 7 });
    e.load(d);
    state.snapshot = e.snapshot();
    state.snapshot.nodes.cache.cacheDetails = {
      window: { requests: 100, hits: 80, misses: 20, fetches: 20, seconds: 10 },
    };
    const topology = compileTopology(d);
    const edges = countingReads(d.edges);
    d.edges = edges.items;
    const node = {
      id: "origin",
      position: { x: 0, y: 0 },
      data: { label: "Origin", stencil: "generic.database" },
    } as BadgeProps["node"];
    renderToStaticMarkup(
      createElement(NodeDetails, {
        node,
        diagram: d,
        topology,
        s: state.snapshot.nodes.origin,
        configuration: {},
        fault: "",
        properties: false,
        hovered: false,
        pinned: false,
        showOutageLoss: false,
      }),
    );
    return edges.reads();
  };
  const small = run(100);
  expect(run(100 * GROWTH_FACTOR) / small).toBeLessThan(LINEAR_LIMIT);
});
