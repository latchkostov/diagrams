import { expect, it } from "vitest";
import { checkpointBytes } from "./engine/checkpoint";

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
