/* eslint-disable local/no-literal-ui-text -- Public test inputs and deliberately incorrect learner edits. */
import "../sim/cache/cacheRuntime";
import { describe, expect, it } from "vitest";
import { LiveController } from "../live/controller";
import { cachingPractice } from "../lab/cachingPractice";
import stampede from "../examples/cache-stampede.json";
import { checkCache, type CacheTable } from "../model/caching";
import type { DiagramFile } from "../model/types";
import { holds, metricBaseline, metricValue, resolveSubjects, type SandboxView } from "./checks";
import { cdnCache } from "./catalog/cdnCache";
import { derivedHitRatio } from "./catalog/derivedHitRatio";
import { cacheLatency } from "./catalog/cacheLatency";
import { cacheStampede } from "./catalog/cacheStampede";
import { staleWhileRevalidate } from "./catalog/staleWhileRevalidate";
import { coldCache } from "./catalog/coldCache";
import { authoredSimulation, matchesSimulation } from "./simulations";
import { repairedRun } from "./repair";
import { patchProps } from "./paths";
import type { Check, MetricValue, Tutorial } from "./types";
import { createMachine } from "../lib/machine";
import { runnerInitial, runnerMachine } from "./machine";
import { buildBlueprint } from "./blueprint";

export const cachingLessons = [cdnCache, derivedHitRatio, cacheLatency, cacheStampede, staleWhileRevalidate, coldCache];

it("points the cache learner to the actual Drill authoring path and gallery comparisons", () => {
  const text = cdnCache.finish.guidance!();
  expect(text).toContain("New simulation → Timeline → Add step → Cold cache");
  expect(text).toContain("Examples → search “cache” → Cache stampede or Black Friday commerce");
  expect(cdnCache.finish.text()).not.toContain("New simulation");
});

function start(lesson: Tutorial): DiagramFile {
  if (typeof lesson.start !== "function") throw new Error("Expected a local exercise");
  return lesson.start();
}

