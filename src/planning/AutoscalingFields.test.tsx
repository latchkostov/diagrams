import { createEngine } from "../sim/engine";
import { realNodeMetrics } from "../sim/units";
import { ResourceDetails, ResourceEstimate } from "./ResourceDetails";
import { kedaFixture } from "../lab/kedaFixture";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { analyzeCapacity } from "../sim/capacity";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AutoscalingFields } from "./AutoscalingFields";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));
it.each([
  { resources: {}, autoscaling: hpaLesson() },
  { resources: resourceLesson(), autoscaling: { mode: "on", controller: {} } },
])("keeps malformed raw resource properties recoverable", (props) => {
  const html = renderToStaticMarkup(
    <AutoscalingFields stencil="service.dotnet" props={props} set={() => {}}>
      <span />
    </AutoscalingFields>,
  );
  expect(html).toContain('data-testid="autoscaling-invalid"');
  expect(html).toContain('data-testid="autoscaling-preset"');
});

it("labels an unbounded CPU assumption in the estimate", () => {
  const d = autoscalingFixture(),
    r = resourceLesson();
  delete r.cpuLimitMilli;
  d.nodes[1].props!.resources = r;
  const p = analyzeCapacity(d).nodes.worker.resourcePlan!;
  expect(renderToStaticMarkup(<ResourceEstimate plan={p} />)).toContain('data-testid="autoscaling-unbounded"');
});

it("keeps a rolling history spread over the chart after ten minutes", () => {
  const e = createEngine();
  e.load(autoscalingFixture());
  const s = realNodeMetrics(e.frame().nodes.worker);
  s.fleet = {
    desired: 2,
    ready: 2,
    starting: 0,
    draining: 0,
    history: [
      { time: 1_500_000, desired: 1, ready: 1, starting: 0, draining: 0 },
      { time: 1_501_000, desired: 2, ready: 2, starting: 0, draining: 0 },
    ],
  };
  expect(renderToStaticMarkup(<ResourceDetails metrics={s} />)).toMatch(/points="0,[^"]*260,/);
});

it("does not turn an unavailable fallback broker metric into zero", () => {
  const d = kedaFixture();
  const e = createEngine();
  e.load(d);
  const s = realNodeMetrics(e.frame().nodes.worker);
  s.fleet!.decision = {
    at: 1000,
    nextAt: 2000,
    raw: 3,
    desired: 3,
    reason: "fallback",
    broker: "uploads",
    active: false,
  };
  const html = renderToStaticMarkup(<ResourceDetails metrics={s} />);
  expect(html).toContain("Broker metric: Unknown messages");
  expect(html).not.toContain("Broker metric: 0 messages");
});
