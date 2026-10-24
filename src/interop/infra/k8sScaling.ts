import {
  type AutoscalingConfig,
  type ComputeResources,
  type HpaSettings,
  type KedaTrigger,
} from "../../model/autoscaling";
import { hpaLesson, kedaLesson } from "../../model/autoscalingLessons";
import { checkAutoscaling } from "../../model/autoscalingSchema";
import { isMap, list, own, str } from "./yaml";

/** Only fixed diagnostic text escapes this module. Never echo manifest values, URLs, queries or credentials. */
function unsupported(reason: string): never {
  throw new Error(reason);
}
function fields(v: unknown, allowed: string[], where: string) {
  if (v !== undefined && (!isMap(v) || Object.keys(v).some((key) => !allowed.includes(key))))
    unsupported(`Unsupported fields in ${where}`);
}
function number(v: unknown, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  const text = typeof v === "number" ? String(v) : str(v);
  if (!text || text.length > 32 || !/^\d+(?:\.\d+)?$/.test(text)) unsupported("Invalid numeric scaling setting");
  const n = Number(text);
  if (!Number.isFinite(n) || n > 1e9) unsupported("Scaling setting exceeds simulator bounds");
  return n;
}
function seconds(v: unknown, fallback: number) {
  return number(v, fallback) * 1000;
}
function bool(v: unknown, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return unsupported("Invalid boolean scaling setting");
}
/** Parse the decimal mantissa as an integer fraction before converting to the simulator's unit. */
export function kubernetesQuantity(value: unknown, unit: "cpu" | "memory"): number {
  const text = typeof value === "number" ? String(value) : str(value);
  if (!text || text.length > 64) return unsupported("Invalid resource quantity");
  const m = /^\+?(\d*(?:\.\d*)?)([eE][+-]?\d{1,2}|[numkKMGTEP]|[KMGTPE]i)?$/.exec(text);
  if (!m) return unsupported("Unsupported resource quantity");
  if (!/\d/.test(m[1])) return unsupported("Unsupported resource quantity");
  const [whole, fraction = ""] = m[1].split(".");
  let numerator = BigInt((whole || "0") + fraction),
    denominator = 10n ** BigInt(fraction.length);
  const suffix = m[2] ?? "";
  if (/^[eE][+-]?\d/.test(suffix)) {
    const exponent = Number(suffix.slice(1));
    if (Math.abs(exponent) > 30) return unsupported("Resource quantity exceeds simulator bounds");
    if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
    else denominator *= 10n ** BigInt(-exponent);
  } else if (suffix.endsWith("i")) numerator *= 1024n ** BigInt("KMGTPE".indexOf(suffix[0]) + 1);
  else {
    const exponent =
      ({ n: -9, u: -6, m: -3, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18 } as Record<string, number>)[suffix] ?? 0;
    if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
    else denominator *= 10n ** BigInt(-exponent);
  }
  if (unit === "cpu") numerator *= 1000n;
  else denominator *= 1_048_576n;
  const result = Number(numerator) / Number(denominator);
  if (!(result > 0) || result > (unit === "cpu" ? 1_000_000 : 1_048_576))
    return unsupported("Resource quantity exceeds simulator bounds");
  return result;
}
export function workloadResources(pod: unknown): ComputeResources | undefined {
  const containers = list(own(pod, "containers")),
    init = list(own(pod, "initContainers"));
  if (!containers.some((c) => own(c, "resources") !== undefined) && !init.length) return;
  if (containers.length !== 1 || init.length)
    return unsupported("Multi-container or init-container resource accounting is unsupported");
  const c = containers[0],
    r = own(c, "resources");
  fields(r, ["requests", "limits"], "container resources");
  const requests = own(r, "requests"),
    limits = own(r, "limits");
  fields(requests, ["cpu", "memory"], "resource requests");
  fields(limits, ["cpu", "memory"], "resource limits");
  const cpuLimit = own(limits, "cpu"),
    memoryLimit = own(limits, "memory");
  const cpuRequest = own(requests, "cpu") ?? cpuLimit,
    memoryRequest = own(requests, "memory") ?? memoryLimit;
  const result: ComputeResources = {
    preset: "kubernetes-unmeasured",
    presetRevision: "1",
    modelRevision: "a2",
    container: str(own(c, "name")),
    cpuMsPerMessage: 0,
    baselineMemoryMiB: 0,
    memoryMiBPerMessage: 0,
    ...(cpuRequest !== undefined ? { cpuRequestMilli: kubernetesQuantity(cpuRequest, "cpu") } : {}),
    ...(cpuLimit !== undefined ? { cpuLimitMilli: kubernetesQuantity(cpuLimit, "cpu") } : {}),
    ...(memoryRequest !== undefined ? { memoryRequestMiB: kubernetesQuantity(memoryRequest, "memory") } : {}),
    ...(memoryLimit !== undefined ? { memoryLimitMiB: kubernetesQuantity(memoryLimit, "memory") } : {}),
    startup: { delayMs: 5000, jitterFraction: 0 },
    terminationGraceMs: seconds(own(pod, "terminationGracePeriodSeconds"), 30),
  };
  const requestDefaults: ("cpu" | "memory")[] = [];
  if (own(requests, "cpu") === undefined && cpuLimit !== undefined) requestDefaults.push("cpu");
  if (own(requests, "memory") === undefined && memoryLimit !== undefined) requestDefaults.push("memory");
  if (requestDefaults.length) result.requestDefaults = requestDefaults;
  if (
    (result.cpuRequestMilli ?? 0) > (result.cpuLimitMilli ?? Infinity) ||
    (result.memoryRequestMiB ?? 0) > (result.memoryLimitMiB ?? Infinity)
  )
    unsupported("Resource requests exceed limits");
  checkAutoscaling(result);
  return result;
}
function behavior(value: unknown, defaults: HpaSettings): HpaSettings {
  fields(value, ["scaleUp", "scaleDown"], "HPA behavior");
  for (const [key, direction] of [
    ["scaleUp", "up"],
    ["scaleDown", "down"],
  ] as const) {
    const input = own(value, key);
    if (input === undefined) continue;
    fields(input, ["stabilizationWindowSeconds", "selectPolicy", "policies"], "HPA direction");
    const b = defaults[direction];
    b.stabilizationMs = seconds(own(input, "stabilizationWindowSeconds"), b.stabilizationMs / 1000);
    b.selectPolicy = (str(own(input, "selectPolicy")) ?? b.selectPolicy) as typeof b.selectPolicy;
    const policies = own(input, "policies");
    if (policies !== undefined) {
      if (!Array.isArray(policies) || policies.length > 8)
        unsupported("HPA policy collection exceeds simulator bounds");
      b.policies = list(policies).map((p) => {
        fields(p, ["type", "value", "periodSeconds"], "HPA policy");
        return {
          type: str(own(p, "type")) as "Pods" | "Percent",
          value: number(own(p, "value")),
          periodMs: seconds(own(p, "periodSeconds"), 15),
        };
      });
    }
  }
  return defaults;
}
export function importHpa(spec: unknown, initial: number | undefined, apiVersion: string): AutoscalingConfig {
  fields(
    spec,
    ["scaleTargetRef", "minReplicas", "maxReplicas", "metrics", "behavior", "targetCPUUtilizationPercentage"],
    "HPA spec",
  );
  fields(own(spec, "scaleTargetRef"), ["apiVersion", "kind", "name"], "HPA target reference");
  if (!["autoscaling/v2", "autoscaling/v1"].includes(apiVersion)) unsupported("Unsupported HPA API version");
  const a = hpaLesson(),
    c = a.controller;
  c.minReplicas = number(own(spec, "minReplicas"), 1);
  c.maxReplicas = number(own(spec, "maxReplicas"));
  c.initialReplicas =
    initial !== undefined && initial >= c.minReplicas && initial <= c.maxReplicas ? initial : c.minReplicas;
  c.settings = behavior(own(spec, "behavior"), c.settings);
  const metrics = own(spec, "metrics");
  if (metrics === undefined)
    c.settings.metrics[0].target = {
      kind: "utilization",
      percentOfRequest: number(own(spec, "targetCPUUtilizationPercentage"), 80),
    };
  else {
    if (!Array.isArray(metrics) || !metrics.length || metrics.length > 16)
      unsupported("HPA metric collection exceeds simulator bounds");
    c.settings.metrics = list(metrics).map((m) => {
      fields(m, ["type", "resource", "containerResource"], "HPA metric");
      const type = str(own(m, "type"));
      if (type !== "Resource" && type !== "ContainerResource")
        unsupported("Custom HPA metrics need a supported local binding");
      const input = own(m, type === "Resource" ? "resource" : "containerResource");
      fields(input, type === "Resource" ? ["name", "target"] : ["name", "target", "container"], "HPA resource metric");
      const resource = str(own(input, "name"));
      if (resource !== "cpu" && resource !== "memory") unsupported("Unsupported HPA resource metric");
      const target = own(input, "target"),
        kind = str(own(target, "type"));
      fields(target, kind === "Utilization" ? ["type", "averageUtilization"] : ["type", "averageValue"], "HPA target");
      if (kind !== "Utilization" && kind !== "AverageValue") unsupported("Unsupported HPA target type");
      const container = type === "ContainerResource" ? str(own(input, "container")) : undefined;
      if (type === "ContainerResource" && !container) unsupported("ContainerResource needs a container selector");
      return {
        source: { kind: "resource", resource, ...(container ? { container } : {}) },
        target:
          kind === "Utilization"
            ? { kind: "utilization", percentOfRequest: number(own(target, "averageUtilization")) }
            : { kind: "averageValue", value: kubernetesQuantity(own(target, "averageValue"), resource) },
        windowMs: 15_000,
        metricDelayMs: 0,
      };
    });
  }
  const next = { ...a, modelRevision: "a2" as const };
  checkAutoscaling(undefined, next);
  return next;
}
export function importTrigger(input: unknown, source: KedaTrigger["source"]): KedaTrigger {
  fields(input, ["type", "metadata", "authenticationRef", "useCachedMetrics", "name", "metricType"], "KEDA trigger");
  if (own(input, "metricType") !== undefined && own(input, "metricType") !== "AverageValue")
    unsupported("KEDA broker triggers require AverageValue");
  const type = str(own(input, "type")),
    md = own(input, "metadata");
  if (!["kafka", "azure-servicebus", "aws-sqs-queue", "rabbitmq"].includes(type ?? ""))
    unsupported("Unsupported KEDA trigger (experimental Kafka is not stable Kafka)");
  const t = kedaLesson(type as KedaTrigger["type"], source).controller.triggers[0];
  t.useCachedMetrics = bool(own(input, "useCachedMetrics"), false);
  if (t.type === "kafka") {
    fields(
      md,
      [
        "bootstrapServers",
        "topic",
        "consumerGroup",
        "lagThreshold",
        "activationLagThreshold",
        "allowIdleConsumers",
        "offsetResetPolicy",
        "tls",
        "sasl",
        "version",
      ],
      "Kafka metadata",
    );
    if (own(md, "offsetResetPolicy") !== undefined && own(md, "offsetResetPolicy") !== "latest")
      unsupported("Kafka offset reset mode is unsupported");
    t.target = number(own(md, "lagThreshold"), 10);
    t.activation = number(own(md, "activationLagThreshold"), 0);
    t.allowIdleConsumers = bool(own(md, "allowIdleConsumers"), false);
    if (!source.group || !str(own(md, "topic")))
      unsupported("Kafka needs a named topic, group and known local offset history");
  } else if (t.type === "azure-servicebus") {
    fields(
      md,
      [
        "namespace",
        "queueName",
        "topicName",
        "subscriptionName",
        "messageCount",
        "activationMessageCount",
        "connectionFromEnv",
      ],
      "Service Bus metadata",
    );
    t.target = number(own(md, "messageCount"), 5);
    t.activation = number(own(md, "activationMessageCount"), 0);
    if (own(md, "topicName") !== undefined && !source.group) unsupported("Service Bus needs an exact subscription");
  } else if (t.type === "aws-sqs-queue") {
    fields(
      md,
      [
        "queueURL",
        "queueName",
        "awsRegion",
        "queueLength",
        "activationQueueLength",
        "scaleOnInFlight",
        "scaleOnDelayed",
        "identityOwner",
      ],
      "SQS metadata",
    );
    t.target = number(own(md, "queueLength"), 5);
    t.activation = number(own(md, "activationQueueLength"), 0);
    t.scaleOnInFlight = bool(own(md, "scaleOnInFlight"), true);
    if (bool(own(md, "scaleOnDelayed"), false)) unsupported("Delayed SQS visibility is not simulated");
  } else {
    fields(
      md,
      [
        "host",
        "hostFromEnv",
        "queueName",
        "mode",
        "value",
        "queueLength",
        "activationValue",
        "protocol",
        "excludeUnacknowledged",
        "vhostName",
      ],
      "RabbitMQ metadata",
    );
    if (own(md, "mode") !== undefined && own(md, "mode") !== "QueueLength")
      unsupported("RabbitMQ rate mode is unsupported");
    const protocol = str(own(md, "protocol")) ?? "auto";
    const scheme = str(own(md, "host"))
      ?.match(/^([a-z]+):\/\//i)?.[1]
      .toLowerCase();
    const resolved =
      protocol === "auto"
        ? scheme === "http" || scheme === "https"
          ? "http"
          : scheme === "amqp" || scheme === "amqps"
            ? "amqp"
            : undefined
        : protocol;
    if (resolved !== "http" && resolved !== "amqp") unsupported("RabbitMQ protocol cannot be resolved from host");
    t.protocol = resolved;
    if (own(md, "value") === undefined && own(md, "mode") !== undefined)
      unsupported("Modern RabbitMQ QueueLength needs an explicit value");
    t.target = number(own(md, "value") ?? own(md, "queueLength"), 20);
    t.activation = number(own(md, "activationValue"), 0);
    t.excludeUnacknowledged = bool(own(md, "excludeUnacknowledged"), t.protocol === "amqp");
  }
  return t;
}
export function importKeda(spec: unknown, initial: number | undefined, triggers: KedaTrigger[]): AutoscalingConfig {
  fields(
    spec,
    [
      "scaleTargetRef",
      "pollingInterval",
      "cooldownPeriod",
      "initialCooldownPeriod",
      "idleReplicaCount",
      "minReplicaCount",
      "maxReplicaCount",
      "fallback",
      "advanced",
      "triggers",
    ],
    "ScaledObject spec",
  );
  fields(
    own(spec, "scaleTargetRef"),
    ["apiVersion", "kind", "name", "envSourceContainerName"],
    "KEDA target reference",
  );
  const a = kedaLesson(),
    c = a.controller;
  c.triggers = triggers;
  c.minReplicas = number(own(spec, "minReplicaCount"), 0);
  c.maxReplicas = number(own(spec, "maxReplicaCount"), 100);
  c.initialReplicas =
    initial !== undefined && initial >= c.minReplicas && initial <= c.maxReplicas ? initial : c.minReplicas;
  c.pollingMs = seconds(own(spec, "pollingInterval"), 30);
  c.cooldownMs = seconds(own(spec, "cooldownPeriod"), 300);
  c.initialCooldownMs = seconds(own(spec, "initialCooldownPeriod"), 0);
  if (own(spec, "idleReplicaCount") !== undefined) c.idleReplicas = number(own(spec, "idleReplicaCount")) as 0;
  const advanced = own(spec, "advanced");
  fields(advanced, ["horizontalPodAutoscalerConfig", "restoreToOriginalReplicaCount"], "KEDA advanced");
  if (bool(own(advanced, "restoreToOriginalReplicaCount"), false))
    unsupported("Restoring a deleted ScaledObject is not simulated");
  const hpa = own(advanced, "horizontalPodAutoscalerConfig");
  fields(hpa, ["name", "behavior"], "generated HPA settings");
  c.settings = behavior(own(hpa, "behavior"), c.settings);
  const fallback = own(spec, "fallback");
  if (fallback !== undefined) {
    fields(fallback, ["failureThreshold", "replicas", "behavior"], "KEDA fallback");
    c.fallback = {
      failureThreshold: number(own(fallback, "failureThreshold")),
      replicas: number(own(fallback, "replicas")),
      behavior: (str(own(fallback, "behavior")) ?? "static") as NonNullable<typeof c.fallback>["behavior"],
    };
  }
  checkAutoscaling(undefined, a);
  return a;
}
