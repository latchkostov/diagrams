import fc from "fast-check";
import { expect, it } from "vitest";
import { cacheAsideFixture } from "../lab/cacheAsideFixture";
import { propertyRuns } from "../test/fastCheck";
import { watchCheckpoints } from "../test/checkpointProbe";
import { createEngine } from "./engine";
import { assertCacheInvariants } from "./cacheInvariants";
import { assertLedgerInvariants, assertOutcomeInvariants } from "./resourceInvariants";
import "./cache/cacheRuntime";

it("cache-aside conserves requests and leases, fills only successful calls, drains and replays", () => {
  fc.assert(
    fc.property(
      fc.record({
        seed: fc.integer(),
        scale: fc.constantFrom(1, 2, 10, 50),
        count: fc.integer({ min: 1, max: 25 }),
        coalesce: fc.boolean(),
        noStore: fc.boolean(),
        fail: fc.boolean(),
        timeout: fc.boolean(),
        purge: fc.boolean(),
        mixed: fc.boolean(),
        directFirst: fc.boolean(),
      }),
      (p) => {
        const d = cacheAsideFixture();
        d.nodes[1].props!.concurrency = 1000;
        d.nodes[2].props!.cache = {
          rules: [],
          default: p.noStore ? { noStore: true } : { ttlMs: 1000, keys: 1, coalesce: p.coalesce },
        };
        if (p.fail) {
          d.nodes[3].stencil = "generic.service";
          d.nodes[3].props = { latencyMs: 100, failureRate: 1, jitter: 0, concurrency: 1000 };
        }
        d.edges[2].props!.caller = { onMiss: "lookup", wait: "blocking", ...(p.timeout ? { deadlineMs: 30 } : {}) };
        if (p.mixed) {
          d.nodes.push({ id: "direct", stencil: "client.browser", label: "Direct readers", x: 0, y: -100 });
          d.edges.push(
            { id: "direct-lookup", from: "direct", to: "cache", kind: "sync" },
            {
              id: "cache-origin",
              from: "cache",
              to: "database",
              kind: "sync",
              ...(p.timeout ? { props: { caller: { deadlineMs: 30 } } } : {}),
            },
          );
        }
        const watch = watchCheckpoints();
        try {
          const e = createEngine({
            seed: p.seed,
            scale: p.scale,
            maxParticles: 0,
            verifyLedger: assertLedgerInvariants,
            verifyOutcomes: assertOutcomeInvariants,
          });
          e.load(d, { cache: { "": { rate: 5000, fetchMs: 130 } } });
          e.step(1010);
          e.inject(p.mixed && p.directFirst ? "direct" : "source", p.count, { spreadMs: 100 });
          for (let i = 0; i < 20; i++) {
            if (p.mixed && i === 7) e.inject(p.directFirst ? "source" : "direct", p.count, { spreadMs: 100 });
            if (p.purge && i === 5) e.setFault({ kind: "purge", node: "cache", mode: "hard" });
            e.step(10);
            e.checkpoint();
            assertCacheInvariants(watch.sources[0][0].get("cache")!.cache!);
          }
          const token = e.checkpoint();
          const suffix = () => {
            e.step(2000);
            return e.snapshot();
          };
          const result = suffix();
          expect(result.inSystem).toBe(0);
          expect(e.threadUsage("service")).toMatchObject({ working: 0, waiting: 0 });
          const cache = result.nodes.cache.cache!;
          expect(cache.fetches).toBe(cache.misses + cache.notCached);
          if (p.fail || p.timeout || p.noStore) expect(cache.fills).toBe(0);
          assertCacheInvariants(watch.sources[0][0].get("cache")!.cache!, true);
          e.restore(token);
          expect(suffix()).toEqual(result);
        } finally {
          watch.stop();
        }
      },
    ),
    { numRuns: propertyRuns(50) },
  );
});
