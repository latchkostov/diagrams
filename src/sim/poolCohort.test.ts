import { createEngine } from "./engine";
import { waitingFixture } from "../lab/waitingFixture";
import { expect, it } from "vitest";

it("a burst grants only available connections; a full pool never grants zero-weight work", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 } };
  const grants = new Map<number, number>();
  const e = createEngine({
    scale: 10,
    maxParticles: 0,
    verifyLedger({ ledger }) {
      for (const lease of ledger.reservations.values())
        if (lease.scope === "pool") grants.set(lease.id, lease.represented);
    },
  });
  e.load(d);
  e.inject("source", 2);
  e.step(100);
  expect([...grants.values()]).toEqual([1]);
});

it("a fractional remainder is dispatched at its exact weight", () => {
  const d = waitingFixture();
  d.nodes[1].props = { concurrency: 1, latencyMs: 10, jitter: 0 };
  d.nodes[2].stencil = "generic.service";
  d.nodes[2].props = { concurrency: 100, latencyMs: 10, jitter: 0 };
  d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 } };
  const grants = new Map<number, number>();
  const e = createEngine({
    scale: 2.5,
    maxParticles: 0,
    verifyLedger({ ledger }) {
      for (const lease of ledger.reservations.values())
        if (lease.scope === "pool") grants.set(lease.id, lease.represented);
    },
  });
  e.load(d);
  e.inject("source", 1);
  e.step(1000);
  expect([...grants.values()]).toEqual([2, 0.5]);
});

it.each([
  { deadlineMs: 22, poolConnections: 1, represented: 3 },
  { deadlineMs: 20, poolConnections: 1, represented: 2 },
  { deadlineMs: 20, poolConnections: 2, represented: 4 },
])(
  "each connection grants one creation tick per tick before expiry: $deadlineMs/$poolConnections",
  ({ deadlineMs, poolConnections, represented }) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency: 1, latencyMs: 10, jitter: 0 };
    d.edges[1].props = { caller: { wait: "non-blocking", poolConnections, deadlineMs } };
    const grants = new Map<number, { represented: number; weight: number }>();
    const e = createEngine({
      scale: 10,
      maxParticles: 0,
      verifyLedger({ ledger }) {
        for (const lease of ledger.reservations.values())
          if (lease.scope === "pool") grants.set(lease.id, { represented: lease.represented, weight: lease.weight });
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(100);
    expect([...grants.values()]).toEqual([{ represented, weight: poolConnections }]);
  },
);

it.each([
  { scale: 10, concurrency: 10, latencyMs: 10, granted: 1 },
  { scale: 10, concurrency: 1, latencyMs: 10, granted: 10 },
  { scale: 10, concurrency: 1, latencyMs: 0, granted: 1 },
  { scale: 2.5, concurrency: 1, latencyMs: 10, granted: 2 },
])(
  "only existing local thread waves widen a pool grant: $scale/$concurrency/$latencyMs",
  ({ scale, concurrency, latencyMs, granted }) => {
    const d = waitingFixture();
    d.nodes[1].props = { concurrency, latencyMs, jitter: 0 };
    d.edges[1].props = { caller: { wait: "non-blocking", poolConnections: 1, deadlineMs: 1000 } };
    const grants = new Map<number, number>();
    const e = createEngine({
      scale,
      maxParticles: 0,
      verifyLedger({ ledger }) {
        for (const lease of ledger.reservations.values())
          if (lease.scope === "pool") grants.set(lease.id, lease.represented);
      },
    });
    e.load(d);
    e.inject("source", 1);
    e.step(100);
    expect([...grants.values()]).toEqual([granted]);
  },
);
