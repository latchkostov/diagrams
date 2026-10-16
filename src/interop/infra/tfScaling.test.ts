import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AutoscalingConfig, ComputeResources } from "../../model/autoscaling";
import { scalingReasonCode } from "../../model/scalingReason";
import type { DiagramFile } from "../../model/types";
import { createEngine } from "../../sim/engine";
import { countingReads, growth, GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";
import { validateDiagram } from "../native";
import { formatImportMessage } from "../ui/importMessages";
import type { ImportReport } from "./graph";
import { importTerraform } from "./pipeline";
import { readTerraform } from "./terraform";
import {
  acaScaling,
  albNames,
  appServiceScaling,
  cloudRunV2Scaling,
  ecsCpuMilli,
  ecsMemoryMiB,
  ecsScaling,
  isoDurationMs,
  ScalingUnsupported,
  TF_SCALING_LIMITS,
  type TfBlock,
} from "./tfScaling";

// Terraform scaling resources and blocks → A3 cloud policies (tfScaling.ts, wired in terraform.ts): the plan fixture
// end to end, value joins in states, every unsupported path with its reason category, no secret out, and hostile
// input bounded by counted reads and same-run growth.

const FIXTURE = readFileSync("tests/fixtures/imports/terraform/autoscaling-a3.json", "utf8");

interface Res {
  type: string;
  name: string;
  values?: Record<string, unknown>;
  sensitive?: Record<string, unknown>;
  index?: number;
}
const state = (resources: Res[]) =>
  JSON.stringify({
    format_version: "1.0",
    terraform_version: "1.9.5",
    values: {
      root_module: {
        resources: resources.map((r) => ({
          address: `${r.type}.${r.name}${r.index === undefined ? "" : `[${r.index}]`}`,
          mode: "managed",
          type: r.type,
          name: r.name,
          ...(r.index === undefined ? {} : { index: r.index }),
          provider_name: "registry.terraform.io/hashicorp/aws",
          values: r.values ?? {},
          sensitive_values: r.sensitive ?? {},
        })),
      },
    },
  });
function imported(text: string, name = "state.json"): { diagram: DiagramFile; report: ImportReport } {
  const outcome = importTerraform([{ name, text }]);
  if (outcome.ok !== true || !outcome.report) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  return { diagram: outcome.diagram, report: outcome.report };
}
const tf = (resources: Res[]) => imported(state(resources));
const node = (d: DiagramFile, id: string) => {
  const n = d.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`no node ${id}: ${d.nodes.map((x) => x.id).join(", ")}`);
  return n;
};
const scalingOf = (d: DiagramFile, id: string) => node(d, id).props?.autoscaling as AutoscalingConfig | undefined;
const resourcesOf = (d: DiagramFile, id: string) => node(d, id).props?.resources as ComputeResources | undefined;
const controllerOf = (d: DiagramFile, id: string) => {
  const a = scalingOf(d, id);
  if (a?.mode !== "on") throw new Error(`not on: ${JSON.stringify(a)}`);
  return a.controller;
};
/** A diagram that validates as a file and loads into the engine. */
function plays(d: DiagramFile) {
  const v = validateDiagram(JSON.parse(JSON.stringify(d)));
  expect(v).toMatchObject({ ok: true });
  const e = createEngine();
  expect(() => e.load(d)).not.toThrow();
  e.setTraffic(true);
  expect(() => e.step(5_000)).not.toThrow();
}
/** The node's policy is unsupported with a reason in category `code`, and its topology stays drawn. */
function refused(d: DiagramFile, id: string, code: string, reason?: RegExp) {
  const a = scalingOf(d, id);
  expect(a?.mode, JSON.stringify(a)).toBe("unsupported");
  if (a?.mode !== "unsupported") return;
  expect(scalingReasonCode(a.reason), a.reason).toBe(code);
  if (reason) expect(a.reason).toMatch(reason);
  expect(validateDiagram(JSON.parse(JSON.stringify(d)))).toMatchObject({ ok: true });
}
const without = (rs: Res[], ...names: string[]) => rs.filter((r) => !names.includes(r.name));
/** A copy with the resource `name` (or `type.name`, where names repeat across types) changed. */
const edit = (rs: Res[], name: string, change: (values: Record<string, unknown>) => void): Res[] =>
  rs.map((r) => {
    if (r.name !== name && `${r.type}.${r.name}` !== name) return r;
    const values = structuredClone(r.values ?? {});
    change(values);
    return { ...r, values };
  });
const block = (values: unknown, sensitive: unknown = {}): TfBlock => ({ values, sensitive });
const reasonOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ScalingUnsupported) return error.message;
    throw error;
  }
  return undefined;
};

