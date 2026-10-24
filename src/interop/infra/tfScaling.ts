import {
  type AcaController,
  type AppServiceController,
  type CloudConfig,
  type CloudRunController,
  type ComputeResources,
  type EcsController,
  type EcsMetric,
  type EcsOperator,
  type EcsStepAdjustment,
  type EcsStepScaling,
  type EcsTargetTracking,
  type KedaTrigger,
  type MonitorOperator,
  type MonitorRule,
} from "../../model/autoscaling";
import { cloudLesson, kedaLesson, resourceLesson } from "../../model/autoscalingLessons";
import { checkAutoscaling } from "../../model/autoscalingSchema";
import { kubernetesQuantity } from "./k8sScaling";
import { isMap, own } from "./yaml";

// Terraform scaling blocks → A3 cloud policies (docs/research/autoscaling.md § Cloud adapters and the P3 boundary):
// ECS Application Auto Scaling targets, policies and their CloudWatch alarms, a Container App's template, an Azure
// Monitor autoscale setting on an App Service plan, and a Cloud Run service's template. terraform.ts joins the
// resources to the drawn service; these functions read one policy's blocks and nothing else.
//
// The same rules as the importer: only the attributes named here are read, never one marked sensitive, and only
// scalar settings and node keys are returned (never a secret's name, an authentication parameter, a connection
// string or a URL). Every attribute of a block read here that isn't mapped or plumbing makes the policy
// unsupported ("Unsupported fields in …"), never silently dropped. Numbers are validated exactly against the
// simulator's bounds, every collection is capped before it's walked, and the result passes checkAutoscaling.
// Reasons are fixed English that `scalingReasonCode` sorts into a translated category: a reason naming a
// container is the "container" category, so the Container Apps reasons say "ACA".

export const TF_SCALING_LIMITS = {
  /** Scale rules, Monitor rules, alarms per policy and policies per ECS kind read at most (one more is refused). */
  maxRules: 16,
  maxMonitorRules: 10,
  maxSteps: 8,
  maxPolicies: 8,
  /** Attributes in one block, entries in one map. */
  maxFields: 64,
  maxContainers: 16,
} as const;

/** A policy the simulator can't run as written: `message` is the persisted, deterministic English reason. */
export class ScalingUnsupported extends Error {}
export function unsupported(reason: string): never {
  throw new ScalingUnsupported(reason);
}

/** A block of resource values and its `sensitive_values` (an instance is one). */
export interface TfBlock {
  values: unknown;
  sensitive: unknown;
}
export interface ScalingResult {
  autoscaling: CloudConfig;
  resources: ComputeResources;
  /** Node settings the policy implies (Cloud Run's per-instance maximum concurrency). */
  props?: { concurrency: number };
}

const SENSITIVE = "Sensitive scaling settings are not read";
const BOUNDS = "Scaling setting exceeds simulator bounds";
const NUMERIC = "Invalid numeric scaling setting";
/** Identity and plumbing: names, ids, tags, placement, notifications. Never mapped, never a reason to refuse. */
const PLUMBING = new Set([
  "id",
  "arn",
  "name",
  "tags",
  "tags_all",
  "region",
  "timeouts",
  "role_arn",
  "alarm_arns",
  "enabled",
  "location",
  "resource_group_name",
  "notification",
]);

const empty = (v: unknown): boolean => {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (!isMap(v)) return false;
  for (const key in v) if (Object.hasOwn(v, key)) return false;
  return true;
};
const sensitiveAt = (b: TfBlock, key: string) => b.sensitive === true || own(b.sensitive, key) === true;

/** One attribute's value, unless it's marked sensitive (then the policy is refused, the value never read). */
function value(b: TfBlock, key: string): unknown {
  const v = own(b.values, key);
  if (v !== undefined && sensitiveAt(b, key)) unsupported(SENSITIVE);
  return v;
}
const child = (b: TfBlock, key: string): TfBlock => ({
  values: own(b.values, key),
  sensitive: b.sensitive === true ? true : own(b.sensitive, key),
});
/** A nested block list, refused past `max` before any element is read. */
function blocks(b: TfBlock, key: string, max: number, where: string): TfBlock[] {
  const v = value(b, key);
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return unsupported(`Unsupported fields in ${where}`);
  if (v.length > max) return unsupported(`${where} exceeds simulator bounds`);
  const s = b.sensitive === true ? true : own(b.sensitive, key);
  const out: TfBlock[] = [];
  for (let i = 0; i < v.length; i++)
    out.push({
      values: v[i] as unknown,
      sensitive: s === true ? true : Array.isArray(s) ? (s[i] as unknown) : undefined,
    });
  return out;
}
/** A block Terraform allows once (a list of at most one). */
function only(b: TfBlock, key: string, where: string): TfBlock | undefined {
  const list = blocks(b, key, 1, where);
  return list.length && !empty(list[0].values) ? list[0] : undefined;
}
/**
 * Refuses a block with an attribute that is neither mapped, plumbing nor empty: "Unknown fields are reported, never
 * dropped". Values are only tested for emptiness.
 */
