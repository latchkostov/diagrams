import { expect, it } from "vitest";
import data from "./retry-storm.json";
import type { DiagramFile } from "../model/types";
import { createSimulationRun } from "../sim/simulation";
import { validateDiagram } from "../interop/native";
import { exampleShows } from "../../scripts/example-shows";
import { analyzeCapacity } from "../sim/capacity";
import payment from "./slow-payment-provider.json";

const diagram = data as DiagramFile;
it("the public retry storm validates and teaches retries", () => {
  expect(validateDiagram(diagram).ok).toBe(true);
  expect(exampleShows(diagram)).toContain("resilience");
  const ids = [...diagram.nodes, ...diagram.edges].map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  const capacity = analyzeCapacity(diagram).nodes.payments;
  expect(capacity.capacity).toBe(600);
  expect(capacity.utilization).toBe(0.5);
});

it.each([1, 7, 17, 42, 99])("retry storm outcome bands at seed %s", (seed) => {
  for (const simulation of diagram.simulations!) {
    const run = createSimulationRun(diagram, { ...simulation, seed });
    run.step(3000);
    const blip = run.engine.snapshot();
    expect(blip.edges.pay.calls!.retried).toBeGreaterThan(0);
    expect(blip.nodes.shop.throughput).toBeGreaterThanOrEqual(270);
    let peak = 0;
    let recoveredAt: number | undefined;
    let clearedBacklog = 0;
    let storm = blip;
    for (let ms = 3100; ms <= 60000; ms += 100) {
      run.step(100);
      const snapshot = run.engine.snapshot();
      peak = Math.max(peak, snapshot.nodes.payments.backlog);
      if (ms === 8000) clearedBacklog = snapshot.nodes.payments.backlog;
      if (ms === 15000) storm = snapshot;
      if (
        ms > 8000 &&
        recoveredAt === undefined &&
        snapshot.nodes.shop.throughput >= 270 &&
        snapshot.nodes.payments.backlog < 100
      )
        recoveredAt = ms;
    }
    const final = run.engine.snapshot();
    expect(final.time).toBe(60000);
    if (process.env.RESILIENCE_MEASURE)
      console.log(
        JSON.stringify({
          seed,
          simulation: simulation.id,
          blip: blip.edges.pay.calls,
          clearedBacklog,
          at15: storm.nodes.payments,
          peak,
          recoveredAt,
          endBacklog: final.nodes.payments.backlog,
          goodput: final.nodes.shop.throughput,
          calls: final.edges.pay.calls,
        }),
      );
    if (simulation.id === "retry-budget") {
      expect(clearedBacklog).toBeGreaterThan(1250);
      expect(clearedBacklog).toBeLessThan(1400);
      expect(peak).toBeGreaterThan(3800);
      expect(peak).toBeLessThan(4200);
      expect(recoveredAt).toBeGreaterThanOrEqual(37000);
      expect(recoveredAt).toBeLessThanOrEqual(40000);
      expect(final.edges.pay.calls!.budgetDenied).toBeGreaterThan(0);
      expect(final.nodes.payments.backlog).toBeLessThan(100);
      expect(final.nodes.shop.throughput).toBeGreaterThanOrEqual(270);
      expect(run.state().expectations.every((e) => e.status === "pass")).toBe(true);
    } else {
      expect(clearedBacklog).toBeGreaterThan(3400);
      expect(clearedBacklog).toBeLessThan(3700);
      expect(storm.nodes.payments.backlog).toBeGreaterThan(8800);
      expect(storm.nodes.payments.backlog).toBeLessThan(9300);
      expect(final.nodes.payments.backlog).toBeGreaterThan(33000);
      expect(final.nodes.payments.backlog).toBeLessThan(35000);
      expect(recoveredAt).toBeUndefined();
      expect(final.nodes.shop.throughput).toBeLessThan(30);
      expect(run.state().expectations.every((e) => e.status === "fail")).toBe(true);
    }
  }
});

it("the payment-provider extension holds blocking threads through retries and backoff", () => {
  const d = payment as DiagramFile;
  const simulation = d.simulations!.find((s) => s.id === "three-retries-hold-threads")!;
  expect(validateDiagram(d).ok).toBe(true);
  expect(exampleShows(d)).toContain("resilience");
  const run = createSimulationRun(d, simulation);
  run.step(8000);
  const s = run.engine.snapshot();
  expect(s.nodes.checkout.threads!.waiting).toBeGreaterThanOrEqual(90);
  expect(s.edges.pay.calls!.retried).toBeGreaterThan(100);
  run.step(12000);
  expect(run.state().expectations.every((e) => e.status === "pass")).toBe(true);
});