describe("Terraform scaling: the plan fixture", () => {
  const { diagram: d, report } = imported(FIXTURE, "autoscaling-a3.json");

  it("maps ECS target tracking, ALB requests per target and a memory step alarm into one controller", () => {
    expect(controllerOf(d, "api")).toEqual({
      kind: "ecs",
      minReplicas: 1,
      maxReplicas: 12,
      // The service's desired count, inside the range.
      initialReplicas: 2,
      metricPeriodMs: 60_000,
      alarm: { outPeriods: 3, inPeriods: 15, inMargin: 0.1 },
      targetTracking: [
        { metric: "cpu", target: 60, scaleOutCooldownMs: 30_000, scaleInCooldownMs: 120_000, disableScaleIn: false },
        {
          metric: "albRequestCountPerTarget",
          target: 800,
          source: { node: "web" },
          // Unset: Application Auto Scaling's 300 s for ECS.
          scaleOutCooldownMs: 300_000,
          scaleInCooldownMs: 300_000,
          disableScaleIn: false,
        },
      ],
      stepScaling: [
        {
          metric: "memory",
          operator: "GreaterThanOrEqualToThreshold",
          threshold: 75,
          evaluationPeriods: 2,
          adjustmentType: "ChangeInCapacity",
          steps: [
            { lower: 0, upper: 20, adjustment: 1 },
            { lower: 20, adjustment: 3 },
          ],
          cooldownMs: 60_000,
        },
      ],
    });
    expect(scalingOf(d, "api")).toMatchObject({ mode: "on", modelRevision: "a3", preset: "ecs-alb" });
    // The ALB is the node the load balancer is, and it routes requests to the service.
    expect(node(d, "web").stencil).toBe("aws.elb");
    expect(d.edges).toContainEqual(expect.objectContaining({ from: "web", to: "api", kind: "sync" }));
  });

  it("sizes ECS from the task definition: 512 CPU units are 500m, memory in MiB, requests equal to the size", () => {
    expect(resourcesOf(d, "api")).toEqual({
      preset: "cloud-unmeasured",
      presetRevision: "1",
      modelRevision: "a2",
      cpuMsPerMessage: 0,
      baselineMemoryMiB: 0,
      memoryMiBPerMessage: 0,
      cpuLimitMilli: 500,
      cpuRequestMilli: 500,
      memoryLimitMiB: 1024,
      memoryRequestMiB: 1024,
      startup: { delayMs: 5000, jitterFraction: 0 },
      terminationGraceMs: 30_000,
    });
  });

  it("maps a Container App's range, cadence, HTTP rule and Service Bus rule bound to the queue node", () => {
    const c = controllerOf(d, "worker");
    expect(c).toMatchObject({
      kind: "aca",
      minReplicas: 0,
      initialReplicas: 0,
      maxReplicas: 15,
      pollingMs: 15_000,
      cooldownMs: 120_000,
      http: { concurrentRequests: 50 },
      triggers: [
        { type: "azure-servicebus", source: { node: "orders" }, target: 20, activation: 0, useCachedMetrics: false },
      ],
    });
    expect(node(d, "orders").stencil).toBe("azure.service-bus.queue");
    // 0.5 cores and 1Gi, as limits.
    expect(resourcesOf(d, "worker")).toMatchObject({
      preset: "cloud-unmeasured",
      cpuLimitMilli: 500,
      memoryLimitMiB: 1024,
    });
    expect(resourcesOf(d, "worker")?.cpuRequestMilli).toBeUndefined();
  });

  it("maps Monitor autoscale on the web app's own plan: capacity and rules, ISO windows in ms", () => {
    expect(controllerOf(d, "storefront")).toEqual({
      kind: "appService",
      minReplicas: 1,
      initialReplicas: 2,
      maxReplicas: 6,
      evaluationMs: 60_000,
      rules: [
        {
          metric: "cpu",
          operator: "GreaterThan",
          threshold: 70,
          windowMs: 300_000,
          direction: "increase",
          changeType: "ChangeCount",
          value: 1,
          cooldownMs: 300_000,
        },
        {
          metric: "cpu",
          operator: "LessThan",
          threshold: 30,
          windowMs: 600_000,
          direction: "decrease",
          changeType: "ChangeCount",
          value: 1,
          cooldownMs: 300_000,
        },
      ],
    });
  });

  it("maps Cloud Run v2 and v1: range, the per-instance concurrency on the node, CPU and memory limits", () => {
    expect(controllerOf(d, "checkout")).toMatchObject({
      kind: "cloudRun",
      minReplicas: 1,
      initialReplicas: 1,
      maxReplicas: 40,
      targetConcurrencyPct: 60,
      targetCpuPct: 60,
    });
    expect(node(d, "checkout").props?.concurrency).toBe(50);
    expect(resourcesOf(d, "checkout")).toMatchObject({ cpuLimitMilli: 2000, memoryLimitMiB: 1024 });
    expect(controllerOf(d, "legacy")).toMatchObject({ kind: "cloudRun", minReplicas: 0, maxReplicas: 5 });
    expect(node(d, "legacy").props?.concurrency).toBe(10);
    expect(resourcesOf(d, "legacy")).toMatchObject({ cpuLimitMilli: 1000, memoryLimitMiB: 512 });
  });

  it("is a planning diagram that validates and plays, and the report says each policy was mapped", () => {
    expect(d.format).toBe("diagrams/v2");
    expect(d.planning).toEqual({ revision: "p3-a1" });
    plays(d);
    const notes = report.notes.map(formatImportMessage).join("\n");
    for (const kind of ["ECS", "Container Apps", "App Service", "Cloud Run"]) expect(notes).toContain(`${kind} policy`);
    expect(notes).not.toMatch(/not simulated/);
  });

  it("never carries a secret, an authentication parameter, a connection string, a URL or an address out", () => {
    const out = JSON.stringify(imported(FIXTURE, "autoscaling-a3.json"));
    for (const secret of [
      "task-env-secret-4711",
      "aca-secret-0815",
      "SharedAccessKey",
      "Endpoint=",
      "sb-conn-secret",
      "trigger_parameter",
      '"connection"',
      "notify-secret-99",
      "hooks.example.com",
      "ops@example.com",
      "cloud-run-env-secret-42",
      "variable-secret-1234",
      "orders-bus",
      "cloudsql",
      "DB_PASSWORD",
    ])
      expect(out, secret).not.toContain(secret);
  });
});

// ------------------------------------------------ ECS from a state: joins by resource id, ARN and names
const LB = "arn:aws:elasticloadbalancing:eu-west-1:1:loadbalancer/app/web/50dc6c495c0c9188";
const TG = "arn:aws:elasticloadbalancing:eu-west-1:1:targetgroup/api/73e2d6bc24d8a067";
const POLICY = (n: string) =>
  `arn:aws:autoscaling:eu-west-1:1:scalingPolicy:0a1b:resource/ecs/service/main/api:policyName/${n}`;
