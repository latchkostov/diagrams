import { expect, it } from "vitest";
import { cacheHerd } from "./cacheHerd";
import { cacheReadout } from "./cacheReadout";
import { createEngine } from "../sim/engine";
import { cacheFixture } from "../lab/cacheFixture";
import "../sim/cache/cacheRuntime";
import { TroubleWatcher, type WatchedFrame } from "./observedTrouble";
import { runEndResult } from "./runEndResult";

it("shows a stampede only above the run's real-unit threshold; held waiters stay neutral", () => {
  const e = createEngine();
  e.load(cacheFixture());
  const n = e.snapshot().nodes.cache;
  n.cacheDetails = {
    herdThreshold: 200,
    herd: { rule: "pages", item: 1, fetches: 199, waiting: 0, expiredAt: 0 },
    window: { requests: 1000, hits: 800, misses: 200, fetches: 200, seconds: 10 },
  };
  expect(cacheHerd(n)).toBeUndefined();
  expect(cacheReadout(n)?.stampede).toBe(false);
  n.cacheDetails.herd!.fetches = 200;
  expect(cacheReadout(n)?.text).toBe("⚡ Stampede");
  n.cacheDetails.herd!.fetches = 1;
  n.cacheDetails.herd!.waiting = 200;
  expect(cacheHerd(n)?.waiting).toBe(200);
  expect(cacheReadout(n)?.text).toBe("80% hits");
});

it("attributes a routed herd's lesson to its measured origin edge", () => {
  const d = cacheFixture();
  d.nodes.push({ ...d.nodes[2], id: "other", label: "Other origin" });
  d.edges.unshift({ ...d.edges[1], id: "other-fetch", to: "other" });
  const state = {
    run: { done: true },
    snapshot: {
      scale: 1,
      nodes: {
        cache: { cacheDetails: { peakHerd: { rule: "", item: 1, fetches: 60, edge: "fetch" } } },
      },
    },
  } as unknown as import("./controller").LiveState;
  expect(runEndResult(state, d)).toContain("Origin at once");
  expect(runEndResult(state, d)).not.toContain("Other origin");
});

it("an unrelated source's slowdown cannot turn a harmless herd into cache trouble", () => {
  const d = cacheFixture();
  d.nodes.push({ ...d.nodes[0], id: "unrelated" });
  const frame = (time: number, connected: number, unrelated: number) =>
    ({
      time,
      nodes: {
        cache: {
          status: "up",
          lag: {},
          dropped: 0,
          cacheDetails: { herd: { rule: "", item: 1, fetches: 60, waiting: 0, expiredAt: 0, edge: "fetch" } },
        },
        origin: { status: "up", lag: {}, dropped: 0, backlog: 0 },
        source: { status: "up", lag: {}, dropped: 0, latency: { p95: connected } },
        unrelated: { status: "up", lag: {}, dropped: 0, latency: { p95: unrelated } },
      },
    }) as WatchedFrame;
  const watcher = new TroubleWatcher();
  watcher.observe(frame(0, 100, 100), d);
  expect(watcher.observe(frame(1000, 100, 500), d).some((t) => t.kind === "cache-stampede")).toBe(false);
  expect(watcher.observe(frame(2000, 500, 500), d)[0]?.kind).toBe("cache-stampede");
});