describe("cache lesson contracts", () => {
  it.each([
    [cdnCache, "rule"],
    [derivedHitRatio, "longer-ttl"],
    [cacheLatency, "dont-store"],
    [cacheStampede, "one-fetch"],
    [staleWhileRevalidate, "stale-window"],
    [coldCache, "soft-result"],
  ] as const)("%s repairs the first widened serving rule in place at %s", (lesson, stepId) => {
    const d = lesson === cacheStampede ? (structuredClone(stampede) as DiagramFile) : start(lesson);
    const edge = d.nodes[1];
    const table = (edge.props!.cache ??= { rules: [] }) as CacheTable;
    table.rules.unshift({
      id: "learner",
      label: "Keep my match",
      match: { methods: ["GET"] },
      policy: { noStore: true },
    });
    const siblings = table.rules.slice(1);
    const step = lesson.steps.find((s) => s.id === stepId)!;
    const patches = step.demo.flatMap((demo) => (demo.kind === "patch" ? demo.patches : []));
    const sim = d.simulations![0];
    sim.setup = { props: { [edge.id]: { cache: structuredClone(table), custom: 23 } } };
    edge.props = { ...edge.props, ...patchProps(edge.props, patches) };
    const run = repairedRun(d, sim, { node: edge.id }, patches);
    for (const props of [edge.props, run.setup!.props![edge.id]]) {
      const repaired = props.cache as CacheTable;
      expect(repaired.rules).toHaveLength(siblings.length + 1);
      expect(repaired.rules[0]).toMatchObject({ id: "learner", label: "Keep my match", match: { methods: ["GET"] } });
      expect(repaired.rules.slice(1)).toEqual(siblings);
      expect(repaired.rules[0].policy.noStore).toBe(lesson === cacheLatency ? true : undefined);
      expect(() => checkCache(repaired)).not.toThrow();
      expect(patchProps(props, patches)).toBeNull();
    }
    if (lesson !== coldCache) {
      const c = new LiveController(d);
      try {
        c.selectSimulation(run);
        c.setInputs({ ...c.getState().inputs, traffic: 0.2 });
        c.publish();
        expect(
          holds(
            step.check,
            { diagram: d, live: true, session: c.getState(), processed: () => 0 },
            resolveSubjects(lesson, d),
          ),
        ).toBe(true);
      } finally {
        c.dispose();
      }
    }
    expect(run.setup!.props![edge.id].custom).toBe(23);
  });

  it("Any path then assistance completes the actual refresh check", () => {
    const d = start(staleWhileRevalidate);
    const edge = d.nodes[1];
    const table = edge.props!.cache as CacheTable;
    delete table.rules[0].match.path;
    const window = staleWhileRevalidate.steps.find((s) => s.id === "stale-window")!;
    const patches = window.demo.flatMap((demo) => (demo.kind === "patch" ? demo.patches : []));
    edge.props = { ...edge.props, ...patchProps(edge.props, patches) };
    const c = new LiveController(d);
    try {
      c.selectSimulation(repairedRun(d, d.simulations![0], { node: edge.id }, patches));
      const generation = c.getState().generation;
      c.restart();
      c.step(10000);
      c.publish();
      expect(
        holds(
          staleWhileRevalidate.steps.find((s) => s.id === "refresh")!.check,
          {
            diagram: d,
            live: true,
            sessionId: 1,
            session: c.getState(),
            processed: (id) => c.getState().snapshot.nodes[id]?.processed ?? 0,
            baseline: { newRun: [0, generation, 1] },
          },
          resolveSubjects(staleWhileRevalidate, d),
        ),
      ).toBe(true);
      expect((edge.props.cache as CacheTable).rules).toHaveLength(1);
    } finally {
      c.dispose();
    }
  });

  it.each([derivedHitRatio, staleWhileRevalidate, cacheLatency])(
    "%s checks the serving rule rather than a correct shadowed rule",
    (lesson) => {
      const d = start(lesson);
      const table = d.nodes[1].props!.cache as CacheTable;
      table.rules[0].policy =
        lesson === cacheLatency ? { noStore: true } : { ttlMs: 60000, staleWhileRevalidateMs: 10000 };
      table.rules.unshift({
        id: "first",
        match: { methods: ["GET"] },
        policy: lesson === cacheLatency ? { ttlMs: 1000 } : { noStore: true },
      });
      const c = new LiveController(d);
      try {
        const stepId =
          lesson === derivedHitRatio ? "longer-ttl" : lesson === cacheLatency ? "dont-store" : "stale-window";
        const session = structuredClone(c.getState());
        session.inputs.traffic = 0.2;
        expect(
          holds(
            lesson.steps.find((s) => s.id === stepId)!.check,
            { diagram: d, live: true, session, processed: () => 0 },
            resolveSubjects(lesson, d),
          ),
        ).toBe(false);
      } finally {
        c.dispose();
      }
    },
  );

  const repairs = [
    [derivedHitRatio, "longer-ttl"],
    [staleWhileRevalidate, "stale-window"],
    [cacheLatency, "dont-store"],
  ] as const;

  it.each(repairs)(
    "%s repairs disabled, replacement and missing product rules in the diagram and saved override",
    (lesson, stepId) => {
      for (const edit of ["disabled", "replacement", "missing", "widened"] as const) {
        const d = start(lesson);
        const table = d.nodes[1].props!.cache as CacheTable;
        table.rules[0].id = "cache-1";
        if (edit === "disabled") table.rules[0].policy = { noStore: true };
        if (edit === "missing") table.rules = [];
        if (edit === "widened") table.rules[0].match = { methods: ["GET"] };
        const sibling = { id: "products", match: { methods: ["HEAD" as const] }, policy: { noStore: true as const } };
        table.rules.push(sibling);
        d.nodes[1].props!.custom = 17;
        const sim = d.simulations![0];
        sim.setup = { props: { edge: { cache: structuredClone(table), custom: 23 } } };
        const step = lesson.steps.find((s) => s.id === stepId)!;
        const patches = step.demo.flatMap((demo) => (demo.kind === "patch" ? demo.patches : []));
        d.nodes[1].props = { ...d.nodes[1].props, ...patchProps(d.nodes[1].props, patches) };
        const run = repairedRun(d, sim, { node: "edge" }, patches);
        for (const props of [d.nodes[1].props, run.setup!.props!.edge]) {
          const repaired = props.cache as CacheTable;
          expect(() => checkCache(repaired)).not.toThrow();
          expect(repaired.rules).toHaveLength(2);
          expect(repaired.rules).toContainEqual(sibling);
          expect(patchProps(props, patches)).toBeNull();
        }
        expect(d.nodes[1].props.custom).toBe(17);
        expect(run.setup!.props!.edge.custom).toBe(23);
        const c = new LiveController(d);
        try {
          expect(c.selectSimulation(run)).toBe("selected");
          c.setInputs({ ...c.getState().inputs, traffic: 0.2 });
          c.publish();
          expect(
            holds(
              step.check,
              { diagram: d, live: true, session: c.getState(), processed: () => 0 },
              resolveSubjects(lesson, d),
            ),
            edit,
          ).toBe(true);
        } finally {
          c.dispose();
        }
      }
    },
  );

  it.each([
    [derivedHitRatio, "longer-ttl", { noStore: true, ttlMs: 60000 }],
    [staleWhileRevalidate, "stale-window", { noStore: true, staleWhileRevalidateMs: 10000 }],
  ] as const)("%s rejects disabled caching even when the requested field is present", (lesson, stepId, policy) => {
    const d = start(lesson);
    const c = new LiveController(d);
    try {
      const session = structuredClone(c.getState());
      session.inputs.traffic = 0.2;
      (session.configuration.edge.cache as CacheTable).rules[0].policy = { ...policy };
      const step = lesson.steps.find((s) => s.id === stepId)!;
      expect(
        holds(step.check, { diagram: d, live: true, session, processed: () => 0 }, resolveSubjects(lesson, d)),
      ).toBe(false);
    } finally {
      c.dispose();
    }
  });

  it.each(["disabled", "replacement", "missing"] as const)(
    "stampede and purge assistance recover %s rules without erasing other edits",
    (edit) => {
      for (const [lesson, stepId, d] of [
        [cacheStampede, "one-fetch", structuredClone(stampede) as DiagramFile],
        [cacheStampede, "replay", structuredClone(stampede) as DiagramFile],
        [coldCache, "soft-result", start(coldCache)],
      ] as const) {
        const edge = d.nodes[1];
        const table = edge.props!.cache as CacheTable;
        const count = table.rules.length;
        for (const rule of table.rules) {
          rule.id = `my-${rule.id}`;
          if (edit === "disabled") rule.policy = { noStore: true };
        }
        if (edit === "missing") table.rules = [];
        edge.props!.custom = 17;
        const sim = d.simulations![0];
        sim.setup = { props: { [edge.id]: { cache: structuredClone(table), custom: 23 } } };
        const patches = lesson.steps
          .find((s) => s.id === stepId)!
          .demo.flatMap((demo) => (demo.kind === "patch" ? demo.patches : []));
        edge.props = { ...edge.props, ...patchProps(edge.props, patches) };
        const run = repairedRun(d, sim, { node: edge.id }, patches);
        for (const props of [edge.props, run.setup!.props![edge.id]]) {
          const repaired = props.cache as CacheTable;
          expect(() => checkCache(repaired)).not.toThrow();
          expect(repaired.rules).toHaveLength(count);
          for (const rule of repaired.rules) expect(rule.policy.noStore).toBeUndefined();
          const launch = repaired.rules.find((r) => r.match.path?.value === "/launch")!;
          expect(launch.policy).toMatchObject({ ttlMs: 5000, keys: 1, coalesce: true });
          expect(launch.policy.noStore).toBeUndefined();
          if (lesson === coldCache)
            for (const rule of repaired.rules) {
              expect(rule.policy.noStore).toBeUndefined();
              expect(rule.policy.staleWhileRevalidateMs).toBe(30000);
            }
          expect(patchProps(props, patches)).toBeNull();
        }
        expect(edge.props.custom).toBe(17);
        expect(run.setup!.props![edge.id].custom).toBe(23);
      }
    },
  );

  it.each([
    [cacheLatency, "restart-uncached", { noStore: true }],
    [staleWhileRevalidate, "refresh", { ttlMs: 1000, keys: 1, coalesce: true, staleWhileRevalidateMs: 10000 }],
  ] as const)("%s repairs a changed policy again before %s", (lesson, stepId, expected) => {
    const d = start(lesson);
    const table = d.nodes[1].props!.cache as CacheTable;
    table.rules[0].id = "cache-1";
    if (lesson === staleWhileRevalidate) table.rules[0].policy = { noStore: true };
    const sim = d.simulations![0];
    sim.setup = { props: { edge: { cache: structuredClone(table), custom: 23 } } };
    const patches = lesson.steps
      .find((s) => s.id === stepId)!
      .demo.flatMap((demo) => (demo.kind === "patch" ? demo.patches : []));
    d.nodes[1].props = { ...d.nodes[1].props, ...patchProps(d.nodes[1].props, patches) };
    const run = repairedRun(d, sim, { node: "edge" }, patches);
    for (const props of [d.nodes[1].props, run.setup!.props!.edge]) {
      const repaired = props.cache as CacheTable;
      expect(() => checkCache(repaired)).not.toThrow();
      expect(repaired.rules).toHaveLength(1);
      expect(repaired.rules[0].id).toBe("cache-1");
      expect(repaired.rules[0].policy).toEqual(expected);
      expect(patchProps(props, patches)).toBeNull();
    }
    expect(run.setup!.props!.edge.custom).toBe(23);
  });

  it("previews one stale-window edit and describes a matched rule in plain route terms", () => {
    const board = buildBlueprint(staleWhileRevalidate, start(staleWhileRevalidate));
    expect(board.changes.filter((change) => change.step === 3)).toEqual([
      expect.objectContaining({ detail: "GET /products/{id}", before: undefined, after: 10000 }),
    ]);
    const intro = buildBlueprint(cdnCache, cachingPractice(false));
    expect(intro.changes.some((change) => change.detail === "GET /products/{id}")).toBe(true);
    expect(JSON.stringify(intro)).not.toContain("[object Object]");
  });
  it("does not bank a soft-purge near miss before the hard-purge comparison", () => {
    const machine = createMachine({
      ...runnerMachine,
      initial: runnerInitial(
        coldCache.steps.map((step) => !!step.sticky || !step.demo.length),
        {
          highlights: true,
          resumeAt: 0,
          stepIds: coldCache.steps.map((step) => step.id),
        },
      ),
    });
    machine.send({ type: "observe", met: [false, false, false, true, false], settled: [true, true, true, true, true] });
    machine.send({ type: "start" });
    machine.send({ type: "observe", met: [true, true, true, false, false], settled: [true, true, true, true, true] });
    expect(machine.state.stepIds[machine.state.index]).toBe("soft-purge");
    expect(machine.state.latched[3]).toBe(false);
  });
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
      { methods: ["GET"], path: { kind: "exact", value: "/products/example" } },
      { methods: ["GET"], path: { kind: "prefix", value: "/products/" } },
      { methods: ["GET"], types: ["Product*"] },
    ]) {
      table.rules[0].match = match;
      expect(holds(check, view, subjects)).toBe(true);
    }
    for (const match of [
      { methods: ["POST"], path: { kind: "template", value: "/products/{id}" } },
      { methods: ["GET"], path: { kind: "exact", value: "/products/another-item" } },
      { methods: ["GET"], types: ["Another reader"] },
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
    expect(rules[1]).toBe(props.cache.rules[0]);
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
    expect((patch.cache as { rules: { id: string }[] }).rules.map((r) => r.id)).toEqual(["products-2", "products"]);
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