const TD = "arn:aws:ecs:eu-west-1:1:task-definition/api:3";
const ecsTarget = (name = "api", values: Record<string, unknown> = {}): Res => ({
  type: "aws_appautoscaling_target",
  name,
  values: {
    service_namespace: "ecs",
    scalable_dimension: "ecs:service:DesiredCount",
    resource_id: "service/main/api",
    min_capacity: 2,
    max_capacity: 20,
    role_arn: "arn:aws:iam::1:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/x",
    suspended_state: [
      { dynamic_scaling_in_suspended: false, dynamic_scaling_out_suspended: false, scheduled_scaling_suspended: false },
    ],
    ...values,
  },
});
const ecsBase = (): Res[] => [
  { type: "aws_lb", name: "web", values: { name: "web", arn: LB } },
  { type: "aws_lb_target_group", name: "api", values: { name: "api", arn: TG } },
  {
    type: "aws_lb_listener",
    name: "http",
    values: { load_balancer_arn: LB, default_action: [{ type: "forward", target_group_arn: TG }] },
  },
  { type: "aws_ecs_task_definition", name: "api", values: { family: "api", arn: TD, cpu: "1 vCPU", memory: "2 GB" } },
  {
    type: "aws_ecs_service",
    name: "api",
    values: {
      name: "api",
      cluster: "arn:aws:ecs:eu-west-1:1:cluster/main",
      desired_count: 30,
      task_definition: TD,
      load_balancer: [{ target_group_arn: TG }],
    },
  },
  ecsTarget(),
  {
    type: "aws_appautoscaling_policy",
    name: "alb",
    values: {
      name: "alb",
      arn: POLICY("alb"),
      policy_type: "TargetTrackingScaling",
      resource_id: "service/main/api",
      service_namespace: "ecs",
      scalable_dimension: "ecs:service:DesiredCount",
      alarm_arns: ["arn:aws:cloudwatch:eu-west-1:1:alarm:TargetTracking-x"],
      step_scaling_policy_configuration: [],
      predictive_scaling_policy_configuration: [],
      target_tracking_scaling_policy_configuration: [
        {
          target_value: 1000,
          disable_scale_in: true,
          scale_in_cooldown: null,
          scale_out_cooldown: 0,
          customized_metric_specification: [],
          predefined_metric_specification: [
            {
              predefined_metric_type: "ALBRequestCountPerTarget",
              resource_label: "app/web/50dc6c495c0c9188/targetgroup/api/73e2d6bc24d8a067",
            },
          ],
        },
      ],
    },
  },
  {
    type: "aws_appautoscaling_policy",
    name: "burst",
    values: {
      name: "burst",
      arn: POLICY("burst"),
      // The provider's default policy type is StepScaling.
      resource_id: "service/main/api",
      service_namespace: "ecs",
      step_scaling_policy_configuration: [
        {
          adjustment_type: "PercentChangeInCapacity",
          min_adjustment_magnitude: 2,
          cooldown: 120,
          metric_aggregation_type: "Average",
          step_adjustment: [
            { metric_interval_lower_bound: "0", metric_interval_upper_bound: "", scaling_adjustment: 50 },
          ],
        },
      ],
      target_tracking_scaling_policy_configuration: [],
    },
  },
  {
    type: "aws_cloudwatch_metric_alarm",
    name: "requests_high",
    values: {
      alarm_name: "requests-high",
      arn: "arn:aws:cloudwatch:eu-west-1:1:alarm:requests-high",
      alarm_actions: [POLICY("burst"), "arn:aws:sns:eu-west-1:1:ops"],
      ok_actions: ["arn:aws:sns:eu-west-1:1:ops"],
      namespace: "AWS/ApplicationELB",
      metric_name: "RequestCount",
      statistic: "Sum",
      period: 60,
      evaluation_periods: 3,
      datapoints_to_alarm: 3,
      threshold: 5000,
      comparison_operator: "GreaterThanThreshold",
      dimensions: { LoadBalancer: "app/web/50dc6c495c0c9188" },
      treat_missing_data: "missing",
      actions_enabled: true,
      metric_query: [],
      extended_statistic: "",
      tags: { team: "shop" },
    },
  },
];