function fields(b: TfBlock | undefined, mapped: readonly string[], where: string) {
  if (!b || b.values === undefined || b.values === null) return;
  if (!isMap(b.values)) unsupported(`Unsupported fields in ${where}`);
  let n = 0;
  for (const key in b.values) {
    if (!Object.hasOwn(b.values, key)) continue;
    if (++n > TF_SCALING_LIMITS.maxFields) unsupported(`Unsupported fields in ${where}`);
    if (mapped.includes(key) || PLUMBING.has(key)) continue;
    if (!empty(b.values[key])) unsupported(`Unsupported fields in ${where}`);
  }
}
/** A map attribute (dimensions, metadata, annotations, limits) as a block whose keys are its entries. */
function entries(b: TfBlock | undefined, key: string, allowed: (k: string) => boolean, where: string): TfBlock {
  const m = b ? child(b, key) : { values: undefined, sensitive: undefined };
  if (b && own(b.values, key) !== undefined && sensitiveAt(b, key)) unsupported(SENSITIVE);
  if (empty(m.values)) return { values: undefined, sensitive: undefined };
  if (!isMap(m.values)) unsupported(`Unsupported fields in ${where}`);
  let n = 0;
  for (const k in m.values) {
    if (!Object.hasOwn(m.values, k)) continue;
    if (++n > TF_SCALING_LIMITS.maxFields || !allowed(k)) unsupported(`Unsupported fields in ${where}`);
  }
  return m;
}
/** A short string setting (an enum, a name, a quantity): another type, or a long one, is refused. */
function text(b: TfBlock | undefined, key: string, where: string): string | undefined {
  const v = b ? value(b, key) : undefined;
  if (empty(v)) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string" || v.length > 512) return unsupported(`Unsupported fields in ${where}`);
  return v;
}
interface Bounds {
  min: number;
  max: number;
  integer?: boolean;
}
/** An exact decimal (a number, or a string of digits as Terraform keeps some), within `bounds`. */
function exactNumber(v: unknown, bounds: Bounds): number {
  let n = NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.length <= 32 && /^[+-]?\d{1,15}(?:\.\d{1,15})?$/.test(v)) n = Number(v);
  if (!Number.isFinite(n) || (bounds.integer && !Number.isInteger(n))) return unsupported(NUMERIC);
  if (n < bounds.min || n > bounds.max) return unsupported(BOUNDS);
  return n;
}
function numberAt(b: TfBlock | undefined, key: string, bounds: Bounds, fallback: number): number;
function numberAt(b: TfBlock | undefined, key: string, bounds: Bounds): number | undefined;
function numberAt(b: TfBlock | undefined, key: string, bounds: Bounds, fallback?: number): number | undefined {
  const v = b ? value(b, key) : undefined;
  return empty(v) ? fallback : exactNumber(v, bounds);
}
function bool(b: TfBlock | undefined, key: string, fallback: boolean): boolean {
  const v = b ? value(b, key) : undefined;
  if (empty(v)) return fallback;
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return unsupported("Invalid boolean scaling setting");
}
/** Seconds (an integer, at most ten minutes) → ms; absent → `fallbackSeconds`. */
function secondsAt(b: TfBlock | undefined, key: string, fallbackSeconds: number, min = 0): number {
  return numberAt(b, key, { min, max: 600, integer: true }, fallbackSeconds) * 1000;
}
/** An ISO 8601 time duration ("PT5M", "PT1H30M", "PT45S") → ms. Days and fractions aren't Monitor windows. */
export function isoDurationMs(v: unknown): number {
  const m =
    typeof v === "string" && v.length <= 32
      ? /^PT(?=\d)(?:(\d{1,4})H)?(?:(\d{1,6})M)?(?:(\d{1,8})S)?$/.exec(v.toUpperCase())
      : null;
  if (!m) return unsupported(`${NUMERIC} (ISO 8601 duration)`);
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}
const within = (ms: number, min: number, max: number) => (ms < min || ms > max ? unsupported(BOUNDS) : ms);
/** A Kubernetes-style quantity ("0.5", "2000m", "512Mi"), its errors as unsupported reasons. */
function quantity(v: string | undefined, unit: "cpu" | "memory"): number | undefined {
  if (v === undefined) return undefined;
  try {
    return kubernetesQuantity(v, unit);
  } catch (error) {
    return unsupported(error instanceof Error ? error.message : "Unsupported resource quantity");
  }
}

