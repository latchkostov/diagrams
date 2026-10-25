import type { DiagramFile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { getStencil } from "../stencils/registry";
import { stencilLabel } from "../i18n/stencils";
import { t } from "../i18n";
import { toneLabel } from "../canvas/groupTones";
import type {
  Check,
  EdgeMetric,
  MetricComparison,
  MetricExpr,
  MetricValue,
  NodeMetric,
  SubjectSpec,
  Tutorial,
} from "./types";
import type { Baseline } from "./machine";
import { equal, readPath } from "./paths";
import type { LiveState } from "../live/controller";
import type { EditorModeState } from "../canvas/interaction/mode";
import type { SlowState } from "../live/slowmo/session";

/** What a step can see: the sandbox diagram, whether it's live, and Live's counters (real messages). */
export interface SandboxView {
  diagram: DiagramFile;
  live: boolean;
  processed(nodeId: string): number;
  session?: LiveState;
  /** False between an editor topology change and Live's rebuilt run. Other session state remains observable. */
  trafficReady?: boolean;
  mode?: EditorModeState;
  slowmo?: Pick<SlowState, "status">;
  dependencies?: boolean;
  presenting?: boolean;
  sharing?: boolean;
  /** The judged step's `sinceStep` baselines (RunnerState.baseline): only the current step has them. */
  baseline?: Baseline;
}

const fits = (spec: SubjectSpec, stencil: string) =>
  spec.stencils ? spec.stencils.includes(stencil) : !!spec.role && stencilRole(stencil) === spec.role;

/** Distinct subjects keep their existing matching nodes, then claim unbound matches in diagram order. */
export function resolveSubjects(
  tutorial: Tutorial,
  diagram: DiagramFile,
  previous: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const subjects: Record<string, string | undefined> = {};
  const used = new Set<string>();
  for (const [name, spec] of Object.entries(tutorial.subjects)) {
    if (spec.edge) continue;
    if (spec.boundary) {
      const group = diagram.groups?.find((g) => g.id === previous[name] && !used.has(g.id));
      if (group) {
        subjects[name] = group.id;
        used.add(group.id);
      }
      continue;
    }
    const node = diagram.nodes.find((n) => n.id === previous[name] && fits(spec, n.stencil));
    if (node && !used.has(node.id)) {
      subjects[name] = node.id;
      used.add(node.id);
    }
  }
  for (const [name, spec] of Object.entries(tutorial.subjects)) {
    if (spec.edge) continue;
    if (subjects[name]) continue;
    if (spec.boundary) {
      const group = diagram.groups?.find((g) => !used.has(g.id));
      subjects[name] = group?.id;
      if (group) used.add(group.id);
      continue;
    }
    const node = diagram.nodes.find((n) => !used.has(n.id) && fits(spec, n.stencil));
    subjects[name] = node?.id;
    if (node) used.add(node.id);
  }
  for (const [name, spec] of Object.entries(tutorial.subjects)) {
    if (!spec.edge) continue;
    const edge =
      diagram.edges.find((e) => e.id === previous[name]) ??
      diagram.edges.find((e) => e.from === subjects[spec.edge![0]] && e.to === subjects[spec.edge![1]]);
    subjects[name] = edge?.id;
  }
  return subjects;
}

/** Subjects whose naming completion matters to this check. */
export const namingSubjects = (check: Check): string[] =>
  check.kind === "label" ? [check.subject] : check.kind === "all" ? check.checks.flatMap(namingSubjects) : [];

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
/**
 * The expectText pattern's near miss: a `label` check whose subject has been given a name of its own that isn't the
 * expected one ("Order API" for "Orders API"). Null while it matches (case and outer spaces aside), while it still has
 * its stencil's own name, or before it exists. Every naming step gets it: the strip says what's expected and offers it.
 */
export function nearMiss(
  check: Check,
  view: Pick<SandboxView, "diagram">,
  subjects: Record<string, string | undefined>,
): { expected: string; typed: string } | null {
  if (check.kind === "all") return check.checks.map((c) => nearMiss(c, view, subjects)).find((m) => m !== null) ?? null;
  if (check.kind !== "label") return null;
  const id = subjects[check.subject];
  const node = id ? view.diagram.nodes.find((n) => n.id === id) : undefined;
  const group = id ? view.diagram.groups?.find((g) => g.id === id) : undefined;
  const typed = (node?.label ?? group?.label)?.trim() ?? "";
  const expected = check.is();
  if ((!node && !group) || !typed || same(typed, expected)) return null;
  if (!node)
    return same(typed, t("chrome.untitledBoundary")) || Object.values(toneLabel).some((label) => same(typed, label))
      ? null
      : { expected, typed };
  const stencil = getStencil(node.stencil);
  if (same(typed, stencil.label) || same(typed, stencilLabel(stencil))) return null;
  return { expected, typed };
}

export function holds(check: Check, view: SandboxView, subjects: Record<string, string | undefined>): boolean {
  const node = (name: string) => view.diagram.nodes.find((n) => n.id === subjects[name]);
  const edge = (pair: readonly [string, string]) => {
    const from = subjects[pair[0]],
      to = subjects[pair[1]];
    return from && to ? view.diagram.edges.find((e) => e.from === from && e.to === to) : undefined;
  };
  const compare = (actual: unknown, op: "=" | ">=" | "<=", value: unknown) =>
    actual !== undefined &&
    (op === "="
      ? equal(actual, value)
      : typeof actual === "number" && typeof value === "number" && (op === ">=" ? actual >= value : actual <= value));
  switch (check.kind) {
    case "selection": {
      const selected = view.mode?.selection ?? [];
      return (
        selected.length >= (check.atLeast ?? check.subjects?.length ?? 1) &&
        (!check.exact || selected.length === check.subjects?.length) &&
        (check.subjects?.every((s) => !!subjects[s] && selected.includes(subjects[s]!)) ?? true)
      );
    }
    case "aligned": {
      const nodes = check.subjects
        ? check.subjects.map(node)
        : (view.mode?.selection ?? []).map((id) => view.diagram.nodes.find((n) => n.id === id));
      return (
        nodes.length >= (check.atLeast ?? 2) && nodes.every((n) => !!n && n[check.axis] === nodes[0]?.[check.axis])
      );
    }
    case "dependencies":
      return view.dependencies === check.visible;
    case "presenting":
      return view.presenting === check.on;
    case "sharing":
      return view.sharing === true;
    case "acknowledge":
      return false;
    case "prop": {
      const target = check.edge ? edge(check.edge) : node(check.subject);
      const actual =
        check.edge && (check.prop === "sourceSide" || check.prop === "targetSide")
          ? edge(check.edge)?.[check.prop]
          : readPath(target?.props, typeof check.prop === "string" ? [check.prop] : check.prop);
      if (check.measure === "length") return Array.isArray(actual) && compare(actual.length, check.op, check.value);
      return compare(actual, check.op, check.value);
    }
    case "compare": {
      const left = expressionValue(check.left, view, subjects);
      const right = typeof check.right === "number" ? check.right : expressionValue(check.right, view, subjects);
      return left !== undefined && right !== undefined && order(left, check.op, right);
    }
    case "relation": {
      const from = subjects[check.from],
        to = subjects[check.to];
      return (
        !!from &&
        !!to &&
        view.diagram.edges.some(
          (e) =>
            e.from === from &&
            e.to === to &&
            (check.relation === undefined || (e.relation ?? "flow") === check.relation) &&
            (check.edgeKind === undefined || e.kind === check.edgeKind),
        ) === !check.absent
      );
    }
    case "member": {
      const boundary = subjects[check.boundary];
      return (
        !!boundary && !!view.diagram.groups?.some((g) => g.id === boundary) && node(check.subject)?.group === boundary
      );
    }
    case "annotation":
      return (view.diagram.annotations?.filter((a) => a.kind === check.annotation).length ?? 0) >= (check.count ?? 1);
    case "metric": {
      if (!view.live || !view.session || view.trafficReady === false) return false;
      const id = subjects[check.subject];
      const metrics = id ? view.session.snapshot.nodes[id] : undefined;
      const actual =
        check.field === "latency.p95"
          ? metrics?.latency?.p95
          : check.field === "threads.waiting"
            ? metrics?.threads?.waiting
            : check.field === "breaker"
              ? check.edge
                ? view.session.snapshot.edges[edge(check.edge)?.id ?? ""]?.breaker?.state
                : view.diagram.edges
                    .filter((e) => e.from === id)
                    .map((e) => view.session!.snapshot.edges[e.id]?.breaker?.state)
                    .find((s) => s === check.value)
              : metrics?.[check.field];
      return compare(actual, check.op, check.value);
    }
    case "simulation":
      return (
        view.live &&
        !view.session?.needsRestart &&
        view.session?.running?.id === check.id &&
        (check.traffic === undefined || view.session.traffic === check.traffic) &&
        !!view.session.run &&
        view.session.run.time >= (check.atLeastMs ?? 0)
      );
    case "expectation": {
      const label = typeof check.label === "function" ? check.label() : check.label;
      return (
        view.live &&
        !view.session?.needsRestart &&
        view.session?.running?.id === check.simulation &&
        !!view.session.run?.expectations.some((e) => (e.id === label || e.label === label) && e.status === "pass")
      );
    }
    case "fault": {
      if (!view.live || !view.session) return false;
      const id = check.edge ? edge(check.edge)?.id : subjects[check.subject];
      if (!id) return false;
      const down = view.session.snapshot.nodes[id]?.status === "down";
      const matches = view.session.snapshot.faults?.some((f) =>
        f.kind === "boundary"
          ? f.boundary === id && f.down && (!check.fault || check.fault === "down")
          : f.kind === "link"
            ? f.edge === id && f.cut && (!check.fault || check.fault === "cut")
            : f.node === id &&
              (!check.fault || check.fault === f.kind) &&
              (f.kind === "slow" ? f.factor > 1 : f.rate > 0),
      );
      return ((!check.fault || check.fault === "down") && down) || !!matches;
    }
    case "trace":
      return view.live && !!view.session?.trace;
    case "slowmo":
      return view.live && (view.slowmo?.status === "on" || view.slowmo?.status === "capturing");
    case "note":
      return view.live && !!view.session?.run && view.session.run.waiting === check.waiting;
    case "mode":
      return (
        view.mode?.value === check.value &&
        (!check.subject || (!!subjects[check.subject] && view.mode.target === subjects[check.subject]))
      );
    case "field": {
      const actual = node(check.subject)?.[check.field]?.trim();
      return !!actual && (!check.is || same(actual, check.is()));
    }
    case "node":
      return !!subjects[check.subject];
    case "edge": {
      const from = subjects[check.from];
      const to = subjects[check.to];
      return (
        !!from &&
        !!to &&
        view.diagram.edges.some((e) => e.from === from && e.to === to && (e.relation ?? "flow") === "flow")
      );
    }
    case "label": {
      const id = subjects[check.subject];
      const node = id
        ? (view.diagram.nodes.find((n) => n.id === id) ?? view.diagram.groups?.find((g) => g.id === id))
        : undefined;
      return !!node && same(node.label, check.is());
    }
    case "live":
      return view.live;
    case "processed": {
      const id = subjects[check.subject];
      return view.live && !!id && view.processed(id) >= check.atLeast;
    }
    case "all":
      return check.checks.every((c) => holds(c, view, subjects));
  }
}

const order = (left: number, op: MetricComparison, right: number) =>
  op === "="
    ? left === right
    : op === ">="
      ? left >= right
      : op === "<="
        ? left <= right
        : op === ">"
          ? left > right
          : left < right;

type SimNode = NonNullable<SandboxView["session"]>["snapshot"]["nodes"][string];
const reading = (metrics: SimNode | undefined, field: NodeMetric): unknown =>
  field === "latency.p95"
    ? metrics?.latency?.p95
    : field === "threads.waiting"
      ? metrics?.threads?.waiting
      : metrics?.[field];
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** A sum is known only when every term is: an empty set, or one node without the reading, isn't zero. */
const total = (terms: readonly (number | undefined)[]) =>
  terms.length && terms.every((t) => t !== undefined) ? terms.reduce<number>((sum, t) => sum + t!, 0) : undefined;

/**
 * A Live number in real units, or undefined until the run shows this diagram (as `metric` checks wait for it): while
 * Live is off, before its session, or between a topology edit and the rebuilt run.
 */
export function metricValue(
  expr: MetricValue,
  view: SandboxView,
  subjects: Record<string, string | undefined>,
): number | undefined {
  const session = view.session;
  if (!view.live || !session || view.trafficReady === false) return undefined;
  const node = (id: string | undefined, field: NodeMetric) =>
    id ? finite(reading(session.snapshot.nodes[id], field)) : undefined;
  const edge = (id: string | undefined, field: EdgeMetric) =>
    id ? finite(session.snapshot.edges[id]?.[field]) : undefined;
  const between = (pair: readonly [string, string]) => {
    const from = subjects[pair[0]],
      to = subjects[pair[1]];
    return from && to ? view.diagram.edges.find((e) => e.from === from && e.to === to)?.id : undefined;
  };
  if ("metric" in expr)
    return "node" in expr ? node(subjects[expr.node], expr.metric) : edge(between(expr.edge), expr.metric);
  if ("nodes" in expr) return total(expr.nodes.map((name) => node(subjects[name], expr.sum)));
  if ("every" in expr)
    return total(view.diagram.nodes.filter((n) => fits(expr.every, n.stencil)).map((n) => node(n.id, expr.sum)));
  if ("edges" in expr) return total(expr.edges.map((pair) => edge(between(pair), expr.sum)));
  const from = subjects[expr.from];
  return from
    ? total(
        view.diagram.edges
          .filter((e) => e.from === from && (e.relation ?? "flow") === "flow")
          .map((e) => edge(e.id, expr.sum)),
      )
    : undefined;
}

/** A `sinceStep` baseline's key in RunnerState.baseline: the expression itself (plain data). */
export const baselineKey = (expr: MetricValue) => JSON.stringify(expr);

/** The `sinceStep` expressions a check counts from its step's start. */
export const sinceValues = (check: Check): MetricValue[] =>
  check.kind === "all"
    ? check.checks.flatMap(sinceValues)
    : check.kind === "compare"
      ? [check.left, check.right].flatMap((e) => (typeof e === "object" && "sinceStep" in e ? [e.sinceStep] : []))
      : [];

/** A delta since the step began. A rebuilt run (another generation) counts from zero: all of it came after. */
function expressionValue(expr: MetricExpr, view: SandboxView, subjects: Record<string, string | undefined>) {
  if (!("sinceStep" in expr)) return metricValue(expr, view, subjects);
  const now = metricValue(expr.sinceStep, view, subjects);
  const base = view.baseline?.[baselineKey(expr.sinceStep)];
  if (now === undefined || !base) return undefined;
  return view.session!.generation === base[1] ? now - base[0] : now;
}

/** Every step's check against one view of the sandbox. */
export function observeSteps(
  tutorial: Tutorial,
  view: SandboxView,
  subjects = resolveSubjects(tutorial, view.diagram),
): boolean[] {
  return tutorial.steps.map((step) => holds(step.check, view, subjects));
}

/**
 * A test id with its subjects filled in, or null while one of them isn't in the sandbox yet. `{a->b}` is the connection
 * from subject a to subject b, from `edges` (edgeTargets): its id in the sandbox, never an example's saved id.
 */
export function fillTestId(
  testId: string,
  subjects: Record<string, string | undefined>,
  edges: Readonly<Record<string, string>> = {},
): string | null {
  let missing = false;
  const filled = testId.replace(/\{(\w+)(?:->(\w+))?\}/g, (_, name: string, to?: string) => {
    const id = to ? edges[`${name}->${to}`] : subjects[name];
    if (!id) missing = true;
    return id ?? "";
  });
  return missing ? null : filled;
}

/** Each connection between two bound subjects, by `from->to`: the first edge from one to the other. */
export function edgeTargets(
  diagram: DiagramFile,
  subjects: Record<string, string | undefined>,
): Record<string, string> {
  const names = new Map<string, string[]>();
  for (const [name, id] of Object.entries(subjects)) if (id) names.set(id, [...(names.get(id) ?? []), name]);
  const edges: Record<string, string> = {};
  for (const edge of diagram.edges)
    for (const from of names.get(edge.from) ?? [])
      for (const to of names.get(edge.to) ?? []) edges[`${from}->${to}`] ??= edge.id;
  return edges;
}
