import type { AutoscalingConfig } from "../../model/autoscaling";
import { diagnostic, type ImportGraph, type PickGroup } from "./graph";

// Big imports (docs/research/imports.md § UX, "Big imports"): past PICK_OVER nodes, an import with boundaries
// (namespaces, Terraform modules or resource groups, AsyncAPI servers, compose networks) draws the boundaries with
// the most flows, and the Import report lists them all with a checkbox each to draw another set. What's in no
// boundary is one more entry, so nothing is out of reach. Pure data: the report keeps the whole import as an
// ImportGraph (names and connections, never the source text).

/** The importer's own cap: anything bigger isn't drawn (the validator's budget is the same). */
export const MAX_DRAWN = 5_000;

/** More nodes than this to draw, and the import draws part of it and asks in the report. */
export const PICK_OVER = 300;

/** The picker's entry for the components in no boundary (a Terraform root module, Users, outside services). */
export const UNGROUPED = "\u0000ungrouped";
export const UNGROUPED_LABEL = "Not in a boundary";

/**
 * One entry of the picker: a boundary's members (or, for UNGROUPED, every component in no boundary) and the loose
 * nodes it brings along (Users, outside services it connects to).
 */
interface Share {
  key: string;
  label: string;
  /** Its own nodes, as the report counts them. */
  members: number;
  flows: number;
  loose: Set<string>;
}

/** Policy references are graph dependencies too, even across namespace boundaries. */
function dependenciesOf(g: ImportGraph) {
  const existing = new Set(g.components.map((c) => c.key));
  // A broker/group is one shared vertex, never a copy of its readers per scaler.
  const dependencies = new Map<string, Set<Set<string>>>();
  const routes = new Map<string, Map<string | undefined, Set<string>>>();
  for (const l of g.links) {
    if (l.relation !== "flow" || l.props?.deny || l.props?.dlq || typeof l.props?.group !== "string") continue;
    const groups = routes.get(l.from) ?? new Map<string | undefined, Set<string>>();
    const targets = groups.get(l.props.group) ?? new Set<string>();
    targets.add(l.to);
    groups.set(l.props.group, targets);
    routes.set(l.from, groups);
  }
  for (const c of g.components) {
    const a = c.props?.autoscaling as AutoscalingConfig | undefined;
    if (a?.mode !== "on" || a.controller.kind !== "keda") continue;
    const required = new Set<Set<string>>();
    for (const t of a.controller.triggers) {
      const groups = routes.get(t.source.node) ?? new Map<string | undefined, Set<string>>();
      const group = t.source.group || undefined;
      const targets = groups.get(group) ?? new Set<string>();
      targets.add(t.source.node);
      groups.set(group, targets);
      routes.set(t.source.node, groups);
      required.add(targets);
    }
    dependencies.set(c.key, required);
  }
  return { existing, dependencies };
}

/** Bound automatic closure caching and candidate expansion across the whole import, not per boundary. */
export const MAX_DEPENDENCY_WORK = MAX_DRAWN * 24;

function dependencyPicker(g: ImportGraph) {
  const { existing, dependencies } = dependenciesOf(g);
  const cache = new Map<
    Set<string>,
    | {
        nodes: Set<string>;
        vertices: Set<Set<string>>;
        pending?: { generation: number; nodes: Set<string> };
      }
    | undefined
  >();
  const drawn = new Set<string>();
  const expanded = new Set<Set<string>>();
  let work = 0;
  let generation = 0;
  return (roots: Set<string>, limit: number): boolean => {
    const added = new Set<string>();
    const vertices = new Set<Set<string>>();
    for (const key of roots) {
      if (!drawn.has(key)) added.add(key);
      for (const vertex of dependencies.get(key) ?? []) vertices.add(vertex);
      if (++work > MAX_DEPENDENCY_WORK || drawn.size + added.size > limit) return false;
    }
    for (const vertex of vertices) {
      if (expanded.has(vertex)) continue;
      if (!cache.has(vertex)) {
        const nodes = new Set<string>();
        const reachable = new Set([vertex]);
        let complete = true;
        // Iterative traversal handles chained policies and cycles without recursive stack growth.
        for (const next of reachable) {
          for (const key of next) {
            if (++work > MAX_DEPENDENCY_WORK) {
              complete = false;
              break;
            }
            if (!existing.has(key)) continue;
            nodes.add(key);
            if (nodes.size > Math.min(limit, MAX_DRAWN)) {
              complete = false;
              break;
            }
            for (const ref of dependencies.get(key) ?? []) reachable.add(ref);
          }
          if (!complete) break;
        }
        cache.set(vertex, complete ? { nodes, vertices: reachable } : undefined);
      }
      const closure = cache.get(vertex);
      // The closure alone cannot fit: reject without scanning it again for each boundary.
      if (!closure || closure.nodes.size > limit) return false;
      // Cache the intersection with the current drawing too: a nearly fitting shared route must
      // not scan all its already drawn readers again for every rejected workload.
      if (closure.pending?.generation !== generation) {
        const nodes = new Set<string>();
        for (const key of closure.nodes) {
          if (++work > MAX_DEPENDENCY_WORK) return false;
          if (!drawn.has(key)) nodes.add(key);
        }
        closure.pending = { generation, nodes };
      }
      if (drawn.size + closure.pending.nodes.size > limit) return false;
      for (const key of closure.pending.nodes) {
        if (++work > MAX_DEPENDENCY_WORK) return false;
        if (!drawn.has(key)) added.add(key);
        if (drawn.size + added.size > limit) return false;
      }
    }
    if (added.size) generation++;
    for (const key of added) drawn.add(key);
    for (const vertex of vertices) {
      const closure = cache.get(vertex);
      if (closure) for (const ref of closure.vertices) expanded.add(ref);
    }
    return true;
  };
}

