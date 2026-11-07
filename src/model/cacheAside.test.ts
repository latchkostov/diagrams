import { expect, it } from "vitest";
import { cacheAsideFixture } from "../lab/cacheAsideFixture";
import { cacheAsideProblem, cacheLookupChoices } from "./cacheAside";
import { validateDiagram } from "../interop/native";
import { createRoutingValidator } from "./routingValidation";
import { makePayload, remapPayload, parsePayload } from "../editor/clipboard";
import { describeDiagram } from "../ai/describe";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

it("lookup choices keep connection order and current labels independently of node order", () => {
  const d = cacheAsideFixture();
  d.nodes.push({ ...d.nodes[2], id: "second-cache", label: "Second cache" });
  d.edges.push({ id: "second-lookup", from: "service", to: "second-cache", kind: "sync" });
  const expected = [
    { id: "lookup", label: "Product cache" },
    { id: "second-lookup", label: "Second cache" },
  ];
  expect(cacheLookupChoices(d, "fetch")).toEqual(expected);
  d.nodes.reverse();
  expect(cacheLookupChoices(d, "fetch")).toEqual(expected);
  d.nodes.find((node) => node.id === "cache")!.label = "";
  expect(cacheLookupChoices(d, "fetch")).toEqual([{ id: "lookup", label: "cache" }, expected[1]]);
});

it("lookup choices inspect nodes linearly as unrelated connections grow", () => {
  const measure = (size: number) => {
    const d = cacheAsideFixture();
    const cache = d.nodes.splice(2, 1)[0];
    const others = Array.from({ length: size - 4 }, (_, i) => ({
      id: `other-${i}`,
      stencil: "generic.service",
      label: `Other ${i}`,
      x: i * 10,
      y: 500,
    }));
    d.nodes.push(...others, cache);
    for (const node of [d.nodes[0], ...others])
      d.edges.push({ id: `lookup-${node.id}`, from: node.id, to: cache.id, kind: "sync" });
    const tracked = countingReads(d.nodes);
    d.nodes = tracked.items;
    return { choices: cacheLookupChoices(d, "fetch"), reads: tracked.reads() };
  };
  const small = measure(8),
    large = measure(8 * GROWTH_FACTOR);
  expect(small.choices).toEqual([{ id: "lookup", label: "Product cache" }]);
  expect(large.choices).toEqual(small.choices);
  expect(large.reads / small.reads).toBeLessThanOrEqual(LINEAR_LIMIT);
});

it("accepts a native condition and refuses missing, foreign, cyclic or non-Request lookups", () => {
  expect(validateDiagram(cacheAsideFixture()).ok).toBe(true);
  for (const kind of ["missing", "foreign", "cycle", "async", "dependency", "not-cache"] as const) {
    const d = cacheAsideFixture();
    if (kind === "missing") d.edges[2].props!.caller = { onMiss: "missing" };
    if (kind === "foreign") d.edges[1].from = "source";
    if (kind === "cycle") d.edges[1].props!.caller = { onMiss: "fetch" };
    if (kind === "async") d.edges[1].kind = "async";
    if (kind === "dependency") d.edges[1].relation = "config";
    if (kind === "not-cache") d.nodes[2].stencil = "generic.database";
    expect(cacheAsideProblem(d), kind).toContain("onMiss");
    expect(validateDiagram(d).ok, kind).toBe(false);
  }
});

it("agent descriptions identify the database as the cache-aside origin", () => {
  const described = JSON.parse(describeDiagram(cacheAsideFixture(), { format: "json" }));
  expect(described.nodes.find((n: { id: string }) => n.id === "cache").cache.origin).toEqual(["fetch"]);
});

it("revalidates edits to a referenced connection or stencil", () => {
  const d = cacheAsideFixture();
  const check = createRoutingValidator();
  expect(check(d)).toBeUndefined();
  expect(check({ ...d, edges: d.edges.map((e) => (e.id === "lookup" ? { ...e, kind: "async" } : e)) })).toContain(
    "onMiss",
  );
  expect(
    check({ ...d, nodes: d.nodes.map((n) => (n.id === "cache" ? { ...n, stencil: "generic.database" } : n)) }),
  ).toContain("onMiss");
});

it("remaps copied lookup identities and removes only a missing cache condition", () => {
  const d = cacheAsideFixture();
  const taken = {
    nodes: new Set(d.nodes.map((n) => n.id)),
    edges: new Set(d.edges.map((e) => e.id)),
    groups: new Set<string>(),
  };
  const complete = remapPayload(
    parsePayload(JSON.stringify(makePayload(d, ["service", "cache", "database"])))!,
    taken,
    { x: 10, y: 0 },
  );
  expect(complete.edges[1].props!.caller).toMatchObject({ onMiss: complete.edges[0].id });
  expect(complete.droppedCacheConditions).toBeUndefined();
  const partial = remapPayload(parsePayload(JSON.stringify(makePayload(d, ["service", "database"])))!, taken, {
    x: 10,
    y: 0,
  });
  expect(partial.edges[0].props!.caller).toEqual({ wait: "blocking" });
  expect(partial.droppedCacheConditions).toBe(true);
  expect(d.edges[2].props!.caller).toMatchObject({ onMiss: "lookup" });
});
