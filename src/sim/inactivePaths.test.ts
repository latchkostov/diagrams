import { afterEach, expect, it, vi } from "vitest";
import * as resources from "./engine/resources";
import * as revisions from "../model/revisions";
import { createEngine } from "./engine";
import { SampledLedger } from "./ledger";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import type { PlanningModel } from "../model/types";
import { waitingFixture } from "../lab/waitingFixture";

afterEach(() => vi.restoreAllMocks());

function countCpu() {
  const create = resources.createResources;
  const prepare = vi.fn();
  const finish = vi.fn();
  vi.spyOn(resources, "createResources").mockImplementation((...args) => {
    const methods = [...create(...args)] as unknown as ReturnType<typeof create>;
    const before = methods[7],
      after = methods[8];
    Object.assign(methods, {
      7: (...args: Parameters<typeof before>) => {
        prepare();
        return before(...args);
      },
      8: (...args: Parameters<typeof after>) => {
        finish();
        return after(...args);
      },
    });
    return methods;
  });
  return { prepare, finish };
}

function fixture(revision: PlanningModel["revision"] = "p3-a1") {
  const d = autoscalingFixture();
  d.planning = { revision };
  d.nodes[0].props = { ratePerSec: 0 };
  d.nodes[1].props = { replicas: 1, concurrency: 4, latencyMs: 100, jitter: 0 };
  return d;
}

it.each(["p1", "p3-w2"] as const)("skips empty CPU and ledger work on %s ticks", (revision) => {
  const cpu = countCpu();
  const e = createEngine({ seed: 7, scale: 5 });
  e.load(fixture(revision));
  const release = vi.spyOn(SampledLedger.prototype, "releaseDue");
  const expire = vi.spyOn(SampledLedger.prototype, "expireCredits");
  const checks = vi.spyOn(revisions, "revisionAtLeast");
  e.step(100);
  expect(cpu.prepare).not.toHaveBeenCalled();
  expect(cpu.finish).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  expect(expire).not.toHaveBeenCalled();
  expect(checks).not.toHaveBeenCalled();
});

it("keeps non-resource playback off the CPU scratch path", () => {
  const cpu = countCpu();
  const e = createEngine({ seed: 7, scale: 5 });
  e.load(fixture());
  e.inject("source", 30);
  e.step(2000);
  expect(e.snapshot().nodes.worker.processed).toBe(14);
  expect(cpu.prepare).not.toHaveBeenCalled();
  expect(cpu.finish).not.toHaveBeenCalled();
});

it("observes resource edits and restores in both directions without stale feature state", () => {
  const cpu = countCpu();
  const e = createEngine({ seed: 7, scale: 5 });
  e.load(fixture());
  const inactive = e.checkpoint();
  e.setNodeProps("worker", { resources: resourceLesson(), autoscaling: { mode: "off" } });
  e.inject("source", 30);
  e.step(100);
  const active = e.checkpoint();
  const suffix = () => {
    e.step(2000);
    return e.snapshot();
  };
  const expected = suffix();
  expect(expected.nodes.worker.resources!.executedCpuMs).toBeGreaterThan(0);
  expect(cpu.prepare).toHaveBeenCalled();
  e.setNodeProps("worker", { resources: undefined });
  cpu.prepare.mockClear();
  e.step(100);
  expect(cpu.prepare).not.toHaveBeenCalled();
  e.restore(active);
  expect(suffix()).toEqual(expected);
  expect(cpu.prepare).toHaveBeenCalled();
  e.restore(inactive);
  cpu.prepare.mockClear();
  e.inject("source", 30);
  e.step(2000);
  expect(cpu.prepare).not.toHaveBeenCalled();
  expect(e.snapshot().nodes.worker.processed).toBe(14);
});

it("refreshes revision capabilities on graph loads and preserves them through restarts and restores", () => {
  const e = createEngine({ seed: 7, scale: 5 });
  for (const revision of ["p1", "p3-w2", "p3-a1", "p3-w1"] as const) {
    const d = fixture(revision);
    e.load(d);
    const reference = createEngine({ seed: 7, scale: 5 });
    reference.load(d);
    const suffix = (engine: typeof e) => {
      engine.inject("source", 30);
      engine.step(2000);
      return engine.snapshot();
    };
    const cp = e.checkpoint();
    const expected = suffix(reference);
    expect(suffix(e)).toEqual(expected);
    e.restore(cp);
    expect(suffix(e)).toEqual(expected);
    e.reset();
    expect(suffix(e)).toEqual(expected);
  }
});

it("reloads blocking callers across waiting and historical revisions on the same engine", () => {
  const e = createEngine({ seed: 17, scale: 1 });
  for (const revision of ["p3-w1", "p3-a1", "p3-w2", "p1", "p3-w1"] as const) {
    const d = waitingFixture();
    d.planning = { revision };
    e.load(d);
    const reference = createEngine({ seed: 17, scale: 1 });
    reference.load(d);
    const suffix = (engine: typeof e) => {
      engine.inject("source", 8);
      engine.step(30);
      const held = engine.snapshot();
      expect(held.nodes.caller.threads?.waiting ?? 0).toBe(revision === "p3-w1" || revision === "p3-w2" ? 4 : 0);
      engine.step(2000);
      expect(engine.snapshot().inSystem).toBe(0);
      return { held, drained: engine.snapshot() };
    };
    const cp = e.checkpoint();
    const expected = suffix(reference);
    expect(suffix(e)).toEqual(expected);
    e.restore(cp);
    expect(suffix(e)).toEqual(expected);
    e.reset();
    expect(suffix(e)).toEqual(expected);
  }
});

it("resumes ledger maintenance when reservations appear, including checkpoint restores", () => {
  const e = createEngine({ seed: 7, scale: 5 });
  e.load(fixture("p3-w1"));
  const release = vi.spyOn(SampledLedger.prototype, "releaseDue");
  const expire = vi.spyOn(SampledLedger.prototype, "expireCredits");
  e.step(100);
  expect(release).not.toHaveBeenCalled();
  e.inject("source", 30);
  e.step(100);
  const active = e.checkpoint();
  const suffix = () => {
    e.step(10_000);
    return e.snapshot();
  };
  const expected = suffix();
  expect(release).toHaveBeenCalled();
  expect(expire).toHaveBeenCalled();
  release.mockClear();
  expire.mockClear();
  e.step(100);
  expect(release).not.toHaveBeenCalled();
  expect(expire).not.toHaveBeenCalled();
  e.restore(active);
  expect(suffix()).toEqual(expected);
  expect(release).toHaveBeenCalled();
  expect(expire).toHaveBeenCalled();
  e.reset();
  release.mockClear();
  expire.mockClear();
  e.step(100);
  expect(release).not.toHaveBeenCalled();
  expect(expire).not.toHaveBeenCalled();
});
