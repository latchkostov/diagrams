import type { DiagramFile } from "../model/types";
import { catalog } from "../stencils/catalog";
import { isDependency, relationOf } from "../model/relations";
import { resolveRef } from "./refs";
import { validated } from "./validation";
import type { DescribeOptions } from "./index";

const quote = (s: string) => JSON.stringify(s);
/** Data only: authored strings are JSON quoted so they cannot introduce output lines. */
export function describeDiagram(diagram: DiagramFile, options: DescribeOptions = {}): string {
  const d = validated(diagram);
  const limit = Math.max(10, Math.min(500, options.limit ?? 150));
  const focus = options.focus?.length ? new Set(options.focus.map((r) => resolveRef(d, r))) : undefined;
  if (focus) {
    const roots = new Set(focus);
    for (const e of d.edges)
      if (roots.has(e.id) || roots.has(e.from) || roots.has(e.to)) {
        focus.add(e.id);
        focus.add(e.from);
        focus.add(e.to);
      }
    for (const n of d.nodes) if (n.group && roots.has(n.group)) focus.add(n.id);
  }
  const nodes = d.nodes.filter((n) => !focus || focus.has(n.id));
  const edges = d.edges.filter((e) => !focus || focus.has(e.id));
  const groups = d.groups?.filter((g) => !focus || focus.has(g.id) || nodes.some((n) => n.group === g.id)) ?? [];
  const notes = d.annotations?.filter((a) => !focus || focus.has(a.id)) ?? [];
  const sims = d.simulations?.filter((s) => !focus || s.traffic.some((t) => focus.has(t.node))) ?? [];
  if (options.format === "json") {
    let remaining = limit;
    const take = <T>(items: T[]) => {
      const picked = items.slice(0, remaining);
      remaining -= picked.length;
      return picked;
    };
    return JSON.stringify({
      title: d.title,
      description: d.description,
      direction: d.direction ?? "LR",
      nodes: take(nodes),
      edges: take(edges),
      groups: take(groups),
      annotations: take(notes),
      simulations: take(sims),
      truncated: nodes.length + edges.length + groups.length + notes.length + sims.length > limit,
    });
  }
  const lines = [
    `Diagram ${quote(d.title)} · direction ${d.direction ?? "LR"} · ${nodes.length} nodes, ${edges.length} connections, ${groups.length} boundaries, ${sims.length} simulations`,
  ];
  if (d.description) lines.push(`description: ${quote(d.description)}`);
  lines.push("nodes:");
  for (const n of nodes)
    lines.push(
      `  ${quote(n.id)} ${quote(n.stencil)} (${quote(catalog.find((s) => s.id === n.stencil)?.label ?? "Unknown")}) ${quote(n.label)}${n.sublabel !== undefined ? ` / ${quote(n.sublabel)}` : ""}${n.props ? ` props=${JSON.stringify(n.props)}` : ""}${n.group ? ` in ${quote(n.group)}` : ""}`,
    );
  lines.push("connections:");
  for (const e of edges)
    lines.push(
      // A dependency says so: it carries no messages, whatever its kind.
      `  ${quote(e.id)} ${quote(e.from)} -> ${quote(e.to)} ${isDependency(e) ? `${relationOf(e)} dependency` : (e.kind ?? "async")}${e.label !== undefined ? ` ${quote(e.label)}` : ""}`,
    );
  for (const g of groups)
    lines.push(
      `boundary ${quote(g.id)} ${quote(g.label)} (${g.tone ?? "neutral"}): ${nodes
        .filter((n) => n.group === g.id)
        .map((n) => quote(n.id))
        .join(", ")}`,
    );
  for (const a of notes) lines.push(`${a.kind} ${quote(a.id)} ${quote(a.text)}`);
  for (const s of sims)
    lines.push(
      `simulation ${quote(s.id)} ${quote(s.title)}: ${s.traffic.map((t) => `${JSON.stringify(t.shape)} from ${quote(t.node)}`).join("; ")}; timeline=${JSON.stringify(s.timeline ?? [])}; expectations=${JSON.stringify(s.expectations ?? [])}`,
    );
  return lines.length > limit
    ? [...lines.slice(0, limit - 1), `… ${lines.length - limit + 1} lines omitted`].join("\n")
    : lines.join("\n");
}