/** Every produced policy passes the file format's own check, or it's refused with that check's reason. */
function checked(result: ScalingResult): ScalingResult {
  try {
    checkAutoscaling(result.resources, result.autoscaling);
  } catch (error) {
    const why = (error instanceof Error ? error.message : "invalid").replace(/^autoscaling: /, "");
    unsupported(`Scaling settings exceed simulator bounds (${why.replace(/container/gi, "ACA").slice(0, 200)})`);
  }
  return result;
}
/** Imported sizes, not measured costs: the user picks a workload lesson before resource predictions. */
function cloudResources(
  cpuMilli: number | undefined,
  memoryMiB: number | undefined,
  options: { requests?: boolean; graceMs?: number } = {},
): ComputeResources {
  const lesson = resourceLesson();
  return {
    preset: "cloud-unmeasured",
    presetRevision: "1",
    modelRevision: "a2",
    cpuMsPerMessage: 0,
    baselineMemoryMiB: 0,
    memoryMiBPerMessage: 0,
    ...(cpuMilli !== undefined
      ? { cpuLimitMilli: cpuMilli, ...(options.requests ? { cpuRequestMilli: cpuMilli } : {}) }
      : {}),
    ...(memoryMiB !== undefined
      ? { memoryLimitMiB: memoryMiB, ...(options.requests ? { memoryRequestMiB: memoryMiB } : {}) }
      : {}),
    startup: lesson.startup,
    terminationGraceMs: options.graceMs ?? lesson.terminationGraceMs,
  };
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const firstOf = (v: unknown) => (Array.isArray(v) ? (v[0] as unknown) : undefined);

// ---------------------------------------------------------------- AWS ECS (Application Auto Scaling)

/** "app/<lb>/<id>/targetgroup/<tg>/<id>", "app/<lb>/<id>", "targetgroup/<tg>/<id>" → the names in it. */
export function albNames(label: string | undefined): { loadBalancer?: string; targetGroup?: string } {
  if (!label || label.length > 512) return {};
  const lb = /(?:^|\/)app\/([\w-]{1,32})\/[\w]{1,64}(?:\/|$)/.exec(label)?.[1];
  const tg = /(?:^|\/)targetgroup\/([\w-]{1,32})\/[\w]{1,64}$/.exec(label)?.[1];
  return { ...(lb ? { loadBalancer: lb } : {}), ...(tg ? { targetGroup: tg } : {}) };
}
/** The load balancer node named (or referred to) that routes requests to the scaled service, else undefined. */
export type AlbResolver = (names: { loadBalancer?: string; targetGroup?: string }) => string | undefined;
export interface EcsAlarmInput {
  block: TfBlock;
  loadBalancer: AlbResolver;
  /** Whether the alarm's AWS/ECS dimensions (or its references) name the scaled service. */
  service: (dims: { serviceName?: string; clusterName?: string }) => boolean;
}
export interface EcsPolicyInput {
  block: TfBlock;
  loadBalancer: AlbResolver;
  /** The CloudWatch alarms in the files that invoke this policy. */
  alarms: EcsAlarmInput[];
}
export interface EcsInput {
  /** The aws_appautoscaling_target. */
  target: TfBlock;
  policies: EcsPolicyInput[];
  /** The service's instance: its desired_count starts the range. */
  service?: TfBlock;
  /** The aws_ecs_task_definition the service runs: its task-level size. */
  task?: TfBlock;
}
const ALB_BINDING =
  "ALB binding not found: the load balancer must be in these files and route requests to this service";
const ECS_PREDEFINED: Record<string, EcsTargetTracking["metric"]> = {
  ECSServiceAverageCPUUtilization: "cpu",
  ECSServiceAverageMemoryUtilization: "memory",
  ALBRequestCountPerTarget: "albRequestCountPerTarget",
};
const CLOUDWATCH_OPERATORS: readonly EcsOperator[] = [
  "GreaterThanOrEqualToThreshold",
  "GreaterThanThreshold",
  "LessThanThreshold",
  "LessThanOrEqualToThreshold",
];
const ADJUSTMENTS: readonly EcsStepScaling["adjustmentType"][] = [
  "ChangeInCapacity",
  "PercentChangeInCapacity",
  "ExactCapacity",
];
/** Unset ECS cooldowns are 300 s (Application Auto Scaling's default for ECS). */
const ECS_COOLDOWN_S = 300;

/** Task-level CPU: units ("256", 1024 = 1 vCPU) or "1 vCPU" → millicores. */
export function ecsCpuMilli(v: string): number {
  const t = v.trim();
  const vcpu = /^(\d{1,4}(?:\.\d{1,4})?)\s*vcpu$/i.exec(t);
  const units = /^\d{1,7}$/.test(t) ? Number(t) : vcpu ? Number(vcpu[1]) * 1024 : NaN;
  if (Number.isNaN(units)) return unsupported("Unsupported ECS task size quantity");
  if (!(units > 0) || units > 1_048_576) return unsupported("ECS task size quantity exceeds simulator bounds");
  return (units * 1000) / 1024;
}
/** Task-level memory: MiB ("512") or "2 GB" → MiB. */
export function ecsMemoryMiB(v: string): number {
  const t = v.trim();
  const gb = /^(\d{1,4}(?:\.\d{1,4})?)\s*gb$/i.exec(t);
  const mib = /^\d{1,8}$/.test(t) ? Number(t) : gb ? Number(gb[1]) * 1024 : NaN;
  if (Number.isNaN(mib)) return unsupported("Unsupported ECS task size quantity");
  if (!(mib > 0) || mib > 1_048_576) return unsupported("ECS task size quantity exceeds simulator bounds");
  return mib;
}
function ecsTaskResources(task: TfBlock | undefined): ComputeResources {
  const cpu = text(task, "cpu", "aws_ecs_task_definition");
  const memory = text(task, "memory", "aws_ecs_task_definition");
  return cloudResources(
    cpu === undefined ? undefined : ecsCpuMilli(cpu),
    memory === undefined ? undefined : ecsMemoryMiB(memory),
    { requests: true },
  );
}
function ecsIdentity(b: TfBlock, where: string) {
  const ns = text(b, "service_namespace", where),
    dim = text(b, "scalable_dimension", where);
  if ((ns !== undefined && ns !== "ecs") || (dim !== undefined && dim !== "ecs:service:DesiredCount"))
    unsupported(`Unsupported fields in ${where}`);
}
function targetTracking(p: EcsPolicyInput): EcsTargetTracking {
  const where = "aws_appautoscaling_policy target_tracking_scaling_policy_configuration";
  const config = only(p.block, "target_tracking_scaling_policy_configuration", where);
  if (!config) return unsupported("ECS target tracking policy has no configuration");
  if (!empty(value(config, "customized_metric_specification"))) unsupported("Customized ECS metrics are unsupported");
  fields(
    config,
    ["target_value", "disable_scale_in", "scale_in_cooldown", "scale_out_cooldown", "predefined_metric_specification"],
    where,
  );
  const spec = only(config, "predefined_metric_specification", where);
  fields(spec, ["predefined_metric_type", "resource_label"], `${where} predefined_metric_specification`);
  const type = text(spec, "predefined_metric_type", where) ?? "";
  if (!Object.hasOwn(ECS_PREDEFINED, type)) unsupported("Unsupported ECS predefined metric");
  const metric = ECS_PREDEFINED[type];
  const label = text(spec, "resource_label", where);
  let source: { node: string } | undefined;
  if (metric === "albRequestCountPerTarget") {
    const node = p.loadBalancer(albNames(label));
    if (!node) unsupported(ALB_BINDING);
    source = { node };
  } else if (label !== undefined) unsupported(`Unsupported fields in ${where}`);
  return {
    metric,
    target: numberAt(config, "target_value", { min: 0.000001, max: 1e9 }) ?? unsupported(NUMERIC),
    ...(source ? { source } : {}),
    scaleOutCooldownMs: secondsAt(config, "scale_out_cooldown", ECS_COOLDOWN_S),
    scaleInCooldownMs: secondsAt(config, "scale_in_cooldown", ECS_COOLDOWN_S),
    disableScaleIn: bool(config, "disable_scale_in", false),
  };
}
function stepAdjustments(config: TfBlock, where: string): EcsStepAdjustment[] {
  const list = blocks(config, "step_adjustment", TF_SCALING_LIMITS.maxSteps, `${where} step_adjustment`);
  if (!list.length) unsupported("ECS step policy has no step adjustments");
  const bound = { min: -1e9, max: 1e9 };
  return list.map((s) => {
    fields(s, ["metric_interval_lower_bound", "metric_interval_upper_bound", "scaling_adjustment"], where);
    const lower = numberAt(s, "metric_interval_lower_bound", bound),
      upper = numberAt(s, "metric_interval_upper_bound", bound);
    return {
      ...(lower !== undefined ? { lower } : {}),
      ...(upper !== undefined ? { upper } : {}),
      adjustment:
        numberAt(s, "scaling_adjustment", { min: -10_000, max: 10_000, integer: true }) ?? unsupported(NUMERIC),
    };
  });
}
/**
 * One alarm invoking one step policy. CPU and memory are the service's average utilisation (statistic Average);
 * ALB counts are a Sum per 60 s period, which is the simulator's per-minute count (another period or statistic
 * would compare a different quantity, so it's refused).
 */
function stepScaling(config: TfBlock, alarm: EcsAlarmInput, steps: EcsStepAdjustment[]) {
  const where = "aws_cloudwatch_metric_alarm";
  const a = alarm.block;
  if (!empty(value(a, "metric_query"))) unsupported("CloudWatch metric math alarms are not simulated");
  fields(
    a,
    [
      "alarm_actions",
      "alarm_name",
      "alarm_description",
      "ok_actions",
      "insufficient_data_actions",
      "comparison_operator",
      "evaluation_periods",
      "datapoints_to_alarm",
      "metric_name",
      "namespace",
      "period",
      "statistic",
      "threshold",
      "dimensions",
      "treat_missing_data",
      "actions_enabled",
      "unit",
    ],
    where,
  );
  if (!bool(a, "actions_enabled", true)) unsupported("ECS step alarm actions are disabled");
  const missing = text(a, "treat_missing_data", where);
  if (missing !== undefined && missing !== "missing")
    unsupported("CloudWatch missing-data treatment other than missing is unsupported");
  const namespace = text(a, "namespace", where),
    name = text(a, "metric_name", where),
    statistic = text(a, "statistic", where);
  const ecs = namespace === "AWS/ECS";
  const metric: EcsMetric | undefined = ecs
    ? name === "CPUUtilization"
      ? "cpu"
      : name === "MemoryUtilization"
        ? "memory"
        : undefined
    : namespace === "AWS/ApplicationELB"
      ? name === "RequestCount"
        ? "albRequestCount"
        : name === "RequestCountPerTarget"
          ? "albRequestCountPerTarget"
          : undefined
      : undefined;
  if (!metric) return unsupported("Unsupported CloudWatch metric for ECS step scaling");
  const dims = entries(
    a,
    "dimensions",
    (k) => (ecs ? k === "ServiceName" || k === "ClusterName" : k === "LoadBalancer" || k === "TargetGroup"),
    `${where} dimensions`,
  );
  const ms = (numberAt(a, "period", { min: 1, max: 600, integer: true }) ?? unsupported(NUMERIC)) * 1000;
  let source: { node: string } | undefined;
  if (ecs) {
    if (statistic !== "Average") unsupported("ECS utilisation alarms need the Average statistic");
    const serviceName = text(dims, "ServiceName", where),
      clusterName = text(dims, "ClusterName", where);
    if (!alarm.service({ ...(serviceName ? { serviceName } : {}), ...(clusterName ? { clusterName } : {}) }))
      unsupported("The ECS alarm measures another service");
  } else {
    if (statistic !== "Sum" || ms !== 60_000) unsupported("ALB request alarms need a Sum over a 60 s period");
    const lb = albNames(text(dims, "LoadBalancer", where)).loadBalancer,
      tg = albNames(text(dims, "TargetGroup", where)).targetGroup;
    const node = alarm.loadBalancer({ ...(lb ? { loadBalancer: lb } : {}), ...(tg ? { targetGroup: tg } : {}) });
    if (!node) unsupported(ALB_BINDING);
    source = { node };
  }
  const evaluationPeriods =
    numberAt(a, "evaluation_periods", { min: 1, max: 60, integer: true }) ?? unsupported(NUMERIC);
  const datapoints = numberAt(a, "datapoints_to_alarm", { min: 0, max: 1e9, integer: true });
  if (datapoints && datapoints !== evaluationPeriods)
    unsupported("CloudWatch M-of-N alarms are not simulated; set datapoints to alarm to the evaluation periods");
  const operator = text(a, "comparison_operator", where) as EcsOperator | undefined;
  if (!operator || !CLOUDWATCH_OPERATORS.includes(operator)) unsupported("Unsupported CloudWatch alarm operator");
  const adjustmentType = text(config, "adjustment_type", where) as EcsStepScaling["adjustmentType"] | undefined;
  if (!adjustmentType || !ADJUSTMENTS.includes(adjustmentType)) unsupported("Unsupported ECS step adjustment type");
  const magnitude = numberAt(config, "min_adjustment_magnitude", { min: 0, max: 10_000, integer: true });
  const policy: EcsStepScaling = {
    metric,
    ...(source ? { source } : {}),
    operator,
    threshold: numberAt(a, "threshold", { min: 0, max: 1e9 }) ?? unsupported(NUMERIC),
    evaluationPeriods,
    adjustmentType,
    steps,
    ...(magnitude ? { minAdjustmentMagnitude: magnitude } : {}),
    cooldownMs: secondsAt(config, "cooldown", ECS_COOLDOWN_S),
  };
  return { policy, periodMs: ms };
}
export function ecsScaling(input: EcsInput): ScalingResult {
  const target = input.target;
  fields(
    target,
    ["min_capacity", "max_capacity", "resource_id", "scalable_dimension", "service_namespace", "suspended_state"],
    "aws_appautoscaling_target",
  );
  ecsIdentity(target, "aws_appautoscaling_target");
  const suspended = only(target, "suspended_state", "aws_appautoscaling_target");
  fields(
    suspended,
    ["dynamic_scaling_in_suspended", "dynamic_scaling_out_suspended", "scheduled_scaling_suspended"],
    "aws_appautoscaling_target suspended_state",
  );
  for (const k of ["dynamic_scaling_in_suspended", "dynamic_scaling_out_suspended", "scheduled_scaling_suspended"])
    if (bool(suspended, k, false)) unsupported("Suspended ECS scaling is not simulated");
  if (!input.policies.length) unsupported("ECS scalable target has no scaling policy in these files");
  if (input.policies.length > TF_SCALING_LIMITS.maxPolicies * 2) unsupported("ECS policies exceed simulator bounds");
  const a = cloudLesson("ecs-cpu"),
    c = a.controller as EcsController;
  c.minReplicas = numberAt(target, "min_capacity", { min: 0, max: 10_000, integer: true }) ?? unsupported(NUMERIC);
  c.maxReplicas = numberAt(target, "max_capacity", { min: 1, max: 10_000, integer: true }) ?? unsupported(NUMERIC);
  if (c.minReplicas > c.maxReplicas) unsupported("ECS capacity range exceeds simulator bounds");
  let desired: number | undefined;
  try {
    desired = input.service && numberAt(input.service, "desired_count", { min: 0, max: 1e9, integer: true });
  } catch (error) {
    // Only a start: a desired count that isn't a count starts at the minimum.
    if (!(error instanceof ScalingUnsupported) || error.message === SENSITIVE) throw error;
  }
  c.initialReplicas = desired === undefined ? c.minReplicas : clamp(desired, c.minReplicas, c.maxReplicas);
  c.targetTracking = [];
  c.stepScaling = [];
  const periods = new Set<number>();
  for (const p of input.policies) {
    const where = "aws_appautoscaling_policy";
    fields(
      p.block,
      [
        "policy_type",
        "resource_id",
        "scalable_dimension",
        "service_namespace",
        "target_tracking_scaling_policy_configuration",
        "step_scaling_policy_configuration",
      ],
      where,
    );
    ecsIdentity(p.block, where);
    // The provider's default policy type is StepScaling.
    const type = text(p.block, "policy_type", where) ?? "StepScaling";
    if (type === "TargetTrackingScaling") {
      if (!empty(value(p.block, "step_scaling_policy_configuration"))) unsupported(`Unsupported fields in ${where}`);
      c.targetTracking.push(targetTracking(p));
      // Target tracking's managed alarms read the one-minute standard metrics.
      periods.add(60_000);
    } else if (type === "StepScaling") {
      if (!empty(value(p.block, "target_tracking_scaling_policy_configuration")))
        unsupported(`Unsupported fields in ${where}`);
      const config = only(p.block, "step_scaling_policy_configuration", where);
      if (!config) unsupported("ECS step policy has no configuration");
      const sw = `${where} step_scaling_policy_configuration`;
      fields(
        config,
        ["adjustment_type", "cooldown", "metric_aggregation_type", "min_adjustment_magnitude", "step_adjustment"],
        sw,
      );
      const aggregation = text(config, "metric_aggregation_type", sw);
      if (aggregation !== undefined && aggregation !== "Average")
        unsupported("ECS step aggregation other than Average is unsupported");
      if (!p.alarms.length) unsupported("ECS step policy has no CloudWatch alarm in these files");
      if (p.alarms.length > TF_SCALING_LIMITS.maxPolicies) unsupported("ECS policies exceed simulator bounds");
      const steps = stepAdjustments(config, sw);
      for (const alarm of p.alarms) {
        const { policy, periodMs } = stepScaling(config, alarm, steps);
        c.stepScaling.push(policy);
        periods.add(periodMs);
      }
    } else unsupported("Predictive ECS scaling is not simulated");
    if (c.targetTracking.length > TF_SCALING_LIMITS.maxPolicies || c.stepScaling.length > TF_SCALING_LIMITS.maxPolicies)
      unsupported("ECS policies exceed simulator bounds");
  }
  if (periods.size > 1) unsupported("ECS policies read different metric periods; one period per service is simulated");
  c.metricPeriodMs = [...periods][0] ?? 60_000;
  // The lesson it's closest to, for the inspector: requests per target, step alarms only, else CPU.
  a.preset = c.targetTracking.some((p) => p.source) ? "ecs-alb" : c.targetTracking.length ? "ecs-cpu" : "ecs-step";
  return checked({ autoscaling: a, resources: ecsTaskResources(input.task) });
}

// ---------------------------------------------------------------- Azure Container Apps

/** The Service Bus node a rule names (a queue, or a topic), undefined when it isn't drawn here. */
export type ServiceBusResolver = (names: { queue?: string; topic?: string; namespace?: string }) => string | undefined;
const ACA_TEMPLATE = "ACA template";
/** A Container App template that says anything about scaling (a range or a rule). */
export function acaHasScaling(app: TfBlock): boolean {
  const template = firstOf(own(app.values, "template"));
  return [
    "min_replicas",
    "max_replicas",
    "http_scale_rule",
    "custom_scale_rule",
    "tcp_scale_rule",
    "azure_queue_scale_rule",
  ].some((k) => !empty(own(template, k)));
}
const SERVICE_BUS_METADATA = new Set([
  "namespace",
  "queueName",
  "topicName",
  "subscriptionName",
  "messageCount",
  "activationMessageCount",
  "connectionFromEnv",
]);
function serviceBusTrigger(rule: TfBlock, resolve: ServiceBusResolver): KedaTrigger {
  const where = "ACA custom scale rule";
  // `authentication` names a secret and a trigger parameter: never read, and it doesn't change how the rule scales.
  fields(rule, ["custom_rule_type", "metadata", "authentication"], where);
  if (text(rule, "custom_rule_type", where) !== "azure-servicebus")
    unsupported("Unsupported ACA custom scale rule type");
  const md = entries(rule, "metadata", (k) => SERVICE_BUS_METADATA.has(k), "ACA Service Bus metadata");
  const queue = text(md, "queueName", where),
    topic = text(md, "topicName", where),
    subscription = text(md, "subscriptionName", where),
    namespace = text(md, "namespace", where);
  const entity = /^[\w.~/-]{1,260}$/;
  if (queue !== undefined ? topic !== undefined || subscription !== undefined : !topic || !subscription)
    unsupported("Service Bus rule needs a queue, or a topic and its subscription");
  if (!entity.test(queue ?? topic ?? "") || (subscription !== undefined && !/^[\w.~-]{1,50}$/.test(subscription)))
    unsupported("Service Bus binding names are unsupported");
  const node = resolve({
    ...(queue ? { queue } : { topic }),
    ...(namespace && /^[\w-]{1,50}$/.test(namespace) ? { namespace } : {}),
  });
  if (!node) unsupported("Service Bus binding not found in these files");
  const t = kedaLesson("azure-servicebus", { node, ...(subscription ? { group: subscription } : {}) }).controller
    .triggers[0];
  t.target = numberAt(md, "messageCount", { min: 0.000001, max: 1e9 }, 5);
  t.activation = numberAt(md, "activationMessageCount", { min: 0, max: 1e9 }, 0);
  return t;
}
/** azurerm_container_app: the template's range, cadence, HTTP and Service Bus rules, and its one container's size. */
export function acaScaling(app: TfBlock, resolve: ServiceBusResolver): ScalingResult {
  const template = only(app, "template", ACA_TEMPLATE);
  if (!template) return unsupported("ACA app has no template");
  fields(
    template,
    [
      "min_replicas",
      "max_replicas",
      "cooldown_period_in_seconds",
      "polling_interval_in_seconds",
      "http_scale_rule",
      "custom_scale_rule",
      "tcp_scale_rule",
      "azure_queue_scale_rule",
      "container",
      "init_container",
      "termination_grace_period_seconds",
      // Not scaling: the revision's name suffix and its volumes.
      "revision_suffix",
      "volume",
    ],
    ACA_TEMPLATE,
  );
  if (!empty(value(template, "tcp_scale_rule"))) unsupported("TCP scale rules are unsupported");
  if (!empty(value(template, "azure_queue_scale_rule"))) unsupported("Azure Storage queue scale rules are unsupported");
  const a = cloudLesson("aca-http"),
    c = a.controller as AcaController;
  c.minReplicas = numberAt(template, "min_replicas", { min: 0, max: 10_000, integer: true }, 0);
  c.maxReplicas = numberAt(template, "max_replicas", { min: 1, max: 10_000, integer: true }, 10);
  c.initialReplicas = c.minReplicas;
  c.cooldownMs = secondsAt(template, "cooldown_period_in_seconds", 300);
  c.pollingMs = secondsAt(template, "polling_interval_in_seconds", 30, 1);
  const http = blocks(template, "http_scale_rule", TF_SCALING_LIMITS.maxRules, "ACA HTTP scale rules");
  const custom = blocks(template, "custom_scale_rule", TF_SCALING_LIMITS.maxRules, "ACA custom scale rules");
  if (http.length > 1) unsupported("At most one HTTP scale rule is simulated");
  if (http.length) {
    // `authentication` is never read: it doesn't change how the rule scales.
    fields(http[0], ["concurrent_requests", "authentication"], "ACA HTTP scale rule");
    c.http = {
      concurrentRequests:
        numberAt(http[0], "concurrent_requests", { min: 1, max: 1e9, integer: true }) ?? unsupported(NUMERIC),
    };
  } else if (custom.length) {
    // ACA's default HTTP rule applies only to an app with no rule of its own.
    delete c.http;
    a.preset = "aca-event";
  }
  c.triggers = custom.map((rule) => serviceBusTrigger(rule, resolve));
  const containers = blocks(template, "container", TF_SCALING_LIMITS.maxContainers, "ACA app"),
    init = blocks(template, "init_container", TF_SCALING_LIMITS.maxContainers, "ACA app");
  if (containers.length > 1 || init.length) unsupported("Multi-container resource accounting is unsupported");
  const box = containers[0];
  const resources = cloudResources(
    quantity(text(box, "cpu", "ACA app"), "cpu"),
    quantity(text(box, "memory", "ACA app"), "memory"),
    {
      graceMs: secondsAt(template, "termination_grace_period_seconds", 30),
    },
  );
  return checked({ autoscaling: a, resources });
}

// ---------------------------------------------------------------- Azure App Service (Monitor autoscale)

const MONITOR_METRICS: Record<string, MonitorRule["metric"]> = {
  cpupercentage: "cpu",
  memorypercentage: "memory",
  httpqueuelength: "httpQueue",
};
const MONITOR_OPERATORS: readonly MonitorOperator[] = [
  "GreaterThan",
  "GreaterThanOrEqual",
  "LessThan",
  "LessThanOrEqual",
];
const MONITOR_CHANGES: readonly MonitorRule["changeType"][] = ["ChangeCount", "PercentChangeCount", "ExactCount"];
function monitorRule(rule: TfBlock, metricSource: (id: string | undefined) => boolean): MonitorRule {
  const where = "azurerm_monitor_autoscale_setting rule";
  fields(rule, ["metric_trigger", "scale_action"], where);
  const trigger = only(rule, "metric_trigger", where),
    action = only(rule, "scale_action", where);
  if (!trigger || !action) return unsupported(`Unsupported fields in ${where}`);
  const tw = `${where} metric_trigger`;
  fields(
    trigger,
    [
      "metric_name",
      "metric_resource_id",
      "metric_namespace",
      "operator",
      "statistic",
      "threshold",
      "time_aggregation",
      "time_grain",
      "time_window",
      "divide_by_instance_count",
      "dimensions",
    ],
    tw,
  );
  if (bool(trigger, "divide_by_instance_count", false))
    unsupported("Monitor metrics divided per instance are unsupported");
  if (!empty(value(trigger, "dimensions"))) unsupported(`Unsupported fields in ${tw}`);
  const ns = text(trigger, "metric_namespace", tw);
  if (ns !== undefined && ns.toLowerCase() !== "microsoft.web/serverfarms")
    unsupported("Monitor rules on another resource's metrics are unsupported");
  if (!metricSource(text(trigger, "metric_resource_id", tw)))
    unsupported("Monitor rules on another resource's metrics are unsupported");
  const name = (text(trigger, "metric_name", tw) ?? "").toLowerCase();
  if (!Object.hasOwn(MONITOR_METRICS, name)) unsupported("Unsupported Monitor metric");
  if ((text(trigger, "statistic", tw) ?? "").toLowerCase() !== "average")
    unsupported("Monitor statistics other than Average are unsupported");
  if ((text(trigger, "time_aggregation", tw) ?? "").toLowerCase() !== "average")
    unsupported("Monitor time aggregation other than Average is unsupported");
  const grain = text(trigger, "time_grain", tw);
  if (grain !== undefined && isoDurationMs(grain) !== 60_000)
    unsupported("Monitor time grains other than one minute are unsupported");
  const operator = text(trigger, "operator", tw) as MonitorOperator | undefined;
  if (!operator || !MONITOR_OPERATORS.includes(operator)) unsupported("Unsupported Monitor operator");
  const aw = `${where} scale_action`;
  fields(action, ["direction", "type", "value", "cooldown"], aw);
  const direction = text(action, "direction", aw);
  if (direction !== "Increase" && direction !== "Decrease") unsupported("Unsupported Monitor scale direction");
  const changeType = text(action, "type", aw) as MonitorRule["changeType"] | undefined;
  if (!changeType || !MONITOR_CHANGES.includes(changeType)) unsupported("Unsupported Monitor scale action type");
  const window = text(trigger, "time_window", tw),
    cooldown = text(action, "cooldown", aw);
  return {
    metric: MONITOR_METRICS[name],
    operator,
    threshold: numberAt(trigger, "threshold", { min: 0, max: 1e9 }) ?? unsupported(NUMERIC),
    windowMs: within(window === undefined ? unsupported(NUMERIC) : isoDurationMs(window), 1000, 600_000),
    direction: direction === "Increase" ? "increase" : "decrease",
    changeType,
    value: numberAt(action, "value", { min: 0, max: 10_000, integer: true }) ?? unsupported(NUMERIC),
    cooldownMs: within(cooldown === undefined ? unsupported(NUMERIC) : isoDurationMs(cooldown), 0, 600_000),
  };
}
/**
 * azurerm_monitor_autoscale_setting on the plan of exactly one drawn app (the caller checks ownership). One
 * profile without a schedule; its rules must read the plan's own CPU, memory or HTTP queue.
 */
export function appServiceScaling(setting: TfBlock, metricSource: (id: string | undefined) => boolean): ScalingResult {
  const where = "azurerm_monitor_autoscale_setting";
  fields(setting, ["profile", "target_resource_id"], where);
  if (!bool(setting, "enabled", true)) unsupported("Disabled autoscale settings are not simulated");
  const profiles = blocks(setting, "profile", 20, `${where} profile`);
  if (profiles.length !== 1) unsupported("Autoscale settings need exactly one profile without a schedule");
  const profile = profiles[0];
  fields(profile, ["capacity", "rule", "recurrence", "fixed_date"], `${where} profile`);
  if (!empty(value(profile, "recurrence")) || !empty(value(profile, "fixed_date")))
    unsupported("Scheduled autoscale profiles are not simulated");
  const capacity = only(profile, "capacity", `${where} profile`);
  fields(capacity, ["default", "minimum", "maximum"], `${where} capacity`);
  const a = cloudLesson("app-service"),
    c = a.controller as AppServiceController;
  const count = { min: 1, max: 10_000, integer: true };
  c.minReplicas = numberAt(capacity, "minimum", count) ?? unsupported(NUMERIC);
  c.maxReplicas = numberAt(capacity, "maximum", count) ?? unsupported(NUMERIC);
  if (c.minReplicas > c.maxReplicas) unsupported("App Service capacity range exceeds simulator bounds");
  c.initialReplicas = clamp(numberAt(capacity, "default", count, c.minReplicas), c.minReplicas, c.maxReplicas);
  const rules = blocks(profile, "rule", TF_SCALING_LIMITS.maxMonitorRules, "Monitor rules");
  if (!rules.length) unsupported("Autoscale profile has no rules");
  c.rules = rules.map((r) => monitorRule(r, metricSource));
  return checked({ autoscaling: a, resources: cloudResources(undefined, undefined) });
}

// ---------------------------------------------------------------- Google Cloud Run

const KNATIVE = "autoscaling.knative.dev/";
const templateOf = (svc: TfBlock) => firstOf(own(svc.values, "template"));
/** A Cloud Run service whose template says how it scales (a range or a concurrency). */
export function cloudRunHasScaling(svc: TfBlock, v2: boolean): boolean {
  const t = templateOf(svc);
  if (v2) return !empty(own(t, "scaling")) || !empty(own(t, "max_instance_request_concurrency"));
  const annotations = own(firstOf(own(t, "metadata")), "annotations");
  if (isMap(annotations)) {
    let n = 0;
    for (const k in annotations)
      if (Object.hasOwn(annotations, k) && (k.startsWith(KNATIVE) || ++n > TF_SCALING_LIMITS.maxFields)) return true;
  }
  return !empty(own(firstOf(own(t, "spec")), "container_concurrency"));
}
function cloudRun(
  min: number,
  max: number,
  concurrency: number | undefined,
  container: TfBlock | undefined,
): ScalingResult {
  const resources = only(container ?? { values: undefined, sensitive: undefined }, "resources", "Cloud Run resources");
  const limits = entries(resources, "limits", (k) => k === "cpu" || k === "memory", "Cloud Run limits");
  const cpu = quantity(text(limits, "cpu", "Cloud Run limits"), "cpu");
  const memory = quantity(text(limits, "memory", "Cloud Run limits"), "memory");
  const a = cloudLesson("cloud-run"),
    c = a.controller as CloudRunController;
  c.minReplicas = min;
  c.maxReplicas = max;
  c.initialReplicas = min;
  // Unset (or 0, the API's "default"): 80 per instance, or 1 below one vCPU.
  const perInstance = concurrency || (cpu !== undefined && cpu < 1000 ? 1 : 80);
  return checked({ autoscaling: a, resources: cloudResources(cpu, memory), props: { concurrency: perInstance } });
}
const instances = { min: 0, max: 10_000, integer: true };
const perInstance = { min: 0, max: 1000, integer: true };
/** google_cloud_run_v2_service: template.scaling, the per-instance concurrency, the one container's limits. */
export function cloudRunV2Scaling(svc: TfBlock): ScalingResult {
  const where = "google_cloud_run_v2_service";
  const service = only(svc, "scaling", `${where} scaling`);
  fields(
    service,
    ["scaling_mode", "min_instance_count", "max_instance_count", "manual_instance_count"],
    `${where} scaling`,
  );
  const mode = text(service, "scaling_mode", where);
  if (
    (mode !== undefined && mode !== "AUTOMATIC") ||
    numberAt(service, "manual_instance_count", instances) ||
    numberAt(service, "min_instance_count", instances) ||
    numberAt(service, "max_instance_count", instances)
  )
    unsupported("Service-level Cloud Run scaling is not simulated");
  const template = only(svc, "template", where);
  const scaling = template && only(template, "scaling", `${where} template`);
  fields(scaling, ["min_instance_count", "max_instance_count"], `${where} template scaling`);
  const min = numberAt(scaling, "min_instance_count", instances, 0);
  // 0 is the API's "unset": the revision maximum stays the documented 100.
  const max = numberAt(scaling, "max_instance_count", instances, 0) || 100;
  const containers = template ? blocks(template, "containers", TF_SCALING_LIMITS.maxContainers, where) : [];
  if (containers.length > 1) unsupported("Multi-container resource accounting is unsupported");
  return cloudRun(min, max, numberAt(template, "max_instance_request_concurrency", perInstance), containers[0]);
}
/** google_cloud_run_service (v1): Knative min/max scale annotations, container_concurrency, the container's limits. */
export function cloudRunV1Scaling(svc: TfBlock): ScalingResult {
  const where = "google_cloud_run_service";
  const template = only(svc, "template", where);
  const metadata = template && only(template, "metadata", `${where} template`);
  // Other annotations (Cloud SQL, VPC, launch stage) don't scale; Knative's other autoscaling keys do.
  const annotations = entries(
    metadata,
    "annotations",
    (k) => !k.startsWith(KNATIVE) || k === `${KNATIVE}minScale` || k === `${KNATIVE}maxScale`,
    "Cloud Run autoscaling annotations",
  );
  const spec = template && only(template, "spec", `${where} template`);
  const min = numberAt(annotations, `${KNATIVE}minScale`, instances, 0);
  const max = numberAt(annotations, `${KNATIVE}maxScale`, instances, 0) || 100;
  const containers = spec ? blocks(spec, "containers", TF_SCALING_LIMITS.maxContainers, where) : [];
  if (containers.length > 1) unsupported("Multi-container resource accounting is unsupported");
  return cloudRun(min, max, numberAt(spec, "container_concurrency", perInstance), containers[0]);
}
