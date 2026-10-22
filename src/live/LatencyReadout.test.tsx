import { faultDrillFixture } from "../lab/faultDrillFixture";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LatencyReadout } from "./LatencyReadout";
import { createLatencyBudget, createLatencyRecorder, latencyMetrics, recordLatency } from "../sim/latency";

it("discloses aggregate-only fallback after the shared recording budget is exhausted", () => {
  const recorder = createLatencyRecorder();
  const budget = createLatencyBudget();
  budget.remaining = 0;
  recordLatency(recorder, "Order", 0, 100, 10, budget);
  const html = renderToStaticMarkup(<LatencyReadout id="sink" latency={latencyMetrics(recorder)} />);
  expect(html).toContain("Recording limit reached: additional message types are included in the aggregate only.");
  expect(html).toContain("p95 0.1 s");
  expect(html).toContain("1 sampled message");
});

it("names the drill fault window in its one compact scope line without restart or identifiers", () => {
  const recorder = createLatencyRecorder();
  recordLatency(recorder, "Order", 0, 100, 10);
  const html = renderToStaticMarkup(
    <LatencyReadout
      id="sink"
      compact
      diagram={faultDrillFixture()}
      latency={{
        ...latencyMetrics(recorder),
        sinceFault: { atMs: 3000, fault: { kind: "boundary", boundary: "zone-b", down: true } },
      }}
    />,
  );
  expect(html).toContain("From 1 finished message since Zone b went down. Animation time not counted.");
  expect(html).not.toContain("since restart");
  expect(html).not.toContain("zone-b");
});

it("excludes animation time only from the compact breakdown denominator", () => {
  const recorder = createLatencyRecorder();
  recordLatency(recorder, "Order", 0, 100, 900);
  const latency = latencyMetrics(recorder);
  expect(renderToStaticMarkup(<LatencyReadout id="sink" latency={latency} compact />)).toContain(
    "Waiting 0% · work 100%",
  );
  expect(renderToStaticMarkup(<LatencyReadout id="sink" latency={latency} />)).toContain(
    "Waiting 0% · work 10% · travel 90%",
  );
});

it("counts finished messages whole when samples weigh partial dots", () => {
  // A dot a broker delivers in parts adds up to one sample: 202.65 dots of samples read as 203 finished messages.
  const recorder = createLatencyRecorder();
  recordLatency(recorder, "Order", 0, 100, 10, undefined, undefined, 202.65);
  const latency = latencyMetrics(recorder);
  expect(latency.samples).toBe(202.65);
  expect(renderToStaticMarkup(<LatencyReadout id="sink" compact latency={latency} />)).toContain(
    "From 203 finished messages since restart.",
  );
  expect(renderToStaticMarkup(<LatencyReadout id="sink" latency={latency} />)).toContain("203 sampled messages");
});

it("never counts positive weighted samples as zero finished messages", () => {
  // A finished part of a dot weighs its share: 0.3 of a sample reads as less than one, not as zero.
  const recorder = createLatencyRecorder();
  recordLatency(recorder, "Order", 0, 100, 10, undefined, undefined, 0.3);
  const latency = latencyMetrics(recorder);
  const compact = renderToStaticMarkup(<LatencyReadout id="sink" compact latency={latency} />);
  expect(compact).toContain("From less than one finished message since restart.");
  expect(compact).not.toContain("From 0 ");
  expect(renderToStaticMarkup(<LatencyReadout id="sink" latency={latency} />)).toContain(
    "from less than one sampled message",
  );
  expect(latency.p50).toBeLessThan(200);
});
