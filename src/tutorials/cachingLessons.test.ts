/* eslint-disable local/no-literal-ui-text -- Public test inputs and deliberately incorrect learner edits. */
import "../sim/cache/cacheRuntime";
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import { cachingPractice } from "../lab/cachingPractice";
import { holds, metricBaseline, metricValue, resolveSubjects, type SandboxView } from "./checks";
import { cdnCache } from "./catalog/cdnCache";
import { derivedHitRatio } from "./catalog/derivedHitRatio";
import { cacheLatency } from "./catalog/cacheLatency";
import { cacheStampede } from "./catalog/cacheStampede";
import { staleWhileRevalidate } from "./catalog/staleWhileRevalidate";
import { coldCache } from "./catalog/coldCache";
import { authoredSimulation, matchesSimulation } from "./simulations";
import { patchProps } from "./paths";
import type { Check, MetricValue } from "./types";

export const cachingLessons = [cdnCache, derivedHitRatio, cacheLatency, cacheStampede, staleWhileRevalidate, coldCache];

describe("cache lesson contracts", () => {
  it("uses family selectors with interchangeable vendors and renamed node ids", () => {
    const d = cachingPractice();
    for (const [index, stencil] of ["client.user", "cloudflare", "service.go"].entries()) {
      d.nodes[index] = { ...d.nodes[index], id: `learner-${index}`, stencil };
    }
    for (const lesson of cachingLessons)
      expect(resolveSubjects(lesson, d)).toEqual({ readers: "learner-0", edge: "learner-1", origin: "learner-2" });
  });

  it("accepts a product rule by meaning regardless of its id and rejects another address or method", () => {
    const d = cachingPractice();
    const subjects = resolveSubjects(cdnCache, d);
    const check = cdnCache.steps.find((s) => s.id === "rule")!.check;
    const view: SandboxView = { diagram: d, live: false, processed: () => 0 };
    const props = d.nodes[1].props!;
    const table = props.cache as { rules: { id: string; match: object }[] };
    table.rules[0].id = "my-own-rule";
    expect(holds(check, view, subjects)).toBe(true);
    for (const match of [
      { methods: ["POST"], path: { kind: "template", value: "/products/{id}" } },
      { methods: ["GET"], path: { kind: "exact", value: "/products/example" } },
    ]) {
      table.rules[0].match = match;
      expect(holds(check, view, subjects)).toBe(false);
    }
  });

  it("repairs one rule without deleting the learner's other rule or custom properties", () => {
    const d = cachingPractice(false);
    const props = {
      custom: 17,
      cache: { rules: [{ id: "other", match: { methods: ["HEAD"] }, policy: { noStore: true } }] },
    };
    const demo = cdnCache.steps.find((s) => s.id === "rule")!.demo[0];
    if (demo.kind !== "patch") throw new Error("Expected rule repair");
    const patch = patchProps(props, demo.patches)!;
    d.nodes[1].props = { ...props, ...patch };
    const rules = (patch.cache as { rules: object[] }).rules;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual(props.cache.rules[0]);
    expect(d.nodes[1].props.custom).toBe(17);
    expect(patchProps(d.nodes[1].props, demo.patches)).toBeNull();
    expect(
      holds(cdnCache.steps[1].check, { diagram: d, live: false, processed: () => 0 }, resolveSubjects(cdnCache, d)),
    ).toBe(true);
  });

  it("distinguishes purge mode, target and time and repairs the wrong mode without erasing an extra note", () => {
    const d = cachingPractice();
    const demo = coldCache.steps.find((s) => s.id === "soft-purge")!.demo[0];
    if (demo.kind !== "saveSimulation") throw new Error("Expected authored Drill");
    const resolved = { ...demo, drills: demo.drills!.map((s) => ({ ...s, target: "edge" })) };
    const sim = authoredSimulation(d, undefined, resolved)!;
    const match = {
      drill: "cold-cache" as const,
      fault: { node: "edge", kind: "purge" as const, mode: "soft" as const, atMs: 0, allRules: true as const },
    };
    expect(matchesSimulation(sim, match)).toBe(true);
    const bad = structuredClone(sim);
    const step = bad.timeline![0];
    if (step.action.do !== "fault" || step.action.fault.kind !== "purge") throw new Error("Expected purge");
    step.action.fault.mode = "hard";
    expect(matchesSimulation(bad, match)).toBe(false);
    bad.timeline!.push({ atMs: 100, action: { do: "note", text: "My prediction" } });
    const repaired = authoredSimulation(d, bad, resolved)!;
    expect(matchesSimulation(repaired, match)).toBe(true);
    expect(repaired.timeline).toContainEqual(bad.timeline![1]);
    const narrow = structuredClone(repaired);
    const purge = narrow.timeline![0].action;
    if (purge.do !== "fault" || purge.fault.kind !== "purge") throw new Error("Expected purge");
    purge.fault.rule = "products";
    expect(matchesSimulation(narrow, match)).toBe(false);
    const allRules = authoredSimulation(d, narrow, resolved)!;
    expect(matchesSimulation(allRules, match)).toBe(true);

    for (const fault of [{ node: "wrong" }, { atMs: 500 }])
      expect(matchesSimulation(repaired, { ...match, fault: { ...match.fault, ...fault } })).toBe(false);
    d.nodes[1].id = "my-edge";
    if (repaired.timeline![0].action.do === "fault" && repaired.timeline![0].action.fault.kind === "purge")
      repaired.timeline![0].action.fault.node = "my-edge";
    d.simulations = [repaired];
    expect(
      holds(
        coldCache.steps.find((s) => s.id === "soft-purge")!.check,
        { diagram: d, live: false, processed: () => 0 },
        resolveSubjects(coldCache, d),
      ),
    ).toBe(true);
    d.nodes[1].stencil = "generic.queue";
    expect(
      holds(
        coldCache.steps.find((s) => s.id === "soft-purge")!.check,
        { diagram: d, live: false, processed: () => 0 },
        resolveSubjects(coldCache, d),
      ),
    ).toBe(false);
  });

  it.each([{ noStore: true }, { ttlMs: 100 }, { ttlMs: 999 }])(
    "repairs a matching product rule with policy %j",
    (policy) => {
      const d = cachingPractice();
      const props = d.nodes[1].props!;
      const table = props.cache as { rules: { id: string; policy: object }[] };
      table.rules[0].policy = {
        ...policy,
        keys: 17,
        popularity: "steep",
        coalesce: true,
        staleWhileRevalidateMs: 10000,
      };
      table.rules[0].id = "my-rule";
      const demo = cdnCache.steps[1].demo[0];
      if (demo.kind !== "patch") throw new Error("Expected patch");
      d.nodes[1].props = { ...props, ...patchProps(props, demo.patches) };
      expect((d.nodes[1].props.cache as { rules: object[] }).rules).toHaveLength(1);
      expect((d.nodes[1].props.cache as { rules: { policy: object }[] }).rules[0].policy).toMatchObject({
        keys: 17,
        popularity: "steep",
        coalesce: true,
        staleWhileRevalidateMs: 10000,
      });
      expect(
        holds(cdnCache.steps[1].check, { diagram: d, live: false, processed: () => 0 }, resolveSubjects(cdnCache, d)),
      ).toBe(true);
    },
  );

  it("does not duplicate a learner rule id when adding the missing product match", () => {
    const props = { cache: { rules: [{ id: "products", match: { methods: ["POST"] }, policy: { noStore: true } }] } };
    const demo = cdnCache.steps[1].demo[0];
    if (demo.kind !== "patch") throw new Error("Expected patch");
    const patch = patchProps(props, demo.patches)!;
    expect((patch.cache as { rules: { id: string }[] }).rules.map((r) => r.id)).toEqual(["products", "products-2"]);
  });
});

