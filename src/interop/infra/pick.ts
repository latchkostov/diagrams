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
  const dependencies = new Map<string, Set<string>>();
  const routes = new Map<string, Map<string, Set<string>>>();
  for (const l of g.links) {
    if (l.relation !== "flow" || l.props?.deny || l.props?.dlq || typeof l.props?.group !== "string") continue;
    const groups = routes.get(l.from) ?? new Map<string, Set<string>>();
    const targets = groups.get(l.props.group) ?? new Set<string>();
    targets.add(l.to);
    groups.set(l.props.group, targets);
    routes.set(l.from, groups);
  }
  for (const c of g.components) {
    const a = c.props?.autoscaling as AutoscalingConfig | undefined;
    if (a?.mode !== "on" || a.controller.kind !== "keda") continue;
    const required = new Set<string>();
    for (const t of a.controller.triggers) {
      required.add(t.source.node);
      if (t.source.group)
        for (const target of routes.get(t.source.node)?.get(t.source.group) ?? []) required.add(target);
    }
    dependencies.set(c.key, required);
  }
  return (kept: Set<string>) => {
    // Set iteration also visits newly added dependencies, including chained policies and cycles.
    for (const key of kept)
      for (const dependency of dependencies.get(key) ?? []) if (existing.has(dependency)) kept.add(dependency);
    return kept;
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
  const drawn = new Set<string>();
  const chosen: string[] = [];
  const close = dependenciesOf(g);
  for (const s of shares) {
    const included = close(s.loose);
    let added = 0;
    for (const k of included) if (!drawn.has(k)) added++;
    if (drawn.size + added > (chosen.length ? budget : MAX_DRAWN)) continue;
    chosen.push(s.key);
    for (const k of included) drawn.add(k);
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
  dependenciesOf(g)(kept);
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
