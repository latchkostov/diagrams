import { expect, it, vi } from "vitest";
import { checkpointBytes } from "./engine/checkpoint";
import { createEngine } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { cacheFixture } from "../lab/cacheFixture";

it("sizes cycles and aliases once and includes Map/Set payloads", () => {
  const item = { text: "x".repeat(1000) };
  const graph = { item, map: new Map([[item, item]]), set: new Set([item]), self: {} };
  graph.self = graph;
  const before = checkpointBytes(graph);
  expect(before).toBeGreaterThan(1000);
  expect(checkpointBytes({ item, alias: item })).toBe(checkpointBytes({ item }) + 8);
  item.text += "y".repeat(2000);
  expect(checkpointBytes(graph) - before).toBe(4000);
  expect(checkpointBytes(new Map([["key", { text: "x".repeat(1000) }]]))).toBeGreaterThan(1000);
  expect(checkpointBytes(new Set(["x".repeat(1000)]))).toBeGreaterThan(1000);
});

it("charges two bytes per UTF-16 code unit, including Unicode configuration", () => {
  const source = { text: "order ✈ 東京" };
  expect(checkpointBytes(source)).toBe(56 + source.text.length * 2);
});

it("bounds the W3 checkpoint increment at the 4096 tracked-item limit", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = {
    rules: Array.from({ length: 16 }, (_, id) => ({
      id: String(id),
      match: { types: [`Page${id}`] },
      policy: { ttlMs: 1000, keys: 1000 + id },
    })),
  };
  const e = createEngine({ seed: 7 });
  e.load(d);
  const withCache = e.checkpoint().bytes;
  delete d.nodes[1].props!.cache;
  e.load(d);
  expect(withCache - e.checkpoint().bytes).toBeLessThanOrEqual(130 * 1024);
});

it("bounds checkpoints at maximum cache rules and tracked items", () => {
  const d = cacheFixture();
  for (let i = 1; i < 8; i++) {
    d.nodes.push({ ...structuredClone(d.nodes[1]), id: `cache${i}` });
    d.edges.push({ ...structuredClone(d.edges[1]), id: `fetch${i}`, from: `cache${i}` });
  }
  for (const node of d.nodes.filter((n) => n.stencil === "generic.cdn"))
    node.props!.cache = {
      rules: Array.from({ length: 32 }, (_, i) => ({
        id: `r${i}`,
        match: { types: [`Page${i}`] },
        policy: { ttlMs: 1000, keys: 1000 },
      })),
    };
  const compile = vi.spyOn(cacheRuntime, "compile");
  const e = createEngine({ seed: 7 });
  try {
    e.load(d);
    expect(compile.mock.results.flatMap((r) => r.value.rules).length).toBe(256);
    expect(compile.mock.results.flatMap((r) => r.value.rules).reduce((sum, r) => sum + r.tracked, 0)).toBe(4096);
    const bytes = e.checkpoint().bytes;
    for (const node of d.nodes) delete node.props?.cache;
    e.load(d);
    expect(bytes - e.checkpoint().bytes).toBeLessThanOrEqual(130 * 1024);
  } finally {
    compile.mockRestore();
  }
});

it("restores untouched shared cache state before its first write", () => {
  const e = createEngine({ seed: 7 });
  e.load(cacheFixture());
  const token = e.checkpoint();
  const play = () => {
    e.setTraffic(true);
    e.step(2000);
    return e.snapshot();
  };
  const expected = play();
  e.restore(token);
  expect(play()).toEqual(expected);
});
