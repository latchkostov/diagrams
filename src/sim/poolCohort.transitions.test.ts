import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cancelCohort,
  cohortConserved,
  expireCohort,
  grantCohort,
  narrowCohort,
  openCohort,
  refuseCohort,
  settleWave,
  type PoolCohort,
  type PoolCohortEffect,
} from "./poolCohort";

// Every cell of the state × event table in poolCohort.ts, applied directly to the state machine.
// Each transition below runs through `step`, which checks conservation before and after it.

const template = { id: 1 };
type Cohort = PoolCohort<string, typeof template>;
type Effects = PoolCohortEffect<typeof template>[];

function step(c: Cohort, transition: (c: Cohort) => unknown): Effects {
  expect(cohortConserved(c)).toBe(true);
  const effects = (transition(c) as Effects | undefined) ?? [];
  expect(cohortConserved(c)).toBe(true);
  return effects;
}

const open = (): Cohort => openCohort(7, "call", template, 10, 1000);
/** Bound: two waves in flight (leases 101 → 1, 102 → 2), seven unsent. */
function bound(): Cohort {
  const c = open();
  step(c, (c) => grantCohort(c, 101, 1));
  step(c, (c) => grantCohort(c, 102, 2));
  return c;
}
/** Orphan: wave 101 replied OK; wave 102 in flight, seven unsent. */
function orphan(): Cohort {
  const c = bound();
  step(c, (c) => settleWave(c, 101, true, 50));
  return c;
}
function closed(): Cohort {
  const c = bound();
  step(c, cancelCohort);
  return c;
}
const snapshot = (c: Cohort) => ({ ...c, inFlight: [...c.inFlight] });

