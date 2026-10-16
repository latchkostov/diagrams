import { describe, expect, it } from "vitest";
import { createEngine } from "./engine";
import { analyzeCapacity } from "./capacity";
import type { DiagramFile } from "../model/types";
import type { RouteTable } from "../model/requestRouting";
import { routingFixture } from "../lab/routingFixture";
import { chooseAction, compileRoutes, compileTable, routingCounters } from "./routeMatching";
import { growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";
import { createRoutingValidator, routingValidations, validateRouting } from "../model/routingValidation";

/** A table of `rules` exact-path rules that never match "/search", then a prefix rule that does. */
function longTable(rules: number): RouteTable {
  return {
    rules: [
      ...Array.from({ length: rules - 1 }, (_, i) => ({
        id: `miss-${i}`,
        match: { path: { kind: "exact" as const, value: `/miss/${i}` } },
        targets: [{ edgeId: "kong-orders", weight: 1 }],
      })),
      {
        id: "hit",
        match: { path: { kind: "prefix" as const, value: "/search" } },
        targets: [{ edgeId: "kong-search", weight: 1 }],
      },
    ],
  };
}
const searchOnly = { mode: "shares" as const, entries: [{ routeId: "search-get", share: 1 }] };

function playMessages(rules: number, messages: number): number {
  const d = routingFixture({ table: longTable(rules), mix: searchOnly });
  const e = createEngine({ seed: 1 });
  e.load(d);
  const before = routingCounters.predicates;
  e.inject("app", messages);
  e.step(500);
  expect(e.snapshot().edges["kong-search"].delivered).toBe(messages);
  return routingCounters.predicates - before;
}

describe("request routing bounds", () => {
  it("compiles each table once per configuration change, never per tick, frame or message", () => {
    const e = createEngine({ seed: 1 });
    const before = routingCounters.compiles;
    e.load(routingFixture());
    expect(routingCounters.compiles - before).toBe(1);
    e.setTraffic(true);
    for (let i = 0; i < 100; i++) {
      e.step(100);
      e.frame();
    }
    e.setNodeProps("kong", { latencyMs: 7 });
    expect(routingCounters.compiles - before).toBe(1);
    e.setNodeProps("kong", { routeTable: longTable(4) });
    expect(routingCounters.compiles - before).toBe(2);
  });

  it("evaluates at most one predicate per rule for each request", () => {
    // 64 requests through 32 rules: the 32nd matches, so exactly 32 predicates each.
    expect(playMessages(32, 64)).toBe(32 * 64);
  });

  it("grows linearly in rules at a fixed message count, and in messages at a fixed rule count", () => {
    const routes = compileRoutes(routingFixture().planning)!;
    const route = routes.get("search-get")!;
    const small = compileTable(longTable(32))!,
      large = compileTable(longTable(32 * GROWTH_FACTOR))!;
    const decide = (table: typeof small, m: number) => () => {
      for (let i = 0; i < m; i++) chooseAction(table, route, true);
    };
    expect(growth(decide(small, 200), decide(large, 200))).toBeLessThan(LINEAR_LIMIT);
    expect(growth(decide(small, 200), decide(small, 200 * GROWTH_FACTOR))).toBeLessThan(LINEAR_LIMIT);
  });

  it("compiles and validates configuration linearly in its size", () => {
    const sized = (rules: number): DiagramFile => routingFixture({ table: longTable(rules) });
    const small = sized(30),
      large = sized(30 * GROWTH_FACTOR);
    expect(
      growth(
        () => compileTable(small.nodes[1].props!.routeTable),
        () => compileTable(large.nodes[1].props!.routeTable),
      ),
    ).toBeLessThan(LINEAR_LIMIT);
    expect(
      growth(
        () => validateRouting(small),
        () => validateRouting(large),
      ),
    ).toBeLessThan(LINEAR_LIMIT);
  });

  it("analysis compiles once and decides in linear work", () => {
    const before = routingCounters.compiles;
    analyzeCapacity(routingFixture());
    expect(routingCounters.compiles - before).toBe(1);
  });

  it("the editor's validator does no schema work for edits routing doesn't read", () => {
    const validate = createRoutingValidator();
    const d = routingFixture();
    for (let i = 0; i < 300; i++)
      d.nodes.push({ id: `n${i}`, stencil: "generic.service", label: `S${i}`, x: i, y: 0, props: { latencyMs: 1 } });
    expect(validate(d)).toBeUndefined();
    const before = routingValidations.count;
    for (let i = 0; i < 20; i++) {
      // A rename and a move of an unrelated node: new node objects, same routing inputs.
      d.nodes = d.nodes.map((n) => (n.id === "n7" ? { ...n, label: `Renamed ${i}`, x: i } : n));
      expect(validate(d)).toBeUndefined();
    }
    expect(routingValidations.count - before).toBe(0);
    // Deleting a table's target is caught at once.
    d.edges = d.edges.filter((e) => e.id !== "kong-search");
    expect(validate(d)).toContain("kong-search");
  });
});
