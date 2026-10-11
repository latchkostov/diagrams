import { describe, expect, it } from "vitest";
import type { Particle } from "../../sim/types";
import { CALM_INTERVAL, CalmSampler, calmTarget, familyHash, idealStride } from "./sampler";

/** `families` journeys, each with a few dots on different edges (a root and its copies). */
function traffic(families: number, perFamily = 1, from = 1, kind: Particle["kind"] = "message"): Particle[] {
  const out: Particle[] = [];
  let id = 1;
  for (let f = from; f < from + families; f++)
    for (let i = 0; i < perFamily; i++)
      out.push({
        id: id++,
        edgeId: `e${i}`,
        messageId: f * 10 + i,
        rootId: f,
        kind,
        progress: (f % 10) / 10,
        type: "OrderPlaced",
        color: "#309bd5",
      });
  return out;
}

const drawn = (s: CalmSampler, ps: Particle[], focus?: number) => ps.filter((p) => s.keep(p, focus)).length;

describe("calmer slow speeds", () => {
  it("targets 24 dots at 0.25×, 48 at 0.5×, and leaves 1× and faster alone", () => {
    expect(calmTarget(0.25)).toBe(24);
    expect(calmTarget(0.5)).toBe(48);
    expect(calmTarget(1)).toBe(Infinity);
    expect(calmTarget(8)).toBe(Infinity);
    expect(idealStride(113, 24)).toBe(4);
    expect(idealStride(126, 24)).toBe(4);
    expect(idealStride(165, 24)).toBe(8);
    expect(idealStride(20, 24)).toBe(1);
    expect(idealStride(113, Infinity)).toBe(1);
  });

  it("lands near the density targets", () => {
    for (const [speed, target] of [
      [0.25, 24],
      [0.5, 48],
    ] as const) {
      for (const n of [120, 300, 1000, 1500]) {
        const s = new CalmSampler();
        s.setSpeed(speed);
        const ps = traffic(n);
        s.begin(ps, 0);
        const count = drawn(s, ps);
        expect(count, `${n} dots at ${speed}×`).toBeGreaterThan(target * 0.5);
        expect(count, `${n} dots at ${speed}×`).toBeLessThan(target * 1.8);
      }
    }
  });

  it("draws everything at 1× and when there are few dots", () => {
    const s = new CalmSampler();
    const ps = traffic(200);
    s.begin(ps, 0);
    expect(drawn(s, ps)).toBe(200);
    s.setSpeed(0.25);
    const few = traffic(15);
    s.begin(few, 0);
    expect(drawn(s, few)).toBe(15);
  });

  it("is deterministic", () => {
    const a = new CalmSampler();
    const b = new CalmSampler();
    a.setSpeed(0.25);
    b.setSpeed(0.25);
    const ps = traffic(150, 2);
    a.begin(ps, 0);
    b.begin(ps, 0);
    expect(ps.map((p) => a.keep(p))).toEqual(ps.map((p) => b.keep(p)));
    expect(familyHash(42)).toBe(familyHash(42));
    expect(familyHash(1)).not.toBe(familyHash(2));
  });

  it("keeps a message (and its copies) on every hop, frame after frame", () => {
    const s = new CalmSampler();
    s.setSpeed(0.25);
    const ps = traffic(160, 3);
    s.begin(ps, 0);
    const byRoot = new Map<number, boolean>();
    for (const p of ps) {
      const on = s.keep(p);
      if (byRoot.has(p.rootId)) expect(on).toBe(byRoot.get(p.rootId));
      byRoot.set(p.rootId, on);
    }
    // Later frames: the dots moved on, k may change, the decision holds.
    let t = 0;
    for (const n of [400, 40, 900]) {
      t += CALM_INTERVAL;
      const more = [...ps, ...traffic(n, 1, 1000 + t)];
      s.begin(more, t);
      for (const p of ps) expect(s.keep({ ...p, edgeId: "other", progress: 0.9 })).toBe(byRoot.get(p.rootId));
    }
  });

  it("preserves excluded families when traffic drains", () => {
    const s = new CalmSampler();
    s.setSpeed(0.25);
    const busy = traffic(160);
    s.begin(busy, 0);
    expect(s.k).toBeGreaterThan(1);
    const out = busy.find((p) => !s.keep(p))!;
    const kept = busy.find((p) => s.keep(p))!;
    // The rest finish; these two are still on their way while the stride halves down to 1.
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += CALM_INTERVAL;
      const few = [out, kept, ...traffic(6, 1, 5000)];
      s.begin(few, t);
      expect(s.keep({ ...out, progress: 0.9 })).toBe(false);
      expect(s.keep({ ...kept, progress: 0.9 })).toBe(true);
    }
    expect(s.k).toBe(1);
  });

  it("preserves visible families when traffic increases", () => {
    const s = new CalmSampler();
    s.setSpeed(0.25);
    const few = traffic(12);
    s.begin(few, 0);
    expect(s.k).toBe(1);
    expect(drawn(s, few)).toBe(12);
    // A burst arrives while those are still on their way: the stride climbs, they stay drawn.
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += CALM_INTERVAL;
      s.begin([...few, ...traffic(1500, 1, 5000)], t);
      for (const p of few) expect(s.keep({ ...p, progress: 0.9 })).toBe(true);
    }
    expect(s.k).toBeGreaterThan(1);
  });

  it("changes the stride one step a second, with hysteresis", () => {
    const s = new CalmSampler();
    s.setSpeed(0.25);
    s.begin(traffic(100), 0);
    expect(s.k).toBe(4);
    // A burst: one doubling per second at most.
    s.begin(traffic(1500, 1, 5000), 500);
    expect(s.k).toBe(4);
    s.begin(traffic(1500, 1, 5000), 1000);
    expect(s.k).toBe(8);
    s.begin(traffic(1500, 1, 5000), 2000);
    expect(s.k).toBe(16);
    // Small wobbles around a rounding point don't flip it.
    const steady = new CalmSampler();
    steady.setSpeed(0.25);
    steady.begin(traffic(100), 0);
    for (const [i, n] of [130, 80, 125, 70, 140].entries()) {
      steady.begin(traffic(n), (i + 1) * CALM_INTERVAL);
      expect(steady.k).toBe(4);
    }
    // Back to 1×: everything again.
    s.setSpeed(1);
    expect(s.k).toBe(1);
    expect(drawn(s, traffic(500))).toBe(500);
  });

  it("always draws the traced message, retries and dead letters", () => {
    const s = new CalmSampler();
    s.setSpeed(0.25);
    const ps = traffic(400);
    s.begin(ps, 0);
    expect(ps.every((p) => s.keep(p, p.rootId))).toBe(true);
    const failing = [...traffic(50, 1, 2000, "retry"), ...traffic(50, 1, 3000, "dlq")];
    expect(drawn(s, failing)).toBe(100);
  });
});
