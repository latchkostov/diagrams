import { watchCheckpoints } from "../test/checkpointProbe";
import fc from "fast-check";
import { expect, it } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { propertyRuns } from "../test/fastCheck";
import { createEngine, randomDraws } from "./engine";
import { cacheRuntime } from "./cache/cacheRuntime";
import { arbCacheDiagram } from "../test/cacheScenarios";
import { assertCacheInvariants } from "./cacheInvariants";
import { recoveryWorkMs } from "../test/resilienceRecovery";

it("C1/C2/C5/C7/C8: random cache runs conserve, drain and replay independently of global draws", () => {
  fc.assert(
    fc.property(
      fc.record({
        seed: fc.integer(),
        keys: fc.integer({ min: 1, max: 2000 }),
        ttlMs: fc.integer({ min: 100, max: 10_000 }),
        scale: fc.constantFrom(1, 2, 10),
        noStore: fc.boolean(),
        store: fc.boolean(),
        failureRate: fc.constantFrom(0, 0.25, 1),
      }),
      (p) => {
        const d = cacheFixture();
        d.nodes[1].stencil = p.store ? "generic.cache" : "generic.cdn";
        d.nodes[1].props!.cache = {
          rules: [],
          default: p.noStore ? { noStore: true } : { keys: p.keys, ttlMs: p.ttlMs },
        };
        d.nodes[2].props!.failureRate = p.failureRate;
        d.nodes[2].stencil = "generic.service";
        d.nodes[2].props!.concurrency = 100;
        const e = createEngine({ seed: p.seed, maxParticles: 0 });
        e.load(d);
        e.setScale(p.scale);
        e.setTraffic(true);
        e.step(2000);
        const token = e.checkpoint();
        const suffix = () => {
          e.step(2000);
          return { state: e.snapshot(), draws: randomDraws(e) };
        };
        const a = suffix();
        e.restore(token);
        expect(suffix()).toEqual(a);
        const c = a.state.nodes.cache.cache!;
        expect(c.requests).toBe(c.hits + c.misses + c.notCached);
        expect(c.fetches).toBe(c.misses + c.notCached);
        if (p.noStore || p.failureRate === 1) expect(c.fills).toBe(0);
        if (p.noStore) expect(c.hits).toBe(0);
        e.setTraffic(false);
        e.step(5000);
        expect(e.snapshot().inSystem).toBe(0);
      },
    ),
    { numRuns: propertyRuns(50) },
  );
});

it("C4: random tracked lookups never hit an expired item", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 100, max: 86_400_000 }),
      fc.integer({ min: 0, max: 100_000 }),
      fc.integer(),
      (ttlMs, at, seed) => {
        const c = cacheRuntime.compile({ rules: [], default: { ttlMs, keys: 1 } }, "edge", seed, 1, { value: 4096 });
        const lookup = cacheRuntime.lookup(c, "Page", undefined, true, at, 1);
        cacheRuntime.start(c, lookup, 1);
        cacheRuntime.settle(c, lookup, at + 50, 1, true);
        const expiry = at + 50 + ttlMs;
        expect(cacheRuntime.lookup(c, "Page", undefined, true, expiry - 1, 1).outcome).toBe("hit");
        expect(cacheRuntime.lookup(c, "Page", undefined, true, expiry, 1).outcome).toBe("miss");
      },
    ),
    { numRuns: propertyRuns(100) },
  );
});

it("C1/C2/C5/C7/C8: inherited resilience scenarios preserve cache ownership through faults and replay", () => {
  fc.assert(
    fc.property(arbCacheDiagram, fc.integer(), ({ diagram, scale }, seed) => {
      const watch = watchCheckpoints();
      try {
        const e = createEngine({ seed, scale, maxParticles: 0 });
        e.load(diagram);
        e.inject("source", 12, { spreadMs: 400 });
        const token = e.checkpoint();
        const suffix = () => {
          for (let tick = 0; tick < 100; tick++) {
            if (tick === 10) e.setFault({ kind: "slow", node: "tier0", factor: 2 });
            if (tick === 30) e.setFault({ kind: "slow", node: "tier0", factor: 1 });
            e.step(50);
            for (const node of watch.sources[0][0].values())
              if (node.cache) assertCacheInvariants(node.cache, !e.snapshot().inSystem);
          }
          return e.snapshot();
        };
        const expected = suffix();
        e.restore(token);
        expect(suffix()).toEqual(expected);
        for (const node of diagram.nodes) if (node.id.startsWith("tier")) e.setNodeProps(node.id, { failureRate: 0 });
        const steps = Math.ceil(recoveryWorkMs(diagram, scale, 12) / 1000);
        for (let tick = 0; tick < steps && e.metrics().inSystem; tick++) e.step(1000);
        expect(e.snapshot().inSystem).toBe(0);
        for (const node of watch.sources[0][0].values()) if (node.cache) assertCacheInvariants(node.cache, true);
      } finally {
        watch.stop();
      }
    }),
    { numRuns: propertyRuns(20) },
  );
});
