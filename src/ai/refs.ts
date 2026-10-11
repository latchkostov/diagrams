import type { DiagramFile } from "../model/types";
import { scoreQuery } from "../palette/fuzzy";
import type { Candidate, Ref } from "./index";

export class ReferenceError extends Error {
  readonly ref: string;
  readonly candidates: Candidate[];
  readonly hint = "Use an id from candidates, or call describe_diagram.";
  constructor(ref: string, candidates: Candidate[], ambiguous = candidates.length > 1) {
    super(
      ambiguous
        ? `${JSON.stringify(ref)} matches ${candidates.length} elements.`
        : `Unknown reference ${JSON.stringify(ref)}.`,
    );
    this.name = "ReferenceError";
    this.ref = ref;
    this.candidates = candidates.map(({ id, label, stencil }) => ({ id, label, ...(stencil ? { stencil } : {}) }));
  }
}
export const normalizeRef = (s: string) => s.toLowerCase().replace(/\s+/g, "");

type Element = Candidate & { sublabel?: string; endpoint: boolean; from?: string; to?: string };
const EMPTY_KEYS: ReadonlyMap<string, string> = new Map();

/** Batch-owned indexes; candidates are copied so renamed labels can be removed from old buckets. */
export class RefIndex {
  readonly elements = new Map<string, Element>();
  readonly nodes = new Map<string, DiagramFile["nodes"][number]>();
  readonly labels = new Map<string, Set<string>>();
  readonly composites = new Map<string, Set<string>>();
  readonly connections = new Map<string, Set<string>>();
  constructor(diagram: DiagramFile) {
    for (const n of diagram.nodes) {
      this.nodes.set(n.id, n);
      this.upsert({ ...n, endpoint: true });
    }
    for (const e of diagram.edges) this.upsert({ ...e, label: e.label ?? "", endpoint: false });
    for (const g of diagram.groups ?? []) this.upsert({ ...g, endpoint: false });
    for (const a of diagram.annotations ?? []) this.upsert({ ...a, label: a.text, endpoint: a.kind === "shape" });
  }
  private bucket(map: Map<string, Set<string>>, key: string, id: string) {
    const ids = map.get(key) ?? new Set<string>();
    ids.add(id);
    map.set(key, ids);
  }
  private edgeKey(e: Element) {
    return JSON.stringify([e.from, e.to]);
  }
  upsert(element: Element) {
    this.remove(element.id);
    const e = { ...element };
    this.elements.set(e.id, e);
    this.bucket(this.labels, normalizeRef(e.label), e.id);
    if (e.sublabel) this.bucket(this.composites, normalizeRef(`${e.label} (${e.sublabel})`), e.id);
    if (e.from && e.to) this.bucket(this.connections, this.edgeKey(e), e.id);
  }
  remove(id: string) {
    const old = this.elements.get(id);
    if (!old) return;
    for (const [map, key] of [
      [this.labels, normalizeRef(old.label)],
      [this.composites, normalizeRef(`${old.label} (${old.sublabel})`)],
      [this.connections, this.edgeKey(old)],
    ] as const) {
      const ids = map.get(key);
      ids?.delete(id);
      if (!ids?.size) map.delete(key);
    }
    this.elements.delete(id);
    this.nodes.delete(id);
  }
  refresh(diagram: DiagramFile, id: string) {
    const n = diagram.nodes.find((n) => n.id === id);
    if (n) {
      this.upsert({ ...n, endpoint: true });
      this.nodes.set(id, n);
      return;
    }
    const e = diagram.edges.find((e) => e.id === id);
    if (e) {
      this.upsert({ ...e, label: e.label ?? "", endpoint: false });
      return;
    }
    const g = diagram.groups?.find((g) => g.id === id);
    if (g) {
      this.upsert({ ...g, endpoint: false });
      return;
    }
    const a = diagram.annotations?.find((a) => a.id === id);
    if (a) this.upsert({ ...a, label: a.text, endpoint: a.kind === "shape" });
    else this.remove(id);
  }
}

/** Returns real ids; never picks arbitrarily from multiple fuzzy matches. */
export function resolveRef(
  diagram: DiagramFile,
  ref: Ref,
  keys: ReadonlyMap<string, string> = EMPTY_KEYS,
  index = new RefIndex(diagram),
): string {
  const resolve = (query: string, endpointsOnly = false): string => {
    const permitted = (e: Element | undefined): e is Element => !!e && (!endpointsOnly || e.endpoint);
    const candidates = (ids: Iterable<string> = []) => [...ids].map((id) => index.elements.get(id)).filter(permitted);
    const choose = (matches: Candidate[]) => {
      if (matches.length === 1) return matches[0].id;
      throw new ReferenceError(
        query,
        matches.length ? matches : [...index.elements.values()].filter(permitted).slice(0, 20),
        matches.length > 1,
      );
    };
    const exactId = index.elements.get(query);
    if (permitted(exactId)) return exactId.id;
    const key = keys.get(query);
    if (key) return choose(candidates([key]));
    const normalized = normalizeRef(query);
    const labels = candidates(index.labels.get(normalized));
    if (labels.length) return choose(labels);
    const composite = candidates(index.composites.get(normalized));
    if (composite.length) return choose(composite);
    if (!endpointsOnly && query.includes("->")) {
      const parts = query.split("->");
      if (parts.length === 2) {
        const from = resolve(parts[0].trim(), true),
          to = resolve(parts[1].trim(), true);
        return choose(candidates(index.connections.get(JSON.stringify([from, to]))));
      }
    }
    return choose(
      [...index.elements.values()].filter(
        (e) =>
          permitted(e) &&
          Math.max(scoreQuery(query, { label: e.label }), e.sublabel ? scoreQuery(query, { label: e.sublabel }) : 0) >
            0,
      ),
    );
  };
  return resolve(ref);
}
