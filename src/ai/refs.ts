import type { DiagramFile } from "../model/types";
import { scoreQuery } from "../palette/fuzzy";
import { getStencil } from "../stencils/registry";
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

/** A node a model's reply adds, before it exists: how the reply may refer to it. */
export interface NewNodeAlias {
  /** The batch key the core sees (in a namespace no element id can take). */
  key: string;
  /** The key the model wrote, if any. */
  alias?: string;
  kind: string;
  label: string;
}

/** Words that say little about which node is meant. */
const FILLER = new Set(["a", "an", "the", "new", "node", "of", "to", "for", "and", "service", "this"]);
export const refWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9.#+]+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));

const ci = (s: string) => normalizeRef(s);

/**
 * References in a small model's reply, resolved in one precedence order (the on-device pipeline):
 * 1. an existing element's exact id; 2. an existing element's exact label; 3. a key the reply set;
 * 4. an existing label or a new node's key or label, ignoring case and spaces (both matching is an
 * error); 5. a new node's kind; 6. a word shared with exactly one new node, more than with any existing
 * node; 7. otherwise the core's own resolution (sublabels, "A -> B", fuzzy), pinned to an id when unique.
 * Anything ambiguous is an error the model's retry can fix, never a silent pick. One RefIndex serves
 * the whole reply.
 */
export class ReplyRefs {
  readonly index: RefIndex;
  private readonly fresh: NewNodeAlias[] = [];
  constructor(
    private readonly diagram: DiagramFile,
    index?: RefIndex,
  ) {
    this.index = index ?? new RefIndex(diagram);
  }

  /** Is this text an existing element's id or label (ignoring case)? Model keys mustn't be. */
  existingName(s: string): boolean {
    if (this.index.elements.has(s)) return true;
    const n = ci(s);
    return this.index.labels.has(n) || [...this.index.elements.keys()].some((id) => ci(id) === n);
  }

  add(node: NewNodeAlias) {
    this.fresh.push(node);
  }

  /** The new node with this batch key. */
  newNode(key: string): NewNodeAlias | undefined {
    return this.fresh.find((f) => f.key === key);
  }

  private readonly existing = new Map<string, string | undefined>();
  /**
   * The id of an existing element `r` names (core resolution), or undefined. A new node's key is never
   * one, so it isn't looked up; other answers are cached for the reply (the fuzzy step scans everything).
   */
  existingId(r: string): string | undefined {
    if (r.startsWith("~") || this.newNode(r)) return undefined;
    if (this.existing.has(r)) return this.existing.get(r);
    let id: string | undefined;
    try {
      id = resolveRef(this.diagram, r, EMPTY_KEYS, this.index);
    } catch {
      id = undefined;
    }
    this.existing.set(r, id);
    return id;
  }

  /**
   * The one node a free phrase from the request means ("Java", "a Kafka topic"): a new node's key or an
   * existing node's id, by the words it shares with its label and kind. Null when none or a tie.
   */
  match(phrase: string): string | null {
    const words = refWords(phrase);
    if (!words.length) return null;
    const overlap = (...texts: string[]) => new Set(texts.flatMap(refWords).filter((w) => words.includes(w))).size;
    const scored = [
      ...this.fresh.map((f) => ({ ref: f.key, n: overlap(f.label, f.kind) })),
      ...[...this.index.nodes.values()].map((node) => ({
        ref: node.id,
        n: overlap(node.label, getStencil(node.stencil).label),
      })),
    ];
    const top = Math.max(0, ...scored.map((x) => x.n));
    const best = scored.filter((x) => x.n === top);
    return top > 0 && best.length === 1 ? best[0].ref : null;
  }

  /** Steps 1-5 only (exact names, keys, kinds): null when none applies. */
  strict(r: string): { ref: string } | { error: string } | null {
    const q = JSON.stringify(r);
    const elements = [...this.index.elements.values()];
    // 1-2: exact id, exact label.
    if (this.index.elements.has(r)) return { ref: r };
    const exactLabel = elements.filter((e) => e.label === r);
    if (exactLabel.length === 1) return { ref: exactLabel[0].id };
    if (exactLabel.length > 1) return { error: `${q} names ${exactLabel.length} elements: use one's id.` };
    // 3: a key the reply set, as written.
    const byAlias = this.fresh.filter((f) => f.alias === r);
    if (byAlias.length === 1) return { ref: byAlias[0].key };
    // 4: ignoring case and spaces, existing and new together.
    const n = ci(r);
    const old = elements.filter((e) => ci(e.label) === n || ci(e.id) === n);
    const mine = this.fresh.filter((f) => (f.alias !== undefined && ci(f.alias) === n) || ci(f.label) === n);
    if (old.length && mine.length)
      return { error: `${q} could be an existing element or a new node: use the new node's key.` };
    if (old.length > 1) return { error: `${q} names ${old.length} elements: use one's exact label.` };
    if (old.length === 1) return { ref: old[0].id };
    if (mine.length > 1) return { error: `${q} names ${mine.length} new nodes: use their keys.` };
    if (mine.length === 1) return { ref: mine[0].key };
    // 5: a new node's kind.
    const byKind = this.fresh.filter((f) => ci(f.kind) === n);
    if (byKind.length > 1) return { error: `${q} is the kind of ${byKind.length} new nodes: use their keys.` };
    if (byKind.length === 1) return { ref: byKind[0].key };
    return null;
  }

  resolve(r: string): { ref: string } | { error: string } {
    const exact = this.strict(r);
    if (exact) return exact;
    // 6: a word shared with exactly one new node, more than with any existing node.
    const words = refWords(r);
    if (words.length) {
      const overlap = (s: string) => refWords(s).filter((w) => words.includes(w)).length;
      const scored = this.fresh.map((f) => ({ f, n: Math.max(overlap(f.label), overlap(f.kind)) }));
      const top = Math.max(0, ...scored.map((x) => x.n));
      const best = scored.filter((x) => x.n === top && top > 0);
      const rival = Math.max(0, ...[...this.index.nodes.values()].map((node) => overlap(node.label)));
      if (best.length === 1 && top > rival) return { ref: best[0].f.key };
    }
    // 7: the core's resolution (sublabels, "A -> B", fuzzy), pinned when it's unique.
    return { ref: this.existingId(r) ?? r };
  }
}
