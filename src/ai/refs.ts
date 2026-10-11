import type { DiagramFile } from "../model/types";
import { scoreQuery } from "../palette/fuzzy";
import type { Candidate, Ref } from "./index";

export class ReferenceError extends Error {
  readonly candidates: Candidate[];
  readonly hint = "Use an id from candidates, or call describe_diagram.";
  constructor(ref: string, candidates: Candidate[], ambiguous = candidates.length > 1) {
    super(
      ambiguous
        ? `${JSON.stringify(ref)} matches ${candidates.length} elements.`
        : `Unknown reference ${JSON.stringify(ref)}.`,
    );
    this.name = "ReferenceError";
    this.candidates = candidates.map(({ id, label, stencil }) => ({ id, label, ...(stencil ? { stencil } : {}) }));
  }
}
export const normalizeRef = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** Returns real ids; never picks arbitrarily from multiple fuzzy matches. */
export function resolveRef(diagram: DiagramFile, ref: Ref, keys: ReadonlyMap<string, string> = new Map()): string {
  const elements = [
    ...diagram.nodes.map((n) => ({ id: n.id, label: n.label, stencil: n.stencil, sublabel: n.sublabel })),
    ...diagram.edges.map((e) => ({ id: e.id, label: e.label ?? "" })),
    ...(diagram.groups ?? []),
    ...(diagram.annotations ?? []).map((a) => ({ id: a.id, label: a.text })),
  ];
  const choose = (matches: Candidate[]) => {
    if (matches.length === 1) return matches[0].id;
    throw new ReferenceError(ref, matches.length ? matches : elements.slice(0, 20), matches.length > 1);
  };
  const id = elements.filter((e) => e.id === ref);
  if (id.length) return choose(id);
  const key = keys.get(ref);
  if (key) return choose(elements.filter((e) => e.id === key));
  const normalized = normalizeRef(ref);
  const exact = elements.filter((e) => normalizeRef(e.label) === normalized);
  if (exact.length) return choose(exact);
  const composite = elements.filter(
    (e) => "sublabel" in e && e.sublabel && normalizeRef(`${e.label} (${e.sublabel})`) === normalized,
  );
  if (composite.length) return choose(composite);
  if (ref.includes("->")) {
    const parts = ref.split("->");
    if (parts.length === 2) {
      // Resolve endpoints against nodes/shapes only, avoiding recursive edge-label references.
      const ends = {
        ...diagram,
        edges: [],
        groups: [],
        annotations: diagram.annotations?.filter((a) => a.kind === "shape"),
      };
      const from = resolveRef(ends, parts[0].trim(), keys);
      const to = resolveRef(ends, parts[1].trim(), keys);
      return choose(
        diagram.edges
          .filter((e) => e.from === from && e.to === to)
          .map((e) => ({ id: e.id, label: e.label ?? `${from} -> ${to}` })),
      );
    }
  }
  const fuzzy = elements.filter(
    (e) =>
      Math.max(
        scoreQuery(ref, { label: e.label }),
        "sublabel" in e && typeof e.sublabel === "string" ? scoreQuery(ref, { label: e.sublabel }) : 0,
      ) > 0,
  );
  return choose(fuzzy);
}
