import type { DiagramFile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { getStencil } from "../stencils/registry";
import { stencilLabel } from "../i18n/stencils";
import { t } from "../i18n";
import { toneLabel } from "../canvas/groupTones";
import type { Check, SubjectSpec, Tutorial } from "./types";
import type { LiveState } from "../live/controller";
import type { EditorModeState } from "../canvas/interaction/mode";
import type { SlowState } from "../live/slowmo/session";

/** What a step can see: the sandbox diagram, whether it's live, and Live's counters (real messages). */
export interface SandboxView {
  diagram: DiagramFile;
  live: boolean;
  processed(nodeId: string): number;
  session?: LiveState;
  mode?: EditorModeState;
  slowmo?: Pick<SlowState, "status">;
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
  return subjects;
}

/** Subjects whose naming completion matters to this check. */
export const namingSubjects = (check: Check): string[] =>
  check.kind === "label" ? [check.subject] : check.kind === "all" ? check.checks.flatMap(namingSubjects) : [];

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  );
};

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
    case "prop": {
      const props = check.edge ? edge(check.edge)?.props : node(check.subject)?.props;
      return compare(props?.[check.prop], check.op, check.value);
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
        )
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
      if (!view.live || !view.session) return false;
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
      return view.mode?.value === check.value;
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

/** Every step's check against one view of the sandbox. */
export function observeSteps(
  tutorial: Tutorial,
  view: SandboxView,
  subjects = resolveSubjects(tutorial, view.diagram),
): boolean[] {
  return tutorial.steps.map((step) => holds(step.check, view, subjects));
}

/** A test id with its subjects filled in, or null while one of them isn't in the sandbox yet. */
export function fillTestId(testId: string, subjects: Record<string, string | undefined>): string | null {
  let missing = false;
  const filled = testId.replace(/\{(\w+)\}/g, (_, name: string) => {
    const id = subjects[name];
    if (!id) missing = true;
    return id ?? "";
  });
  return missing ? null : filled;
}