describe("tutorial cache metrics", () => {
  it("reads percentages and one-item fetch counts, failing closed before a cache observation exists", () => {
    const d = cachingPractice();
    const c = new LiveController(d);
    try {
      const base = c.getState();
      const cache = {
        ...base.snapshot.nodes.edge.cache!,
        hits: 60,
        misses: 40,
        coalesced: 0,
        requests: 120,
        fetches: 30,
        hitRatio: 0.6,
        originOffload: 0.75,
      };
      const view: SandboxView = {
        diagram: d,
        live: true,
        processed: () => 0,
        session: {
          ...base,
          snapshot: {
            ...base.snapshot,
            nodes: {
              ...base.snapshot.nodes,
              edge: { ...base.snapshot.nodes.edge, cache, cacheDetails: { itemFetches: 9 } },
            },
          },
        },
      };
      const read = (metric: "cache.hitRatio" | "cache.offload" | "cache.itemFetches") =>
        metricValue({ node: "edge", metric }, view, { edge: "edge" });
      expect(read("cache.hitRatio")).toBe(60);
      expect(read("cache.offload")).toBe(75);
      expect(read("cache.itemFetches")).toBe(9);
      view.live = false;
      expect(read("cache.hitRatio")).toBeUndefined();
      view.live = true;
      view.trafficReady = false;
      expect(read("cache.offload")).toBeUndefined();
    } finally {
      c.dispose();
    }
  });

  it("calculates fresh ratios from counts, rejects no traffic and resets their baselines on a new generation", () => {
    const d = cachingPractice();
    const c = new LiveController(d);
    try {
      const base = c.getState();
      const view: SandboxView = {
        diagram: d,
        live: true,
        sessionId: 1,
        processed: () => 0,
        session: structuredClone(base),
      };
      const n = view.session!.snapshot.nodes.edge;
      n.cache = {
        ...n.cache!,
        hits: 900,
        misses: 100,
        coalesced: 0,
        hitRatio: 0.9,
        requests: 1000,
        fetches: 100,
        originOffload: 0.9,
      };
      const subjects = { edge: "edge" };
      const expr: MetricValue = { node: "edge", metric: "cache.hitRatio" };
      view.baseline = Object.fromEntries(
        Object.entries(metricBaseline(expr, view, subjects)).map(([k, v]) => [k, [v, base.generation, 1] as const]),
      );
      const check: Check = { kind: "compare", left: { sinceStep: expr }, op: ">=", right: 50 };
      expect(holds(check, view, subjects)).toBe(false);
      n.cache.hits += 4;
      n.cache.misses += 6;
      expect(holds(check, view, subjects)).toBe(false); // Old 90% cannot hide the new 40%.
      n.cache.hits += 6;
      expect(holds(check, view, subjects)).toBe(true); // 10 / 16, not a percentage-point delta.
      view.session!.generation++;
      n.cache.hits = 1;
      n.cache.misses = 9;
      expect(holds(check, view, subjects)).toBe(false);
      n.cache.hits = 9;
      n.cache.misses = 1;
      expect(holds(check, view, subjects)).toBe(true);
    } finally {
      c.dispose();
    }
  });
});