describe("pool cohort transitions", () => {
  it("open: a bound cohort owns its template and every member, none sent", () => {
    const c = open();
    expect(c).toMatchObject({ state: "bound", template, represented: 10, remaining: 10, outstanding: 10 });
    expect(c.inFlight.size).toBe(0);
    expect(cohortConserved(c)).toBe(true);
  });

  describe("grant", () => {
    it.each([
      ["bound", bound],
      ["orphan", orphan],
    ] as const)("%s: unsent members move in flight; the template stays queued", (_, make) => {
      const c = make();
      const before = c.outstanding;
      expect(step(c, (c) => grantCohort(c, 103, 3))).toEqual([]);
      expect(c).toMatchObject({ remaining: 4, outstanding: before, template });
      expect(c.inFlight.get(103)).toBe(3);
    });

    it.each([
      ["bound", bound],
      ["orphan", orphan],
    ] as const)("%s: granting the last unsent member releases the template, never a journey", (state, make) => {
      const c = make();
      expect(step(c, (c) => grantCohort(c, 103, 7))).toEqual([["template", template]]);
      expect(c).toMatchObject({ state, remaining: 0, template: undefined });
    });

    it("closed: ignored", () => {
      const c = closed();
      const before = snapshot(c);
      expect(step(c, (c) => grantCohort(c, 103, 1))).toEqual([]);
      expect(snapshot(c)).toEqual(before);
    });
  });

  describe("narrow", () => {
    it("bound: a half-open breaker's refused members leave the cohort unsent", () => {
      const c = bound();
      step(c, (c) => narrowCohort(c, 4));
      expect(c).toMatchObject({ state: "bound", represented: 6, remaining: 3, outstanding: 6 });
    });

    it.each([
      ["orphan", orphan],
      ["closed", closed],
    ] as const)("%s: ignored", (_, make) => {
      const c = make();
      const before = snapshot(c);
      step(c, (c) => narrowCohort(c, 4));
      expect(snapshot(c)).toEqual(before);
    });
  });

  describe("settle OK", () => {
    it("bound: orphaning — the first OK wave decides the caller at its branch size", () => {
      const c = bound();
      expect(step(c, (c) => settleWave(c, 101, true, 50))).toEqual([["decide"]]);
      expect(c).toMatchObject({ state: "orphan", template, remaining: 7, outstanding: 9 });
      expect([...c.inFlight]).toEqual([[102, 2]]);
    });

    it("bound: an OK wave that settles the last owned member decides, then closes first", () => {
      const c = open();
      step(c, (c) => grantCohort(c, 101, 10));
      expect(step(c, (c) => settleWave(c, 101, true, 50))).toEqual([["close"], ["decide"]]);
      expect(c.state).toBe("closed");
    });

    it("orphan: the wave settles on the edge alone", () => {
      const c = orphan();
      expect(step(c, (c) => settleWave(c, 102, true, 60))).toEqual([]);
      expect(c).toMatchObject({ state: "orphan", template, remaining: 7, outstanding: 7 });
    });

    it("orphan: the last owned wave closes the cohort", () => {
      const c = orphan();
      step(c, (c) => grantCohort(c, 103, 7));
      step(c, (c) => settleWave(c, 102, true, 60));
      expect(step(c, (c) => settleWave(c, 103, true, 70))).toEqual([["close"]]);
      expect(c.state).toBe("closed");
    });

    it("closed: ignored (the engine counts a reply for a closed cohort late)", () => {
      const c = closed();
      expect(step(c, (c) => settleWave(c, 101, true, 50))).toEqual([]);
    });
  });

  describe("settle failed", () => {
    it("bound: the failure decides the caller; the cohort closes, cancelling its unsent members", () => {
      const c = bound();
      expect(step(c, (c) => settleWave(c, 101, false, 50))).toEqual([
        ["resize", 101, 10],
        ["template", template],
        ["close"],
        ["release", 102, undefined],
        ["decide"],
      ]);
      expect(c).toMatchObject({ state: "closed", remaining: 0, outstanding: 0, template: undefined });
    });

    it("orphan: wave failure counts only that wave; the queue and shared deadline remain (R-0960b75fb2)", () => {
      const c = orphan();
      expect(step(c, (c) => settleWave(c, 102, false, 60))).toEqual([["failed", 2]]);
      expect(c).toMatchObject({ state: "orphan", template, remaining: 7, outstanding: 7 });
      // The remaining members are still granted and settle independently.
      expect(step(c, (c) => grantCohort(c, 103, 7))).toEqual([["template", template]]);
      expect(step(c, (c) => settleWave(c, 103, true, 70))).toEqual([["close"]]);
    });

    it("orphan: a failed last wave counts, then closes", () => {
      const c = orphan();
      step(c, (c) => grantCohort(c, 103, 7));
      step(c, (c) => settleWave(c, 102, true, 60));
      expect(step(c, (c) => settleWave(c, 103, false, 70))).toEqual([["failed", 7], ["close"]]);
      expect(c.state).toBe("closed");
    });

    it("closed: ignored", () => {
      const c = closed();
      expect(step(c, (c) => settleWave(c, 101, false, 50))).toEqual([]);
    });
  });

  describe("settle at or after the deadline", () => {
    it("bound: the reply is late and the cohort expires, deciding the caller at its outstanding size", () => {
      const c = bound();
      expect(step(c, (c) => settleWave(c, 101, true, 1000))).toEqual([
        ["late", 1],
        ["template", template],
        ["close"],
        ["release", 101, 1000],
        ["release", 102, 1000],
        ["decide", 10],
      ]);
      expect(c.state).toBe("closed");
    });

    it("orphan: the reply is late and every outstanding member times out", () => {
      const c = orphan();
      expect(step(c, (c) => settleWave(c, 102, false, 1005))).toEqual([
        ["late", 2],
        ["timedOut", 9],
        ["failed", 9],
        ["template", template],
        ["close"],
        ["release", 102, 1005],
      ]);
      expect(c.state).toBe("closed");
    });

    it("closed: ignored", () => {
      const c = closed();
      expect(step(c, (c) => settleWave(c, 101, true, 1000))).toEqual([]);
    });
  });

  describe("expire", () => {
    it("bound: the caller times out at the cohort's outstanding size; waves release at the deadline", () => {
      const c = bound();
      expect(step(c, (c) => expireCohort(c, 1000))).toEqual([
        ["template", template],
        ["close"],
        ["release", 101, 1000],
        ["release", 102, 1000],
        ["decide", 10],
      ]);
      expect(c).toMatchObject({ state: "closed", remaining: 0, outstanding: 0 });
    });

    it("orphan: unsent and in-flight members time out on the edge", () => {
      const c = orphan();
      expect(step(c, (c) => expireCohort(c, 1000))).toEqual([
        ["timedOut", 9],
        ["failed", 9],
        ["template", template],
        ["close"],
        ["release", 102, 1000],
      ]);
      expect(c.state).toBe("closed");
    });

    it("orphan without a template: only in-flight members remain to time out", () => {
      const c = orphan();
      step(c, (c) => grantCohort(c, 103, 7));
      expect(step(c, (c) => expireCohort(c, 1000))).toEqual([
        ["timedOut", 9],
        ["failed", 9],
        ["close"],
        ["release", 102, 1000],
        ["release", 103, 1000],
      ]);
    });

    it("closed: ignored", () => {
      const c = closed();
      expect(step(c, (c) => expireCohort(c, 1000))).toEqual([]);
    });
  });

  describe("cancel", () => {
    it.each([
      ["bound", bound, [101, 102]],
      ["orphan", orphan, [102]],
    ] as const)("%s: the template is cancelled without route credit and connections retire", (_, make, leases) => {
      const c = make();
      expect(step(c, cancelCohort)).toEqual([
        ["template", template],
        ["close"],
        ...leases.map((lease) => ["release", lease, undefined]),
      ]);
      expect(c).toMatchObject({ state: "closed", remaining: 0, outstanding: 0, template: undefined });
      expect(c.inFlight.size).toBe(0);
    });

    it("a partially dispatched bound cohort cancels only its unsent template (R-9bc44a6b93)", () => {
      const c = open();
      step(c, (c) => grantCohort(c, 101, 1));
      const effects = step(c, cancelCohort);
      // The template is released as a template: no effect completes a journey or credits a route.
      expect(effects).toEqual([["template", template], ["close"], ["release", 101, undefined]]);
    });

    it("closed: ignored", () => {
      const c = closed();
      expect(step(c, cancelCohort)).toEqual([]);
    });
  });

  describe("refuse", () => {
    it("bound: ignored — a bound template asks the caller's breaker, whose refusal cancels", () => {
      const c = bound();
      const before = snapshot(c);
      expect(step(c, refuseCohort)).toEqual([]);
      expect(snapshot(c)).toEqual(before);
    });

    it("orphan: unsent members fail fast; waves already sent keep settling", () => {
      const c = orphan();
      expect(step(c, refuseCohort)).toEqual([
        ["failed", 7],
        ["template", template],
      ]);
      expect(c).toMatchObject({ state: "orphan", remaining: 0, outstanding: 2, template: undefined });
      expect(step(c, (c) => settleWave(c, 102, true, 60))).toEqual([["close"]]);
    });

    it("orphan with nothing in flight: refusing the unsent members closes it", () => {
      const c = orphan();
      step(c, (c) => settleWave(c, 102, true, 60));
      expect(step(c, refuseCohort)).toEqual([["failed", 7], ["template", template], ["close"]]);
      expect(c.state).toBe("closed");
    });

    it("closed: ignored", () => {
      const c = closed();
      expect(step(c, refuseCohort)).toEqual([]);
    });
  });

  it("conserves outstanding = remaining + in flight across any transition sequence", () => {
    const transition = fc.oneof(
      fc.record({ kind: fc.constant("grant" as const), weight: fc.double({ min: 0.01, max: 4, noNaN: true }) }),
      fc.record({ kind: fc.constant("settle" as const), pick: fc.nat(), ok: fc.boolean(), late: fc.boolean() }),
      fc.record({ kind: fc.constantFrom("expire" as const, "cancel" as const, "refuse" as const) }),
      fc.record({ kind: fc.constant("narrow" as const), weight: fc.double({ min: 0, max: 1, noNaN: true }) }),
    );
    fc.assert(
      fc.property(fc.double({ min: 1.01, max: 20, noNaN: true }), fc.array(transition, { maxLength: 30 }), (n, ops) => {
        const c: Cohort = openCohort(7, "call", template, n, 1000);
        let lease = 100;
        for (const op of ops) {
          const before = c.state;
          let effects: Effects = [];
          if (op.kind === "grant") effects = grantCohort(c, ++lease, Math.min(op.weight, c.remaining));
          else if (op.kind === "narrow") narrowCohort(c, op.weight * c.remaining);
          else if (op.kind === "settle") {
            const leases = [...c.inFlight.keys()];
            if (leases.length) effects = settleWave(c, leases[op.pick % leases.length], op.ok, op.late ? 1000 : 10);
          } else if (op.kind === "expire") effects = expireCohort(c, 1000);
          else if (op.kind === "cancel") effects = cancelCohort(c);
          else effects = refuseCohort(c);
          expect(cohortConserved(c)).toBe(true);
          // A closed cohort never reopens; a template is released at most once.
          if (before === "closed") expect(effects).toEqual([]);
          expect(effects.filter((e) => e[0] === "template").length).toBeLessThanOrEqual(1);
          if (effects.some((e) => e[0] === "close")) expect(c.state).toBe("closed");
        }
      }),
    );
  });
});