function sharesOf(g: ImportGraph): Share[] {
  const groupOf = new Map(g.components.map((c) => [c.key, c.group]));
  const shares = new Map<string, Share>(
    g.groups.map((gr) => [gr.key, { key: gr.key, label: gr.label, members: 0, flows: 0, loose: new Set() }]),
  );
  const ungrouped: Share = { key: UNGROUPED, label: UNGROUPED_LABEL, members: 0, flows: 0, loose: new Set() };
  for (const c of g.components) {
    if (c.group === undefined) {
      ungrouped.members++;
      ungrouped.loose.add(c.key);
      continue;
    }
    const s = shares.get(c.group);
    if (s) {
      s.members++;
      s.loose.add(c.key);
    }
  }
  const shareOf = (key: string): Share | undefined => {
    const group = groupOf.get(key);
    return group === undefined ? ungrouped : shares.get(group);
  };
  for (const l of g.links) {
    if (!groupOf.has(l.from) || !groupOf.has(l.to)) continue;
    const a = shareOf(l.from);
    const b = shareOf(l.to);
    // A flow counts for each entry it touches, once.
    if (l.relation === "flow") for (const s of new Set([a, b])) if (s) s.flows++;
    // A loose end comes along with the boundary it connects to.
    if (a && a !== ungrouped && b === ungrouped) a.loose.add(l.to);
    if (b && b !== ungrouped && a === ungrouped) b.loose.add(l.from);
  }
  return [...shares.values(), ungrouped].filter((s) => s.members > 0);
}

/** The most flows first, then the most nodes, then by name: the order the report lists them in. */
const byFlows = (a: Share, b: Share) =>
  b.flows - a.flows || b.members - a.members || a.label.localeCompare(b.label, "en", { numeric: true });

/**
 * What a big import draws first: entries by flows, each added while the drawing stays within `budget` nodes
 * (PICK_OVER for an import; Draw everything draws up to MAX_DRAWN). The first one drawable at all is taken even past
 * the budget, but never past MAX_DRAWN, loose nodes included: an oversized entry is skipped, not drawn, so a
 * smaller one still opens. Undefined when the import fits the budget whole, or has fewer than two entries to choose
 * from; empty when no entry fits MAX_DRAWN on its own.
 */
export function defaultPick(g: ImportGraph, budget = PICK_OVER): string[] | undefined {
  if (g.components.length <= budget) return undefined;
  const shares = sharesOf(g).sort(byFlows);
  if (shares.length < 2) return undefined;
  const chosen: string[] = [];
  const include = dependencyPicker(g);
  for (const s of shares) {
    if (include(s.loose, chosen.length ? budget : MAX_DRAWN)) chosen.push(s.key);
  }
  return chosen;
}

/**
 * The import with only the chosen entries: their members, the loose nodes connected to them (all of them with
 * UNGROUPED), and the links between what's left.
 */
export function pickGraph(g: ImportGraph, keys: readonly string[]): ImportGraph {
  const chosen = new Set(keys);
  const everyLoose = chosen.has(UNGROUPED);
  const kept = new Set(
    g.components.filter((c) => (c.group === undefined ? everyLoose : chosen.has(c.group))).map((c) => c.key),
  );
  const loose = new Set(g.components.filter((c) => c.group === undefined).map((c) => c.key));
  const brought = new Set<string>();
  for (const l of g.links) {
    if (kept.has(l.from) && loose.has(l.to)) brought.add(l.to);
    if (kept.has(l.to) && loose.has(l.from)) brought.add(l.from);
  }
  for (const k of brought) kept.add(k);
  const beforeScaling = kept.size;
  const { existing, dependencies } = dependenciesOf(g);
  const expanded = new Set<Set<string>>();
  for (const key of kept)
    for (const vertex of dependencies.get(key) ?? []) {
      if (expanded.has(vertex)) continue;
      expanded.add(vertex);
      for (const dependency of vertex) if (existing.has(dependency)) kept.add(dependency);
    }
  const groups = new Set(g.components.filter((c) => kept.has(c.key)).map((c) => c.group));
  return {
    ...g,
    notes: kept.size > beforeScaling ? [...g.notes, diagnostic("importReport.scalingDependencies")] : g.notes,
    components: g.components.filter((c) => kept.has(c.key)),
    links: g.links.filter((l) => kept.has(l.from) && kept.has(l.to)),
    groups: g.groups.filter((gr) => groups.has(gr.key)),
    ...(g.traffic ? { traffic: g.traffic.filter((t) => kept.has(t.key)) } : {}),
  };
}

/** How many nodes a pick draws (what the report's button says). */
export const pickedNodes = (g: ImportGraph, keys: readonly string[]) => pickGraph(g, keys).components.length;

/** Every entry of the import for the report's list, the most flows first, with the drawn ones ticked. */
export function pickGroups(g: ImportGraph, keys: readonly string[]): PickGroup[] {
  const chosen = new Set(keys);
  return sharesOf(g)
    .sort(byFlows)
    .map((s) => ({ key: s.key, label: s.label, nodes: s.members, flows: s.flows, drawn: chosen.has(s.key) }));
}

/** A picked diagram's title names what it draws: "shop (team-05 and team-39)", "shop (team-05, team-07 and 3 more)". */
export function pickedTitle(g: ImportGraph, keys: readonly string[]): string {
  const labels = new Map([
    ...g.groups.map((gr) => [gr.key, gr.label] as const),
    [UNGROUPED, UNGROUPED_LABEL.toLowerCase()],
  ]);
  const names = keys.map((k) => labels.get(k) ?? k);
  const what = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return `${g.title} (${what})`.slice(0, 200);
}
