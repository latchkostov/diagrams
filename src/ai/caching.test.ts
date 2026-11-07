import { expect, it } from "vitest";
import { applyOps } from "./ops";
import { describeDiagram } from "./describe";
import { buildSimulation } from "./simulate";
import { cacheFixture } from "../lab/cacheFixture";

const cache = { rules: [{ id: "pages", match: { types: ["*"] }, policy: { ttlMs: 10000, keys: 1 } }] };

it("upgrades W2 cache edits atomically, including dry runs, and refuses older models", () => {
  for (const dryRun of [false, true]) {
    const d = cacheFixture();
    d.planning!.revision = "p3-w2";
    delete d.nodes[1].props!.cache;
    const result = applyOps(d, [{ op: "update", target: "cache", props: { cache } }], { dryRun });
    expect(result.errors).toEqual([]);
    expect(result.diagram.planning!.revision).toBe("p3-w3");
    expect(d.planning!.revision).toBe("p3-w2");
    d.planning!.revision = "p3-w1";
    expect(applyOps(d, [{ op: "update", target: "cache", props: { cache } }]).errors[0].error).toContain(
      "Upgrade the model first",
    );
  }
});

it("refuses cache rules on an incapable stencil for adds and updates", () => {
  const d = cacheFixture();
  expect(applyOps(d, [{ op: "update", target: "origin", props: { cache } }]).ok).toBe(false);
  expect(applyOps(d, [{ op: "add_node", kind: "generic.service", label: "Service", props: { cache } }]).ok).toBe(false);
});

it("describes expected cache traffic with named fields and the cache capability", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = cache;
  const json = JSON.parse(describeDiagram(d, { format: "json" }));
  const node = json.nodes.find((n: { id: string }) => n.id === "cache");
  expect(node.capabilities).toContain("cache");
  expect(node.cache.rules[0].expected).toEqual(
    expect.objectContaining({
      requestsPerSec: expect.any(Number),
      hitRatio: expect.any(Number),
      offload: expect.any(Number),
      originPerSec: expect.any(Number),
      hottestShare: expect.any(Number),
      herd: expect.any(Number),
      coldOriginPerSec: expect.any(Number),
    }),
  );
  expect(describeDiagram(d)).toContain("cache=");
});

it("describes Default estimates and uses null for unavailable analysis", () => {
  const d = cacheFixture();
  const node = () =>
    JSON.parse(describeDiagram(d, { format: "json" })).nodes.find((n: { id: string }) => n.id === "cache");
  expect(node().cache.rules[0]).toMatchObject({ id: "", expected: { requestsPerSec: 200 } });
  for (let i = 0; i < 200; i++)
    d.nodes.push({ id: `extra-${i}`, stencil: "generic.service", label: "Service", x: 0, y: 0 });
  expect(node().cache.rules[0].expected).toEqual({
    requestsPerSec: null,
    hitRatio: null,
    offload: null,
    originPerSec: null,
    hottestShare: 0.05,
    herd: null,
    coldOriginPerSec: null,
  });
});

it("rolls back an upgrade when a later operation refuses the batch", () => {
  const d = cacheFixture();
  d.planning!.revision = "p3-w2";
  delete d.nodes[1].props!.cache;
  const result = applyOps(d, [
    { op: "update", target: "cache", props: { cache } },
    { op: "update", target: "missing", label: "Absent" },
  ]);
  expect(result.ok).toBe(false);
  expect(result.diagram).toBe(d);
  expect(result.diagram.planning!.revision).toBe("p3-w2");
});

it("authors purge events using node references and validates their rule", () => {
  const d = cacheFixture();
  d.nodes[1].props!.cache = cache;
  const sim = buildSimulation(d, {
    title: "Cold cache",
    durationSec: 20,
    traffic: [],
    events: [{ do: "purge", atSec: 5, node: "Edge cache", mode: "soft", rule: "pages", reason: "deploy" }],
  });
  expect(sim.timeline![0].action).toEqual({
    do: "fault",
    fault: { kind: "purge", node: "cache", mode: "soft", rule: "pages", reason: "deploy" },
    drill: "cold-cache",
  });
  expect(() =>
    buildSimulation(d, { title: "Invalid", traffic: [], events: [{ do: "purge", atSec: 0, node: "origin" }] }),
  ).toThrow();
});
