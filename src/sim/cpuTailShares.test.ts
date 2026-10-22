import { expect, it } from "vitest";
import { chargeTails, tailEntitlements, yieldsToFirstWaves, type CpuBudgets, type ResourceWork } from "./resourceWork";

const ignore = () => {};

it("yielding tails share what first waves leave, max-min fairly", () => {
  // In tail order, an even split would give the large tail 3 and leave 2 of the budget unused.
  const large: ResourceWork = { cpuRemaining: 8, replica: 0 };
  const small: ResourceWork = { cpuRemaining: 1, replica: 0 };
  const budgets: CpuBudgets = new Map([[0, { remaining: 6, count: 0 }]]);
  const finished: ResourceWork[] = [];
  chargeTails([large, small], budgets, ignore, new Map(), (tail) => finished.push(tail));
  expect(small.cpuRemaining).toBe(0);
  expect(large.cpuRemaining).toBe(3);
  expect(budgets.get(0)!.remaining).toBe(0);
  expect(finished).toEqual([small]);
});

it("contended fractional tails receive their fair share one tick later", () => {
  const tail: ResourceWork = { cpuRemaining: 20, replica: 0 };
  const charged: number[] = [];
  const charge = (_work: ResourceWork, spent: number) => charged.push(spent);
  // The node counted one first wave and this tail: the tail's fair share is half the tick.
  let budgets: CpuBudgets = new Map([[0, { remaining: 10, count: 2 }]]);
  const shares = tailEntitlements([tail], budgets);
  expect(shares.get(tail)).toBe(5);
  chargeTails([tail], budgets, charge);
  budgets.get(0)!.remaining = 0; // The first wave takes the whole tick.
  chargeTails([tail], budgets, charge, shares, ignore);
  expect(tail).toMatchObject({ cpuRemaining: 20, cpuOwed: 5 });
  // Next tick, the debt runs before any first wave, and no more than the debt.
  budgets = new Map([[0, { remaining: 10, count: 2 }]]);
  chargeTails([tail], budgets, charge);
  expect(tail).toMatchObject({ cpuRemaining: 15, cpuOwed: 0 });
  expect(budgets.get(0)!.remaining).toBe(5);
  expect(charged).toEqual([5]);
});

it("owed CPU never exceeds the tail's unfinished CPU", () => {
  const tail: ResourceWork = { cpuRemaining: 2, replica: 0, cpuOwed: 1.5 };
  const budgets: CpuBudgets = new Map([[0, { remaining: 0, count: 0 }]]);
  chargeTails([tail], budgets, ignore, new Map([[tail, 5]]), ignore);
  expect(tail.cpuOwed).toBe(2);
});

it("a tail is fractional only when it forms with less than one request's CPU, decided once", () => {
  const fractional: ResourceWork = { cpuRemaining: 2.4, cpuPerRequest: 24 };
  const whole: ResourceWork = { cpuRemaining: 30, cpuPerRequest: 5 };
  const exact: ResourceWork = { cpuRemaining: 24 };
  expect(yieldsToFirstWaves(fractional, 0)).toBe(true);
  expect(yieldsToFirstWaves(whole, 0)).toBe(false);
  // Without its own request CPU (a detached tail), the node's per-request CPU decides.
  expect(yieldsToFirstWaves(exact, 24)).toBe(false);
  whole.cpuRemaining = 2;
  expect(yieldsToFirstWaves(whole, 0)).toBe(false);
});
