import type { MenuItem, MenuNode } from "../editor/actions";
import { getStencil } from "../stencils/registry";
import { scoreStencil } from "../lib/stencilDisplaySearch";
import { tokenize } from "../lib/stencilSearchCore";
const MAX_RESULTS = 60;

export const selectable = (n: MenuNode | undefined): n is MenuItem => !!n && n.type === "item" && !n.disabled;

function leaves(items: MenuNode[], trail: string[] = []): { item: MenuItem; trail: string[] }[] {
  const out: { item: MenuItem; trail: string[] }[] = [];
  for (const n of items) {
    if (n.type !== "item") continue;
    if (n.children) out.push(...leaves(n.children, [...trail, n.label]));
    else out.push({ item: n, trail });
  }
  return out;
}

export function search(items: MenuNode[], q: string): MenuNode[] {
  const tokens = tokenize(q);
  // A stencil listed twice (Recently used, and its category) is one result.
  const seen = new Set<string>();
  const hits: { item: MenuItem; i: number; score: number }[] = [];
  leaves(items).forEach(({ item, trail }, i) => {
    const hay = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${trail.join(" ")}`.toLowerCase();
    // Stencils rank as the rail's search ranks them, aliases included ("pg" → PostgreSQL, "go" → Go Service).
    const score = item.stencil ? scoreStencil(getStencil(item.stencil), q) : 0;
    if (score <= 0 && !tokens.every((t) => hay.includes(t))) return;
    if (item.stencil) {
      if (seen.has(item.stencil)) return;
      seen.add(item.stencil);
    }
    hits.push({ item, i, score });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map(({ item }) => item);
}
