import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NodeDetails } from "./NodeDetails";
import { CacheDetails } from "./CacheDetails";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "../sim/engine";
import "../sim/cache/cacheRuntime";
import { compileTopology } from "../sim/topology";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import type { BadgeProps } from "./NodeBadges";
import type { SimSnapshot } from "../sim/types";
import { createSimulationRun } from "../sim/simulation";
import { nodeSummary } from "./hoverSummary";

const state = vi.hoisted(() => ({ snapshot: undefined as SimSnapshot | undefined, labels: [] as string[] }));
vi.mock("./context", () => ({
  useLive: () => ({
    controller: { getState: () => ({ snapshot: state.snapshot }), effectiveProps: () => ({}) },
  }),
}));
vi.mock("./HoverCard", () => ({
  HoverCard: ({ summary }: { summary: { facts: { label: string }[] } }) => {
    state.labels = summary.facts.map((fact) => fact.label);
    return null;
  },
}));

it("distinguishes recent cache rates from cumulative rule and latency measurements", () => {
  const d = cacheFixture();
  const e = createEngine({ seed: 7 });
  e.load(d);
  e.setTraffic(true);
  e.step(1000);
  state.snapshot = e.snapshot();
  const cache = renderToStaticMarkup(
    createElement(CacheDetails, { diagram: d, id: "cache", s: state.snapshot.nodes.cache }),
  );
  expect(
    nodeSummary(state.snapshot.nodes.cache, []).sections.find((section) => section.key === "cache")?.summary,
  ).toMatch(/recent ≤10s$/);
  expect(cache).not.toContain("Recent window (up to 10 s)");
  expect(cache).toContain("Answered here (hits)");
  expect(cache).toContain("answered here since restart (hit ratio)");
  expect(cache).toContain('data-testid="cache-latency">At this cache since restart ·');
  const node = {
    id: "origin",
    position: { x: 0, y: 0 },
    data: { label: "Origin", stencil: "generic.database" },
  } as BadgeProps["node"];
  renderToStaticMarkup(
    createElement(NodeDetails, {
      node,
      diagram: d,
      topology: compileTopology(d),
      s: state.snapshot.nodes.origin,
      configuration: {},
      fault: "",
      properties: false,
      hovered: false,
      pinned: false,
      showOutageLoss: false,
    }),
  );
  expect(state.labels.some((label) => label.startsWith("Recent window (up to 10 s): Edge cache sends"))).toBe(true);
});

it("keeps both percentages first in the compact recent-window cache summary", () => {
  const e = createEngine({ seed: 7 });
  e.load(cacheFixture());
  const s = e.snapshot().nodes.cache;
  s.cacheDetails = { window: { requests: 100, hits: 86, misses: 14, fetches: 14, seconds: 10 } };
  expect(nodeSummary(s, []).sections.find((section) => section.key === "cache")?.summary).toBe(
    "86% hits · 86% offload · recent ≤10s",
  );
});

it("cache latency scope follows drill faults", () => {
  const d = cacheFixture();
  const run = createSimulationRun(d, {
    id: "latency-fault",
    title: "Latency fault",
    seed: 7,
    scale: 1,
    traffic: [{ id: "load", node: "source", shape: { kind: "constant", ratePerSec: 200, durationMs: 10_000 } }],
    timeline: [{ atMs: 2000, action: { do: "fault", fault: { kind: "slow", node: "origin", factor: 2 } } }],
  });
  run.step(1990);
  const before = run.engine.snapshot().nodes.cache.cacheDetails!;
  expect(before.latency!.total!.samples).toBeGreaterThan(0);
  expect(before.sinceFault).toBeUndefined();
  run.step(10);
  const reset = run.engine.snapshot().nodes.cache;
  expect(reset.cacheDetails!.latency).toBeUndefined();
  expect(reset.cacheDetails!.sinceFault).toMatchObject({ atMs: 2000 });
  const render = (s: typeof reset) => renderToStaticMarkup(createElement(CacheDetails, { diagram: d, id: "cache", s }));
  expect(render(reset)).toContain('data-testid="cache-latency">At this cache since fault at \u20682\u2069 s ·');
  run.step(1000);
  const after = run.engine.snapshot().nodes.cache;
  expect(after.cacheDetails!.latency!.total!.samples).toBeGreaterThan(0);
  expect(after.cacheDetails!.latency!.total!.samples).toBeLessThan(before.latency!.total!.samples);
  expect(render(after)).toContain('data-testid="cache-latency">At this cache since fault at \u20682\u2069 s ·');
  expect(after.cache!.requests).toBeGreaterThan(0);
});

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
