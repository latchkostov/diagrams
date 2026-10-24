import busy from "../examples/scale-on-busy-threads.json";
import type { DiagramFile } from "../model/types";
import type { HpaConfig } from "../model/autoscaling";
import { expect, it } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import { buildContext } from "./context";
import { runChecks } from "./run";
import { capacity } from "./rules/capacity";

it("indexes resource-warning targets once before filtering capacity candidates", () => {
  const d = autoscalingFixture(),
    worker = d.nodes[1];
  d.edges = [];
  d.nodes = Array.from({ length: 1000 }, (_, i) => ({
    ...worker,
    id: `worker-${i}`,
    props: { autoscaling: { mode: "off" }, resources: { ...resourceLesson(), memoryLimitMiB: 1 } },
  }));
  const ctx = buildContext(d),
    analysis = ctx.capacity();
  let reads = 0;
  for (const n of Object.values(analysis.nodes)) {
    const id = n.id;
    Object.defineProperty(n, "id", {
      get: () => {
        reads++;
        return id;
      },
    });
  }
  expect(capacity.detect(ctx)).toHaveLength(1000);
  expect(reads).toBeLessThan(10 * d.nodes.length);
});

it.each(["disabled", "unreachable", "tolerance", "maxed"])(
  "keeps overload visible when busy-thread scaling is %s",
  (kind) => {
    const d = structuredClone(busy) as DiagramFile;
    d.simulations = [];
    const caller = d.nodes.find((n) => n.id === "caller")!;
    const a = caller.props!.autoscaling as HpaConfig;
    a.controller.settings.metrics = [
      {
        source: { kind: "pods", metric: "busyThreads" },
        target: { kind: "averageValue", value: 11 },
        windowMs: 1000,
        metricDelayMs: 0,
      },
    ];
    expect(capacity.detect(buildContext(d)).find((f) => f.target === "caller")).toBeUndefined();
    if (kind === "disabled") a.controller.settings.up.selectPolicy = "Disabled";
    else if (kind === "maxed") a.controller.maxReplicas = a.controller.initialReplicas;
    else a.controller.settings.metrics[0].target = { kind: "averageValue", value: kind === "tolerance" ? 15 : 32 };
    const finding = runChecks(d).findings.find((f) => f.target === "caller");
    if (kind === "maxed") expect(finding?.resourceFinding).toMatchObject({ kind: "max", max: 4 });
    else expect(finding).toMatchObject({ rule: "blocked-threads", title: "Decision service runs out of threads" });
  },
);