describe("Terraform scaling: ECS", () => {
  it("joins a state by resource id, policy ARN and ALB names; percent steps and both ALB metrics", () => {
    const { diagram: d } = tf(ecsBase());
    expect(controllerOf(d, "api")).toEqual({
      kind: "ecs",
      minReplicas: 2,
      // A desired count above the maximum starts at the maximum.
      initialReplicas: 20,
      maxReplicas: 20,
      metricPeriodMs: 60_000,
      alarm: { outPeriods: 3, inPeriods: 15, inMargin: 0.1 },
      targetTracking: [
        {
          metric: "albRequestCountPerTarget",
          target: 1000,
          source: { node: "web" },
          scaleOutCooldownMs: 0,
          scaleInCooldownMs: 300_000,
          disableScaleIn: true,
        },
      ],
      stepScaling: [
        {
          metric: "albRequestCount",
          source: { node: "web" },
          operator: "GreaterThanThreshold",
          threshold: 5000,
          evaluationPeriods: 3,
          adjustmentType: "PercentChangeInCapacity",
          steps: [{ lower: 0, adjustment: 50 }],
          minAdjustmentMagnitude: 2,
          cooldownMs: 120_000,
        },
      ],
    });
    // "1 vCPU" and "2 GB": 1000m and 2048 MiB.
    expect(resourcesOf(d, "api")).toMatchObject({ cpuLimitMilli: 1000, memoryLimitMiB: 2048, cpuRequestMilli: 1000 });
    plays(d);
  });

  it("a step policy alone is the step lesson; an alarm's own period becomes the metric period", () => {
    const rs = edit(
      edit(without(ecsBase(), "alb"), "requests_high", (v) => {
        Object.assign(v, {
          namespace: "AWS/ECS",
          metric_name: "CPUUtilization",
          statistic: "Average",
          period: 30,
          threshold: 80,
          dimensions: { ClusterName: "main", ServiceName: "api" },
        });
      }),
      "burst",
      (v) => {
        (v.step_scaling_policy_configuration as Record<string, unknown>[])[0].adjustment_type = "ChangeInCapacity";
        delete (v.step_scaling_policy_configuration as Record<string, unknown>[])[0].min_adjustment_magnitude;
      },
    );
    const { diagram: d } = tf(rs);
    expect(scalingOf(d, "api")).toMatchObject({ preset: "ecs-step" });
    expect(controllerOf(d, "api")).toMatchObject({
      metricPeriodMs: 30_000,
      targetTracking: [],
      stepScaling: [
        { metric: "cpu", threshold: 80, adjustmentType: "ChangeInCapacity", steps: [{ lower: 0, adjustment: 50 }] },
      ],
    });
    plays(d);
  });

  it("a service without a task size keeps the unmeasured preset with no limits", () => {
    const { diagram: d } = tf(ecsBase().filter((r) => r.type !== "aws_ecs_task_definition"));
    expect(resourcesOf(d, "api")).toMatchObject({ preset: "cloud-unmeasured" });
    expect(resourcesOf(d, "api")?.cpuLimitMilli).toBeUndefined();
  });

  it.each([
    [
      "a customized metric",
      (rs: Res[]) =>
        edit(rs, "alb", (v) => {
          const c = (v.target_tracking_scaling_policy_configuration as Record<string, unknown>[])[0];
          c.customized_metric_specification = [{ metric_name: "Backlog", namespace: "Shop", statistic: "Average" }];
          c.predefined_metric_specification = [];
        }),
      "metric",
      /Customized/,
    ],
    ["a step policy no alarm invokes", (rs: Res[]) => without(rs, "requests_high"), "metric", /no CloudWatch alarm/],
    [
      "an unknown alarm field",
      (rs: Res[]) => edit(rs, "requests_high", (v) => (v.evaluate_low_sample_count_percentiles = "ignore")),
      "fields",
      /Unsupported fields in aws_cloudwatch_metric_alarm$/,
    ],
    [
      "an unknown target field",
      (rs: Res[]) => edit(rs, "aws_appautoscaling_target.api", (v) => (v.scaling_mode = "fast")),
      "fields",
      undefined,
    ],
    [
      "a capacity past the simulator",
      (rs: Res[]) => edit(rs, "aws_appautoscaling_target.api", (v) => (v.max_capacity = 20_000)),
      "bounds",
      /bounds/,
    ],
    [
      "a cooldown past ten minutes",
      (rs: Res[]) =>
        edit(
          rs,
          "burst",
          (v) => ((v.step_scaling_policy_configuration as Record<string, unknown>[])[0].cooldown = 3600),
        ),
      "bounds",
      undefined,
    ],
    [
      "a fractional capacity",
      (rs: Res[]) => edit(rs, "aws_appautoscaling_target.api", (v) => (v.min_capacity = 1.5)),
      "bounds",
      /numeric/,
    ],
    ["two scalable targets", (rs: Res[]) => [...rs, ecsTarget("again")], "conflict", /Conflicting/],
    ["an ALB that routes nothing to the service", (rs: Res[]) => without(rs, "http"), "binding", /ALB binding/],
    [
      "a metric math alarm",
      (rs: Res[]) =>
        edit(rs, "requests_high", (v) => (v.metric_query = [{ id: "e1", expression: "m1/m2", return_data: true }])),
      "metric",
      /metric math/,
    ],
    [
      "an ALB alarm that averages",
      (rs: Res[]) => edit(rs, "requests_high", (v) => (v.statistic = "Average")),
      "metric",
      /Sum over a 60 s period/,
    ],
    [
      "an M-of-N alarm",
      (rs: Res[]) => edit(rs, "requests_high", (v) => (v.datapoints_to_alarm = 2)),
      "metric",
      /M-of-N/,
    ],
    [
      "an ECS alarm on another service",
      (rs: Res[]) =>
        edit(rs, "requests_high", (v) =>
          Object.assign(v, {
            namespace: "AWS/ECS",
            metric_name: "CPUUtilization",
            statistic: "Average",
            dimensions: { ClusterName: "main", ServiceName: "billing" },
          }),
        ),
      "metric",
      /another service/,
    ],
    [
      "policies reading different periods",
      (rs: Res[]) =>
        edit(rs, "requests_high", (v) =>
          Object.assign(v, {
            namespace: "AWS/ECS",
            metric_name: "CPUUtilization",
            statistic: "Average",
            period: 300,
            dimensions: { ServiceName: "api" },
          }),
        ),
      "metric",
      /different metric periods/,
    ],
    [
      "a scheduled action",
      (rs: Res[]) => [
        ...rs,
        {
          type: "aws_appautoscaling_scheduled_action",
          name: "night",
          values: { resource_id: "service/main/api", service_namespace: "ecs", schedule: "cron(0 0 * * ? *)" },
        },
      ],
      "metric",
      /Scheduled/,
    ],
    [
      "a suspended target",
      (rs: Res[]) =>
        edit(rs, "aws_appautoscaling_target.api", (v) => {
          v.suspended_state = [
            {
              dynamic_scaling_in_suspended: true,
              dynamic_scaling_out_suspended: false,
              scheduled_scaling_suspended: false,
            },
          ];
        }),
      "metric",
      /Suspended/,
    ],
    [
      "a sensitive threshold",
      (rs: Res[]) => rs.map((r) => (r.name === "requests_high" ? { ...r, sensitive: { threshold: true } } : r)),
      "metric",
      /Sensitive/,
    ],
    [
      "a policy without a scalable target",
      (rs: Res[]) => rs.filter((r) => r.type !== "aws_appautoscaling_target"),
      "metric",
      /no scalable target/,
    ],
    [
      "a service drawn for several instances",
      (rs: Res[]) => rs.flatMap((r) => (r.type === "aws_ecs_service" ? [0, 1].map((index) => ({ ...r, index })) : [r])),
      "conflict",
      /several instances/,
    ],
  ])("refuses %s, keeping the topology", (_, change, code, reason) => {
    const { diagram: d } = tf(change(ecsBase()));
    refused(d, "api", code, reason);
    expect(node(d, "web").stencil).toBe("aws.elb");
    expect(resourcesOf(d, "api")).toBeUndefined();
  });

  it("refuses more than eight policies of one kind", () => {
    const rs = ecsBase();
    const alarm = rs.find((r) => r.name === "requests_high")!;
    const more = Array.from({ length: TF_SCALING_LIMITS.maxPolicies + 1 }, (_, i) => ({
      ...alarm,
      name: `requests_high_${i}`,
    }));
    const { diagram: d } = tf([...rs, ...more]);
    refused(d, "api", "bounds", /exceed simulator bounds/);
  });

  it("an unsupported policy keeps its node's request route and the rest of the diagram", () => {
    const before = tf(ecsBase()).diagram;
    const after = tf(without(ecsBase(), "requests_high")).diagram;
    expect(after.nodes.map((n) => n.id)).toEqual(before.nodes.map((n) => n.id));
    expect(after.edges).toEqual(before.edges);
  });
});

