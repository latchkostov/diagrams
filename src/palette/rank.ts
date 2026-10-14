import { msg } from "../i18n";
import type { IconName } from "../components/Icon";
import { scoreQuery } from "./fuzzy";

/** Result groups, in their default order. */
export type CommandGroup = "recent" | "actions" | "nodes" | "stencils" | "simulations" | "diagrams";

export const GROUP_LABEL: Record<CommandGroup, () => string> = {
  recent: msg("command.recent"),
  actions: msg("command.actions"),
  nodes: msg("command.goToNode"),
  stencils: msg("command.addStencil"),
  simulations: msg("htmlExport.simulations"),
  diagrams: msg("command.diagrams"),
};

const GROUP_ORDER: CommandGroup[] = ["recent", "actions", "nodes", "simulations", "stencils", "diagrams"];

export interface Command {
  /** Stable id; becomes `data-testid="command-item-<id>"` and the recents key. */
  id: string;
  /**
   * Its id carries the open diagram's own ids or words (Connect to ›, Reconnect ›, a node, a simulation): the palette
   * never remembers it among recent commands for a private diagram (src/palette/recent.ts).
   */
  documentScoped?: boolean;
  group: Exclude<CommandGroup, "recent">;
  label: string;
  keywords?: string;
  icon?: IconName;
  /** Render this stencil's icon. */
  stencil?: string;
  /** Render a colour swatch (boundary tones). */
  swatch?: string;
  /** Toggle state, shown as a check. */
  checked?: boolean;
  /** Combo like "Mod+D" (formatted per platform). */
  shortcut?: string;
  /** Muted right-aligned text. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** `false`: hidden until the user types (submenu leaves, the long stencil list). */
  idle?: boolean;
  /** Custom score for a query (stencils use the catalogue's alias-aware search). 0 = no match. */
  score?: (query: string) => number;
  /** Submenu parent: Enter narrows the query to its entries instead of running. */
  drill?: string;
  /** Submenu whose executable descendants include this command. */
  parent?: string;
  run?: () => void;
}

export interface Ranked {
  group: CommandGroup;
  items: Command[];
}

/** Prefixes narrow to one kind: `>` actions, `@` nodes, `+` stencils. */
export const PREFIXES = { ">": "actions", "@": "nodes", "+": "stencils" } as const satisfies Record<
  string,
  CommandGroup
>;

export function parseQuery(raw: string): { query: string; only?: CommandGroup } {
  const first = raw.trimStart()[0] as keyof typeof PREFIXES | undefined;
  if (first && first in PREFIXES) return { query: raw.trimStart().slice(1).trim(), only: PREFIXES[first] };
  return { query: raw.trim() };
}

/** Recency boost for the n-th most recent command (0 = newest). */
export function recencyBoost(index: number): number {
  return index < 0 ? 0 : Math.max(4, 16 - index * 2);
}

/** Group weights keep the long stencil catalogue from crowding out actions on a weak match. */
const GROUP_WEIGHT: Record<Command["group"], number> = {
  actions: 1,
  nodes: 1,
  simulations: 1,
  diagrams: 0.95,
  stencils: 0.92,
};

export const MAX_RESULTS = 60;
/** Results scoring under this share of the best one are noise. */
export const TAIL_RATIO = 0.4;
const IDLE_RECENT = 5;
const IDLE_PER_GROUP: Partial<Record<CommandGroup, number>> = { nodes: 6, stencils: 6 };

export function scoreCommand(c: Command, query: string): number {
  return c.score ? c.score(query) : scoreQuery(query, c);
}

/**
 * Ranks commands for the raw input. Empty input: recently used first, then each group's idle
 * entries. Otherwise: every matching command scored (plus a recency boost), groups ordered by
 * their best hit, items by score; ties keep source order.
 */
export function rank(commands: readonly Command[], raw: string, recent: readonly string[] = []): Ranked[] {
  const { query, only } = parseQuery(raw);
  const pool = only ? commands.filter((c) => c.group === only) : commands;
  const recentIndex = new Map(recent.map((id, i) => [id, i]));

  if (!query) {
    const byId = new Map(pool.map((c) => [c.id, c]));
    const recentItems = only
      ? []
      : recent
          .map((id) => byId.get(id))
          .filter((c): c is Command => !!c)
          .slice(0, IDLE_RECENT);
    const shown = new Set(recentItems.map((c) => c.id));
    const out: Ranked[] = recentItems.length ? [{ group: "recent", items: recentItems }] : [];
    let remaining = MAX_RESULTS - recentItems.length;
    for (const group of GROUP_ORDER) {
      if (group === "recent") continue;
      let items = pool.filter((c) => c.group === group && !shown.has(c.id) && (only ? true : c.idle !== false));
      const cap = only ? remaining : Math.min(remaining, IDLE_PER_GROUP[group] ?? remaining);
      items = items.slice(0, cap);
      remaining -= items.length;
      if (items.length) out.push({ group, items });
    }
    return out;
  }

  const scored = pool
    .map((c, i) => {
      const s = scoreCommand(c, query);
      return { c, i, s: s > 0 ? s * GROUP_WEIGHT[c.group] + recencyBoost(recentIndex.get(c.id) ?? -1) : 0 };
    })
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.c.label.length - b.c.label.length || a.i - b.i);
  // Once there's a clear hit, drop the long tail of scattered-letter matches.
  const floor = (scored[0]?.s ?? 0) * TAIL_RATIO;
  const kept = scored.filter((r) => r.s >= floor).slice(0, MAX_RESULTS);

  const groups = new Map<CommandGroup, Command[]>();
  for (const r of kept) {
    if (!groups.has(r.c.group)) groups.set(r.c.group, []);
    groups.get(r.c.group)!.push(r.c);
  }
  // Map insertion order = order of each group's best hit.
  return [...groups].map(([group, items]) => ({ group, items }));
}

/** The flat, navigable order of a ranking. */
export function flatten(ranked: readonly Ranked[]): Command[] {
  return ranked.flatMap((g) => g.items);
}
