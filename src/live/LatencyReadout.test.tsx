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