// ------------------------------------------------ Container Apps
const NS = "/subscriptions/0/resourceGroups/shop/providers/Microsoft.ServiceBus/namespaces/orders-bus";
const NS2 = "/subscriptions/0/resourceGroups/test/providers/Microsoft.ServiceBus/namespaces/test-bus";
const acaBase = (rules: unknown[] = [], template: Record<string, unknown> = {}): Res[] => [
  {
    type: "azurerm_servicebus_queue",
    name: "orders",
    values: { name: "orders", id: `${NS}/queues/orders`, namespace_id: NS },
  },
  {
    type: "azurerm_servicebus_queue",
    name: "orders_test",
    values: { name: "orders", id: `${NS2}/queues/orders`, namespace_id: NS2 },
  },
  {
    type: "azurerm_container_app",
    name: "worker",
    values: {
      name: "worker",
      secret: [{ name: "conn", value: "Endpoint=sb://x/;SharedAccessKey=aca-state-secret" }],
      template: [
        {
          max_replicas: 30,
          min_replicas: 1,
          termination_grace_period_seconds: 45,
          container: [{ name: "worker", image: "acme/w:1", cpu: 0.25, memory: "0.5Gi" }],
          custom_scale_rule: rules.length
            ? rules
            : [
                {
                  name: "orders",
                  custom_rule_type: "azure-servicebus",
                  metadata: {
                    queueName: "orders",
                    namespace: "orders-bus",
                    messageCount: "10",
                    activationMessageCount: "2",
                  },
                  authentication: [{ secret_name: "conn", trigger_parameter: "connection" }],
                },
              ],
          ...template,
        },
      ],
    },
    sensitive: { secret: true },
  },
];
describe("Terraform scaling: Container Apps", () => {
  it("binds a Service Bus rule to the queue in the namespace it names; no HTTP rule unless written", () => {
    const { diagram: d } = tf(acaBase());
    // The orders queue of orders-bus (in resource group shop), not the one of the same name in test-bus.
    const shop = d.groups?.find((g) => g.label === "shop")?.id;
    const queue = d.nodes.find((n) => n.label === "orders" && n.group === shop)!;
    expect(d.nodes.filter((n) => n.label === "orders")).toHaveLength(2);
    expect(scalingOf(d, "worker")).toMatchObject({ preset: "aca-event" });
    const c = controllerOf(d, "worker");
    expect(c).toMatchObject({
      kind: "aca",
      minReplicas: 1,
      initialReplicas: 1,
      maxReplicas: 30,
      pollingMs: 30_000,
      cooldownMs: 300_000,
      triggers: [{ type: "azure-servicebus", source: { node: queue.id }, target: 10, activation: 2 }],
    });
    expect("http" in c).toBe(false);
    expect(resourcesOf(d, "worker")).toMatchObject({
      cpuLimitMilli: 250,
      memoryLimitMiB: 512,
      terminationGraceMs: 45_000,
    });
    plays(d);
    expect(JSON.stringify(d)).not.toMatch(/aca-state-secret|SharedAccessKey|conn"/);
  });

  it("a topic rule binds the topic with its subscription as the group, valid where a route carries that group", () => {
    const topicRule = [
      {
        name: "billing",
        custom_rule_type: "azure-servicebus",
        metadata: { topicName: "events", subscriptionName: "billing" },
      },
    ];
    const rs: Res[] = [
      ...acaBase(topicRule),
      {
        type: "azurerm_servicebus_topic",
        name: "events",
        values: { name: "events", id: `${NS}/topics/events`, namespace_id: NS },
      },
      {
        type: "azurerm_servicebus_subscription",
        name: "billing",
        values: { name: "billing", id: `${NS}/topics/events/subscriptions/billing`, topic_id: `${NS}/topics/events` },
      },
    ];
    // No route from the topic to the app: the binding is reported missing (map.ts), the policy not run.
    const missing = tf(rs).diagram;
    refused(missing, "worker", "binding", /binding omitted/);
    // The app's identity receives from the subscription: a route with the subscription's group.
    const routed = tf(
      edit(
        [
          ...rs,
          {
            type: "azurerm_role_assignment",
            name: "receive",
            values: {
              scope: `${NS}/topics/events/subscriptions/billing`,
              principal_id: "p-1",
              role_definition_name: "Azure Service Bus Data Receiver",
            },
          },
        ],
        "worker",
        (v) => (v.identity = [{ type: "SystemAssigned", principal_id: "p-1" }]),
      ),
    ).diagram;
    expect(controllerOf(routed, "worker")).toMatchObject({
      triggers: [{ source: { node: "events", group: "billing" }, target: 5, activation: 0 }],
    });
    plays(routed);
  });

  it.each([
    ["a TCP rule", { tcp_scale_rule: [{ name: "tcp", concurrent_requests: "10" }] }, [], "metric", /TCP/],
    [
      "two HTTP rules",
      { http_scale_rule: [{ concurrent_requests: "5" }, { concurrent_requests: "9" }] },
      [],
      "metric",
      /one HTTP/,
    ],
    ["an unknown template field", { revision_mode_x: "fast" }, [], "fields", /ACA template/],
    [
      "a second container",
      {
        container: [
          { name: "a", cpu: 0.25, memory: "0.5Gi" },
          { name: "b", cpu: 0.25, memory: "0.5Gi" },
        ],
      },
      [],
      "container",
      /Multi-container/,
    ],
    ["a polling interval past ten minutes", { polling_interval_in_seconds: 3600 }, [], "bounds", undefined],
    [
      "another custom rule type",
      {},
      [{ name: "kafka", custom_rule_type: "kafka", metadata: { topic: "orders" } }],
      "metric",
      /custom scale rule type/,
    ],
    [
      "unknown Service Bus metadata",
      {},
      [{ name: "q", custom_rule_type: "azure-servicebus", metadata: { queueName: "orders", cloud: "Private" } }],
      "fields",
      /Service Bus metadata/,
    ],
    [
      "a queue that isn't drawn",
      {},
      [{ name: "q", custom_rule_type: "azure-servicebus", metadata: { queueName: "payments" } }],
      "binding",
      /not found/,
    ],
    [
      "a queue name shared by two namespaces, none named",
      {},
      [{ name: "q", custom_rule_type: "azure-servicebus", metadata: { queueName: "orders" } }],
      "binding",
      /not found/,
    ],
  ])("refuses %s", (_, template, rules, code, reason) => {
    const { diagram: d } = tf(acaBase(rules, template));
    refused(d, "worker", code, reason);
    expect(d.nodes.filter((n) => n.stencil === "azure.service-bus.queue")).toHaveLength(2);
  });

  it("an app whose template says nothing about scaling is left as drawn", () => {
    const rs = edit(acaBase(), "worker", (v) => {
      v.template = [{ container: [{ name: "w", cpu: 0.5, memory: "1Gi" }] }];
    });
    const { diagram: d } = tf(rs);
    expect(node(d, "worker").props).toBeUndefined();
    expect(d.format).not.toBe("diagrams/v2");
  });
});

// ------------------------------------------------ App Service
const PLAN = "/subscriptions/0/resourceGroups/shop/providers/Microsoft.Web/serverFarms/web-plan";
const monitorRule = (over: Record<string, unknown> = {}, action: Record<string, unknown> = {}) => ({
  metric_trigger: [
    {
      metric_name: "HttpQueueLength",
      metric_resource_id: PLAN,
      operator: "GreaterThanOrEqual",
      statistic: "Average",
      time_aggregation: "Average",
      time_grain: "PT1M",
      time_window: "PT2M",
      threshold: 25,
      divide_by_instance_count: false,
      dimensions: [],
      ...over,
    },
  ],
  scale_action: [{ direction: "Increase", type: "PercentChangeCount", value: 50, cooldown: "PT3M", ...action }],
});
const appBase = (profile: Record<string, unknown> = {}, setting: Record<string, unknown> = {}): Res[] => [
  { type: "azurerm_service_plan", name: "plan", values: { name: "web-plan", id: PLAN } },
  { type: "azurerm_linux_web_app", name: "shop", values: { name: "shop", service_plan_id: PLAN } },
  {
    type: "azurerm_monitor_autoscale_setting",
    name: "scale",
    values: {
      name: "scale",
      target_resource_id: PLAN,
      enabled: true,
      notification: [{ email: [{ custom_emails: ["ops@example.com"] }] }],
      profile: [
        {
          name: "default",
          capacity: [{ default: 3, minimum: 2, maximum: 8 }],
          rule: [
            monitorRule(),
            monitorRule(
              { metric_name: "MemoryPercentage", operator: "LessThanOrEqual", threshold: 40, time_window: "PT10M" },
              { direction: "Decrease", type: "ExactCount", value: 2, cooldown: "PT10M" },
            ),
          ],
          recurrence: [],
          fixed_date: [],
          ...profile,
        },
      ],
      ...setting,
    },
  },
];
describe("Terraform scaling: App Service", () => {
  it("maps the plan's profile by its id: capacity, HTTP queue and memory rules, change types and ISO durations", () => {
    const { diagram: d } = tf(appBase());
    expect(controllerOf(d, "shop")).toEqual({
      kind: "appService",
      minReplicas: 2,
      initialReplicas: 3,
      maxReplicas: 8,
      evaluationMs: 60_000,
      rules: [
        {
          metric: "httpQueue",
          operator: "GreaterThanOrEqual",
          threshold: 25,
          windowMs: 120_000,
          direction: "increase",
          changeType: "PercentChangeCount",
          value: 50,
          cooldownMs: 180_000,
        },
        {
          metric: "memory",
          operator: "LessThanOrEqual",
          threshold: 40,
          windowMs: 600_000,
          direction: "decrease",
          changeType: "ExactCount",
          value: 2,
          cooldownMs: 600_000,
        },
      ],
    });
    plays(d);
    expect(JSON.stringify(d)).not.toContain("ops@example.com");
  });

  it("a shared plan scales no app: each one on it is told its capacity has no one owner", () => {
    const { diagram: d } = tf([
      ...appBase(),
      { type: "azurerm_linux_web_app", name: "admin", values: { name: "admin", service_plan_id: PLAN } },
    ]);
    refused(d, "shop", "conflict", /ownership/);
    refused(d, "admin", "conflict", /ownership/);
  });

  it.each([
    [
      "a recurrence profile",
      { recurrence: [{ timezone: "UTC", days: ["Monday"], hours: [8], minutes: [0] }] },
      {},
      "metric",
      /Scheduled/,
    ],
    [
      "a fixed-date profile",
      { fixed_date: [{ start: "2026-12-24T00:00:00Z", end: "2026-12-26T00:00:00Z" }] },
      {},
      "metric",
      /Scheduled/,
    ],
    [
      "a rule divided per instance",
      { rule: [monitorRule({ divide_by_instance_count: true })] },
      {},
      "metric",
      /per instance/,
    ],
    [
      "a rule on another resource's metric",
      {
        rule: [
          monitorRule({
            metric_resource_id: "/subscriptions/0/resourceGroups/shop/providers/Microsoft.Storage/storageAccounts/x",
          }),
        ],
      },
      {},
      "metric",
      /another resource/,
    ],
    ["a window past ten minutes", { rule: [monitorRule({ time_window: "PT1H" })] }, {}, "bounds", undefined],
    ["a minimum of zero", { capacity: [{ default: 1, minimum: 0, maximum: 3 }] }, {}, "bounds", undefined],
    ["an unknown rule field", { rule: [monitorRule({ metric_magic: "x" })] }, {}, "fields", /metric_trigger/],
    ["eleven rules", { rule: Array.from({ length: 11 }, () => monitorRule()) }, {}, "bounds", undefined],
    ["a predictive policy", {}, { predictive: [{ scale_mode: "Enabled" }] }, "fields", undefined],
    ["a disabled setting", {}, { enabled: false }, "metric", /Disabled/],
  ])("refuses %s", (_, profile, setting, code, reason) => {
    refused(tf(appBase(profile, setting)).diagram, "shop", code, reason);
  });

  it("two settings on one plan conflict", () => {
    const rs = appBase();
    const { diagram: d } = tf([...rs, { ...rs[2], name: "again" }]);
    refused(d, "shop", "conflict", /Conflicting/);
  });
});

// ------------------------------------------------ Cloud Run
const run2 = (template: Record<string, unknown>, service: Record<string, unknown> = {}): Res[] => [
  {
    type: "google_cloud_run_v2_service",
    name: "api",
    values: {
      name: "api",
      template: [
        {
          containers: [{ image: "gcr.io/a/b", resources: [{ limits: { cpu: "500m", memory: "256Mi" } }] }],
          ...template,
        },
      ],
      ...service,
    },
  },
];
describe("Terraform scaling: Cloud Run", () => {
  it("defaults: the revision maximum 100, and one request per instance below one vCPU", () => {
    const { diagram: d } = tf(run2({ scaling: [{ min_instance_count: 0 }] }));
    expect(controllerOf(d, "api")).toMatchObject({ minReplicas: 0, maxReplicas: 100 });
    expect(node(d, "api").props?.concurrency).toBe(1);
    expect(resourcesOf(d, "api")).toMatchObject({ cpuLimitMilli: 500, memoryLimitMiB: 256 });
    plays(d);
  });

  it.each([
    ["an unknown scaling field", run2({ scaling: [{ min_instance_count: 1, burst: 3 }] }), "fields"],
    [
      "manual service scaling",
      run2(
        { scaling: [{ min_instance_count: 1 }] },
        { scaling: [{ scaling_mode: "MANUAL", manual_instance_count: 3 }] },
      ),
      "metric",
    ],
    ["a concurrency past Cloud Run's 1000", run2({ max_instance_request_concurrency: 5000 }), "bounds"],
    [
      "a sidecar",
      run2({ scaling: [{ max_instance_count: 3 }], containers: [{ image: "a" }, { image: "b" }] }),
      "container",
    ],
    [
      "a Knative target annotation (v1)",
      [
        {
          type: "google_cloud_run_service",
          name: "api",
          values: {
            name: "api",
            template: [
              {
                metadata: [{ annotations: { "autoscaling.knative.dev/target": "70" } }],
                spec: [{ container_concurrency: 10 }],
              },
            ],
          },
        },
      ],
      "fields",
    ],
  ])("refuses %s", (_, rs, code) => {
    refused(tf(rs as Res[]).diagram, "api", code);
  });

  it("a service whose template says nothing about scaling is left as drawn", () => {
    const { diagram: d } = tf([{ type: "google_cloud_run_v2_service", name: "api", values: { name: "api" } }]);
    expect(node(d, "api").props).toBeUndefined();
  });
});

describe("Terraform scaling: units and parsers", () => {
  it("converts CPU units, task memory, ISO durations and ALB labels exactly", () => {
    expect(ecsCpuMilli("256")).toBe(250);
    expect(ecsCpuMilli("1024")).toBe(1000);
    expect(ecsCpuMilli("0.5 vCPU")).toBe(500);
    expect(ecsMemoryMiB("512")).toBe(512);
    expect(ecsMemoryMiB("4GB")).toBe(4096);
    for (const bad of ["", "1e3", "-256", "256m", "1.5"]) expect(() => ecsCpuMilli(bad)).toThrow(ScalingUnsupported);
    expect(isoDurationMs("PT5M")).toBe(300_000);
    expect(isoDurationMs("pt1h30m")).toBe(5_400_000);
    expect(isoDurationMs("PT45S")).toBe(45_000);
    for (const bad of ["P1D", "PT", "5M", "PT5.5M", 300]) expect(() => isoDurationMs(bad)).toThrow(ScalingUnsupported);
    expect(albNames("app/web/50dc6c495c0c9188/targetgroup/api/73e2d6bc24d8a067")).toEqual({
      loadBalancer: "web",
      targetGroup: "api",
    });
    expect(albNames("app/web/50dc6c495c0c9188")).toEqual({ loadBalancer: "web" });
    expect(albNames("targetgroup/api/73e2d6bc24d8a067")).toEqual({ targetGroup: "api" });
    expect(albNames("net/web/1")).toEqual({});
  });

  it("every reason sorts into its category: Container Apps reasons never read as a container problem", () => {
    const aca = (template: Record<string, unknown>) =>
      reasonOf(() => acaScaling(block({ template: [template] }), () => "q"));
    expect(scalingReasonCode(aca({ max_replicas: 3, unknown: 1 })!)).toBe("fields");
    expect(scalingReasonCode(aca({ max_replicas: 3, min_replicas: 5 })!)).toBe("bounds");
    expect(scalingReasonCode(aca({ tcp_scale_rule: [{ name: "t" }] })!)).toBe("metric");
  });
});

// ------------------------------------------------ hostile input: counted reads, depth, growth
describe("Terraform scaling: hostile input", () => {
  const huge = () => countingReads(Array.from({ length: 100_000 }, () => ({ custom_rule_type: "azure-servicebus" })));

  it("refuses an over-long collection by its length, reading none of it", () => {
    const rules = huge();
    expect(reasonOf(() => acaScaling(block({ template: [{ custom_scale_rule: rules.items }] }), () => "q"))).toMatch(
      /exceeds simulator bounds/,
    );
    expect(rules.reads()).toBe(0);
    const steps = huge();
    expect(
      reasonOf(() =>
        ecsScaling({
          target: block({ min_capacity: 1, max_capacity: 3 }),
          policies: [
            {
              block: block({
                step_scaling_policy_configuration: [
                  { adjustment_type: "ChangeInCapacity", step_adjustment: steps.items },
                ],
              }),
              loadBalancer: () => undefined,
              alarms: [{ block: block({}), loadBalancer: () => undefined, service: () => true }],
            },
          ],
        }),
      ),
    ).toMatch(/bounds/);
    expect(steps.reads()).toBe(0);
    const rules2 = huge();
    expect(
      reasonOf(() =>
        appServiceScaling(
          block({ profile: [{ capacity: [{ default: 1, minimum: 1, maximum: 2 }], rule: rules2.items }] }),
          () => true,
        ),
      ),
    ).toMatch(/bounds/);
    expect(rules2.reads()).toBe(0);
    const containers = huge();
    expect(reasonOf(() => cloudRunV2Scaling(block({ template: [{ containers: containers.items }] })))).toMatch(
      /bounds/,
    );
    expect(containers.reads()).toBe(0);
    const alarms = Array.from({ length: 1000 }, () => ({
      block: block({}),
      loadBalancer: () => undefined,
      service: () => true,
    }));
    const counted = countingReads(alarms);
    expect(
      reasonOf(() =>
        ecsScaling({
          target: block({ min_capacity: 1, max_capacity: 3 }),
          policies: [
            {
              block: block({
                step_scaling_policy_configuration: [
                  {
                    adjustment_type: "ChangeInCapacity",
                    step_adjustment: [{ metric_interval_lower_bound: "0", scaling_adjustment: 1 }],
                  },
                ],
              }),
              loadBalancer: () => undefined,
              alarms: counted.items,
            },
          ],
        }),
      ),
    ).toMatch(/bounds/);
    expect(counted.reads()).toBe(0);
  });

  it("stops reading a block's attributes at the cap, however many it has", () => {
    let gets = 0;
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 50_000; i++) many[`k${i}`] = null;
    const watched = new Proxy(many, {
      get(target, key, receiver) {
        gets++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(reasonOf(() => ecsScaling({ target: block(watched), policies: [] }))).toMatch(/Unsupported fields/);
    expect(gets).toBeLessThanOrEqual(TF_SCALING_LIMITS.maxFields + 1);
  });

  it("never walks a deeply nested value", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 100_000; i++) deep = { a: deep };
    const md = { queueName: deep };
    expect(
      reasonOf(() =>
        acaScaling(
          block({ template: [{ custom_scale_rule: [{ custom_rule_type: "azure-servicebus", metadata: md }] }] }),
          () => "q",
        ),
      ),
    ).toMatch(/Unsupported fields/);
    expect(
      reasonOf(() => ecsScaling({ target: block({ min_capacity: deep, max_capacity: 3 }), policies: [] })),
    ).toBeDefined();
    expect(
      reasonOf(() => cloudRunV2Scaling(block({ template: [{ scaling: [{ min_instance_count: deep }] }] }))),
    ).toMatch(/numeric/);
  });

  it("joins scaling resources in linear time", () => {
    /** `n` ECS services, each with a target, a step policy and its alarm (by ARN): 4n resources. */
    const services = (n: number): Res[] =>
      Array.from({ length: n }, (_, i) => [
        {
          type: "aws_ecs_service",
          name: `s${i}`,
          values: { name: `svc-${i}`, cluster: "arn:aws:ecs:eu-west-1:1:cluster/main" },
        },
        ecsTarget(`t${i}`, { resource_id: `service/main/svc-${i}` }),
        {
          type: "aws_appautoscaling_policy",
          name: `p${i}`,
          values: {
            arn: POLICY(`p${i}`),
            resource_id: `service/main/svc-${i}`,
            step_scaling_policy_configuration: [
              {
                adjustment_type: "ChangeInCapacity",
                step_adjustment: [{ metric_interval_lower_bound: "0", scaling_adjustment: 1 }],
              },
            ],
          },
        },
        {
          type: "aws_cloudwatch_metric_alarm",
          name: `a${i}`,
          values: {
            alarm_actions: [POLICY(`p${i}`)],
            namespace: "AWS/ECS",
            metric_name: "CPUUtilization",
            statistic: "Average",
            period: 60,
            evaluation_periods: 3,
            threshold: 70,
            comparison_operator: "GreaterThanOrEqualToThreshold",
            dimensions: { ServiceName: `svc-${i}` },
          },
        },
      ]).flat();
    const parse = JSON.parse;
    const parsed = new Map<string, unknown>();
    const spy = vi.spyOn(JSON, "parse").mockImplementation((text: string, reviver) => {
      if (reviver || text.length < 100_000) return parse(text, reviver) as unknown;
      if (!parsed.has(text)) parsed.set(text, parse(text));
      return parsed.get(text);
    });
    try {
      const run = (n: number) => {
        const text = state(services(n));
        const g = readTerraform([{ name: "big.json", text }]);
        expect(g.components.filter((c) => (c.props?.autoscaling as AutoscalingConfig)?.mode === "on")).toHaveLength(n);
        return () => readTerraform([{ name: "big.json", text }]);
      };
      expect(growth(run(150), run(150 * GROWTH_FACTOR), { samples: 3 })).toBeLessThan(LINEAR_LIMIT);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
