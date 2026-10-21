import { createEngine } from "../sim/engine";
import { realNodeMetrics } from "../sim/units";
import { ResourceDetails, ResourceEstimate } from "./ResourceDetails";
import { kedaFixture } from "../lab/kedaFixture";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { analyzeCapacity } from "../sim/capacity";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AutoscalingFields } from "./AutoscalingFields";
import { cloudLesson, hpaLesson, resourceLesson, type AppServiceController } from "../model/autoscaling";
import { CloudScalerFields } from "./CloudScalerFields";
import { cloudFixture } from "../lab/cloudFixture";
import { reasonText } from "./scalingPlanText";
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

it.each([{ mode: "off" }, hpaLesson()])("does not copy a diagram to render fixed/HPA controls", (autoscaling) => {
  const readDiagram = vi.fn(() => kedaFixture());
  renderToStaticMarkup(
    <AutoscalingFields
      stencil="service.dotnet"
      props={{ resources: resourceLesson(), autoscaling }}
      readDiagram={readDiagram}
      set={() => {}}
    >
      <span />
    </AutoscalingFields>,
  );
  expect(readDiagram).not.toHaveBeenCalled();
});

it.each([false, true])("gates the busy metric without copying the diagram (W1: %s)", (supportsBusyThreads) => {
  const readDiagram = vi.fn(() => kedaFixture());
  const html = renderToStaticMarkup(
    <AutoscalingFields
      stencil="service.dotnet"
      props={{ resources: resourceLesson(), autoscaling: hpaLesson() }}
      readDiagram={readDiagram}
      supportsBusyThreads={supportsBusyThreads}
      set={() => {}}
    >
      <span />
    </AutoscalingFields>,
  );
  expect(readDiagram).not.toHaveBeenCalled();
  expect(html.includes("Busy threads (modelled custom metric)")).toBe(supportsBusyThreads);
});

it.each([undefined, { mode: "off" }, { mode: "unsupported", provider: "Kubernetes", reason: "Unsupported metric" }])(
  "keeps imported resources and the workload lesson accessible for %s scaling",
  (autoscaling) => {
    const resources = { ...resourceLesson(), modelRevision: "a2", preset: "kubernetes-unmeasured" };
    const html = renderToStaticMarkup(
      <AutoscalingFields stencil="k8s.deployment" props={{ resources, autoscaling }} set={() => {}}>
        <span />
      </AutoscalingFields>,
    );
    for (const testId of [
      "autoscaling-advanced",
      "autoscaling-use-lesson",
      "autoscaling-cpuMsPerMessage",
      "autoscaling-cpuRequestMilli",
      "autoscaling-memoryLimitMiB",
    ])
      expect(html).toContain(`data-testid="${testId}"`);
    expect(html).not.toContain('data-testid="autoscaling-target"');
    expect(html).not.toContain('data-testid="autoscaling-policy"');
  },
);

it("shows Cloud Run's CPU against its allocation when the service has a CPU limit but no request", () => {
  const d = cloudFixture("cloud-run");
  const r = d.nodes[1].props!.resources as Record<string, unknown>;
  delete r.cpuRequestMilli;
  (r.startup as { delayMs: number }).delayMs = 0;
  const e = createEngine({ seed: 1 });
  e.load(d);
  for (let second = 0; second < 20; second++) {
    e.inject("source", 40);
    e.step(1000);
  }
  const s = realNodeMetrics(e.frame().nodes.worker);
  expect(s.resources!.cpuAllocatedPct).toBeGreaterThan(0);
  const html = renderToStaticMarkup(<ResourceDetails metrics={s} cpuAllocated />);
  expect(html).toMatch(/CPU: [\d.]+% of allocated/);
});

it("explains the HPA pipeline's reasons for the adapters that share it", () => {
  for (const reason of ["stabilization", "policy"] as const)
    for (const adapter of ["cloudRun", "aca"] as const) {
      const text = reasonText({ at: 0, nextAt: 0, raw: 2, desired: 2, reason, adapter });
      expect(text).toBe(reasonText({ at: 0, nextAt: 0, raw: 2, desired: 2, reason }));
      expect(text).not.toBe("Unknown");
    }
});

it("names each App Service rule's own metric and shows no scale-out target a policy doesn't have", () => {
  const c = structuredClone(cloudLesson("app-service").controller) as AppServiceController;
  c.rules = c.rules.map((rule) => (rule.direction === "decrease" ? { ...rule, metric: "memory" } : rule));
  const render = (controller: AppServiceController) =>
    renderToStaticMarkup(
      <CloudScalerFields
        controller={controller}
        props={{}}
        nodeId="worker"
        commit={() => true}
        patch={() => true}
        targetRef={null}
        resourceFields={null}
        policyField={null}
      >
        <span />
      </CloudScalerFields>,
    );
  const both = render(c);
  expect(both).toContain("Scale out above CPU (% of instance)");
  expect(both).toContain("Scale in below memory (% of instance)");
  const inOnly = render({ ...c, rules: c.rules.filter((rule) => rule.direction === "decrease") });
  expect(inOnly).not.toContain('data-testid="autoscaling-target"');
  expect(inOnly).toContain("Scale in below memory (% of instance)");
});
