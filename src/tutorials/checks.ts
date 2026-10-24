import type { DiagramFile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { getStencil } from "../stencils/registry";
import { stencilLabel } from "../i18n/stencils";
import type { Check, SubjectSpec, Tutorial } from "./types";

/** What a step can see: the sandbox diagram, whether it's live, and Live's counters (real messages). */
export interface SandboxView {
  diagram: DiagramFile;
  live: boolean;
  processed(nodeId: string): number;
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
    const node = diagram.nodes.find((n) => n.id === previous[name] && fits(spec, n.stencil));
    if (node && !used.has(node.id)) {
      subjects[name] = node.id;
      used.add(node.id);
    }
  }
  for (const [name, spec] of Object.entries(tutorial.subjects)) {
    if (subjects[name]) continue;
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
  if (check.kind !== "label") return null;
  const id = subjects[check.subject];
  const node = id ? view.diagram.nodes.find((n) => n.id === id) : undefined;
  const typed = node?.label.trim() ?? "";
  const expected = check.is();
  if (!node || !typed || same(typed, expected)) return null;
  const stencil = getStencil(node.stencil);
  if (same(typed, stencil.label) || same(typed, stencilLabel(stencil))) return null;
  return { expected, typed };
}

export function holds(check: Check, view: SandboxView, subjects: Record<string, string | undefined>): boolean {
  switch (check.kind) {
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
      const node = id ? view.diagram.nodes.find((n) => n.id === id) : undefined;
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
