import { faultTarget } from "../model/faults";
import type { DiagramFile } from "../model/types";
import { catalog } from "../stencils/catalog";
import { isDependency, relationOf } from "../model/relations";
import { resolveRef } from "./refs";
import { validated } from "./validation";
import type { DescribeOptions } from "./index";
import { resolveCapabilities } from "../planning/capabilities";
import { explainNode } from "../planning/explanation";
import { analyzeCapacity } from "../sim/capacity";
import { compileTopology } from "../sim/topology";
import { scenarioPlans } from "../sim/scalingPlanner";
import { planMessage } from "../checks/scalingFindings";

const quote = (s: string) => JSON.stringify(s);
const round = (n: number) => Math.round(n * 1000) / 1000;
/** A connection's routing settings, in describe's words (absent: nothing). */
const routing = (props: Record<string, unknown> | undefined) =>
  (props?.requestRouteId !== undefined ? ` requestRoute=${JSON.stringify(props.requestRouteId)}` : "") +
  (props?.requestFilter !== undefined ? ` requestFilter=${JSON.stringify(props.requestFilter)}` : "");
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
  const sims =
    d.simulations?.filter(
      (s) =>
        !focus ||
        s.traffic.some((t) => focus.has(t.node)) ||
        s.timeline?.some((step) => step.action.do === "fault" && focus.has(faultTarget(step.action.fault))),
    ) ?? [];
  // One shared routing/analysis pass, bounded to modest graphs; describing a large graph stays cheap.
  const topology = compileTopology(d);
  const connections = resolveCapabilities(d, topology);
  const analysis = d.nodes.length <= 200 && d.edges.length <= 500 ? analyzeCapacity(d) : undefined;
  const resolved = (id: string) => (analysis ? explainNode(d, id, { analysis, topology, fixes: false }) : undefined);
  // Scenario sizing: the same bounded planner result Checks and live playback show. In the editor, only what the
  // checks worker already worked out (the agent tool waits for it); never a simulation on the UI thread.
  const plans = analysis
    ? (scenarioPlans(d) ?? []).filter((p) =>
        p.status === "unavailable" ? p.reason !== "policy" : p.suggestions.length,
      )
    : [];
  const name = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? id;
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
      planning: d.planning,
      nodes: take(nodes).map((n) => ({
        ...n,
        capabilities: connections[n.id] ?? [],
        explanation: resolved(n.id),
      })),
      edges: take(edges),
      groups: take(groups),
      annotations: take(notes),
      simulations: take(sims),
      ...(plans.length
        ? {
            scalingPlans: plans.map((p) => ({
              ...p,
              suggestions: p.suggestions.map((s) => ({ ...s, explanation: planMessage(p, s, name) })),
            })),
          }
        : {}),
      ...(analysis?.routeDemand ? { routeDemand: analysis.routeDemand } : {}),
      truncated: nodes.length + edges.length + groups.length + notes.length + sims.length > limit,
    });
  }
  const lines = [
    `Diagram ${quote(d.title)} · direction ${d.direction ?? "LR"} · ${nodes.length} nodes, ${edges.length} connections, ${groups.length} boundaries, ${sims.length} simulations`,
  ];
  if (d.description) lines.push(`description: ${quote(d.description)}`);
  lines.push("nodes:");
  const shownNodes = nodes.slice(0, Math.max(0, limit - lines.length - 1));
  for (const n of shownNodes)
    lines.push(
      `  ${quote(n.id)} ${quote(n.stencil)} (${quote(catalog.find((s) => s.id === n.stencil)?.label ?? "Unknown")}) ${quote(n.label)}${n.sublabel !== undefined ? ` / ${quote(n.sublabel)}` : ""}${n.props ? ` props=${JSON.stringify(n.props)}` : ""}${n.group ? ` in ${quote(n.group)}` : ""} capabilities=${JSON.stringify(connections[n.id] ?? [])}${analysis ? ` explanation=${JSON.stringify(resolved(n.id))}` : ""}`,
    );
  lines.push("connections:");
  for (const e of edges)
    lines.push(
      // A dependency says so: it carries no messages, whatever its kind.
      `  ${quote(e.id)} ${quote(e.from)} -> ${quote(e.to)} ${isDependency(e) ? `${relationOf(e)} dependency` : (e.kind ?? "async")}${e.label !== undefined ? ` ${quote(e.label)}` : ""}${routing(e.props)}`,
    );
  // Request routing: the definitions (bounded, the rest counted) and the configured demand per route at each node.
  const routes = d.planning?.requestRoutes;
  if (routes) {
    lines.push(`request routes (${routes.length}):`);
    const shown = routes.slice(0, 50);
    for (const r of shown)
      lines.push(
        `  ${quote(r.id)} ${r.address.method} ${quote(r.address.path)}${r.label ? ` ${quote(r.label)}` : ""}${r.address.host ? ` host=${quote(r.address.host)}` : ""}`,
      );
    if (routes.length > shown.length) lines.push(`  … ${routes.length - shown.length} more routes omitted`);
    for (const [node, byRoute] of Object.entries(analysis?.routeDemand ?? {}))
      for (const [route, demand] of Object.entries(byRoute))
        if (demand.rejected > 0 || demand.throttled > 0 || nodes.some((n) => n.id === node && n.props?.routeTable))
          lines.push(
            `route demand ${quote(node)} ${route ? quote(route) : "(no address)"}: offered ${round(demand.offered)} req/s, refused 404 ${round(demand.rejected)} req/s, rate-limited 429 ${round(demand.throttled)} req/s`,
          );
  }
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
  for (const p of plans)
    if (p.status === "unavailable")
      lines.push(`scenario sizing ${quote(p.simulation)}: unavailable (${p.reason ?? "budget"})`);
    else
      for (const s of p.suggestions)
        lines.push(
          `scenario sizing ${quote(p.simulation)} ${quote(s.node)}: ${JSON.stringify(planMessage(p, s, name))}${s.fix ? ` fix=${JSON.stringify(s.fix)}` : ""}`,
        );
  const totalLines = lines.length + nodes.length - shownNodes.length;
  return totalLines > limit
    ? [...lines.slice(0, limit - 1), `… ${totalLines - limit + 1} lines omitted`].join("\n")
    : lines.join("\n");
}
