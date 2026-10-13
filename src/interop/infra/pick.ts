import type { ImportGraph, PickGroup } from "./graph";

// Big imports (docs/research/imports.md § UX, "Big imports"): past PICK_OVER nodes, an import with boundaries
// (namespaces, Terraform modules or resource groups, AsyncAPI servers, compose networks) draws the boundaries with
// the most flows, and the Import report lists them all with a checkbox each to draw another set. Pure data: the
// report keeps the whole import as an ImportGraph (names and connections, never the source text).

/** The importer's own cap: anything bigger isn't drawn (the validator's budget is the same). */
export const MAX_DRAWN = 5_000;

/** More nodes than this to draw, and the import draws part of it and asks in the report. */
export const PICK_OVER = 300;

/** One boundary's share of the import: its members, and the loose nodes (Users, outside services) it brings. */
interface Share {
  key: string;
  label: string;
  members: number;
  flows: number;
  loose: Set<string>;
}

function sharesOf(g: ImportGraph): Share[] {
  const groupOf = new Map(g.components.map((c) => [c.key, c.group]));
  const shares = new Map<string, Share>(
    g.groups.map((gr) => [gr.key, { key: gr.key, label: gr.label, members: 0, flows: 0, loose: new Set() }]),
  );
  for (const c of g.components) {
    const s = c.group === undefined ? undefined : shares.get(c.group);
    if (s) s.members++;
  }
  for (const l of g.links) {
    const a = groupOf.get(l.from);
    const b = groupOf.get(l.to);
    if (a === undefined && b === undefined) continue;
    // A flow counts for each boundary it touches, once.
    if (l.relation === "flow")
      for (const k of new Set([a, b])) {
        const s = k === undefined ? undefined : shares.get(k);
        if (s) s.flows++;
      }
    // A loose end comes along with the boundary it connects to.
    if (a !== undefined && b === undefined && groupOf.has(l.to)) shares.get(a)?.loose.add(l.to);
    if (b !== undefined && a === undefined && groupOf.has(l.from)) shares.get(b)?.loose.add(l.from);
  }
  return [...shares.values()].filter((s) => s.members > 0);
}

/** The most flows first, then the most nodes, then by name: the order the report lists them in. */
const byFlows = (a: Share, b: Share) =>
  b.flows - a.flows || b.members - a.members || a.label.localeCompare(b.label, "en", { numeric: true });

/**
 * What a big import draws first: boundaries by flows, each added while the drawing stays within PICK_OVER nodes
 * (the first always, however big). Nothing when it's small enough to draw whole, or has fewer than two boundaries
 * to choose from.
 */
export function defaultPick(g: ImportGraph): string[] | undefined {
  if (g.components.length <= PICK_OVER) return undefined;
  const shares = sharesOf(g).sort(byFlows);
  if (shares.length < 2) return undefined;
  const loose = new Set<string>();
  const chosen: string[] = [];
  let count = 0;
  for (const s of shares) {
    let added = s.members;
    for (const k of s.loose) if (!loose.has(k)) added++;
    if (chosen.length && count + added > PICK_OVER) continue;
    chosen.push(s.key);
    count += added;
    for (const k of s.loose) loose.add(k);
  }
  return chosen;
}

/**
 * The import with only the chosen boundaries: their members, the loose nodes connected to them, and the links
 * between what's left. Loose nodes connected to nothing drawn stay out.
 */
export function pickGraph(g: ImportGraph, keys: readonly string[]): ImportGraph {
  const chosen = new Set(keys);
  const kept = new Set(g.components.filter((c) => c.group !== undefined && chosen.has(c.group)).map((c) => c.key));
  const loose = new Set(g.components.filter((c) => c.group === undefined).map((c) => c.key));
  const brought = new Set<string>();
  for (const l of g.links) {
    if (kept.has(l.from) && loose.has(l.to)) brought.add(l.to);
    if (kept.has(l.to) && loose.has(l.from)) brought.add(l.from);
  }
  for (const k of brought) kept.add(k);
  return {
    ...g,
    components: g.components.filter((c) => kept.has(c.key)),
    links: g.links.filter((l) => kept.has(l.from) && kept.has(l.to)),
    groups: g.groups.filter((gr) => chosen.has(gr.key)),
    ...(g.traffic ? { traffic: g.traffic.filter((t) => kept.has(t.key)) } : {}),
  };
}

/** How many nodes a pick draws (what the report's button says). */
export const pickedNodes = (g: ImportGraph, keys: readonly string[]) => pickGraph(g, keys).components.length;

/** Every boundary of the import for the report's list, the most flows first, with the drawn ones ticked. */
export function pickGroups(g: ImportGraph, keys: readonly string[]): PickGroup[] {
  const chosen = new Set(keys);
  return sharesOf(g)
    .sort(byFlows)
    .map((s) => ({ key: s.key, label: s.label, nodes: s.members, flows: s.flows, drawn: chosen.has(s.key) }));
}
