import {
  DIAGRAM_FORMAT,
  type DiagramEdge,
  type DiagramFile,
  type DiagramNode,
  type Simulation,
} from "../../model/types";
import { sanitizeSettings } from "../../model/relations";
import type { ImportGraph, ImportReport, ReportConnection, ReportGuess } from "./graph";
import { pickFor, withoutCredentials } from "./stencils";
import { LIMITS } from "../native";
import { layoutImport } from "./layout";
import { ImportError } from "./yaml";

// ImportGraph → diagram: stencils from the shared resolver, links to relationships, groups to boundaries,
// then the three-step layout. The caller runs the result through validateDiagram, like every other import.

/** How long the "Imported traffic" simulation sends. */
export const TRAFFIC_SECONDS = 120;

/** The importer's own cap: anything bigger isn't drawn (the validator's budget is the same). */
export const MAX_DRAWN = 5_000;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "node";

export function graphToDiagram(g: ImportGraph): { diagram: DiagramFile; report: ImportReport } {
  // The budgets first: nothing is laid out for a graph the validator would refuse anyway.
  const over = (n: number, max: number, what: string) => {
    if (n > max)
      throw new ImportError(
        `It would draw ${n.toLocaleString("en")} ${what}; the most an import draws is ${max.toLocaleString("en")}.`,
      );
  };
  over(g.components.length, MAX_DRAWN, "nodes");
  over(g.links.length, LIMITS.maxEdges, "connections");
  over(g.groups.length, LIMITS.maxGroups, "boundaries");
  // One id space for nodes and boundaries, unique after normalizing ("Frontend" and "frontend" are two).
  const taken = new Set<string>();
  const unique = (base: string) => {
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    return id;
  };
  const ids = new Map<string, string>();
  const idFor = (key: string, label: string) => {
    const base = slug(label);
    const id = unique(key.startsWith("\u0004") ? `topic-${base}` : key.startsWith("\u0003") ? `ext-${base}` : base);
    ids.set(key, id);
    return id;
  };
  const groupIds = new Map(g.groups.map((gr) => [gr.key, unique(`boundary-${slug(gr.label)}`)]));
  const guesses: ReportGuess[] = [];
  const nodes: DiagramNode[] = g.components.map((c) => {
    const id = idFor(c.key, c.label);
    // Subtitles carry evidence (an image, a build context), never anything credential-shaped.
    const sublabel = c.sublabel && sanitizeSettings([{ key: withoutCredentials(c.sublabel) }])?.[0]?.key;
    let stencil = c.stencil;
    if (!stencil) {
      const pick = pickFor(c);
      stencil = "id" in pick ? pick.id : "generic.service";
      if ("id" in pick && pick.confidence !== "high")
        guesses.push({
          nodeId: id,
          label: c.label,
          stencil,
          evidence: [sublabel, pick.evidence].filter(Boolean).join(" · ") || undefined,
          alternatives: pick.alternatives,
        });
    } else if (c.guess)
      // The reader drew it on its best stencil, but isn't sure (a protocol with no stencil of its own).
      guesses.push({
        nodeId: id,
        label: c.label,
        stencil,
        evidence: c.guess.evidence,
        alternatives: c.guess.alternatives,
      });
    const group = c.group ? groupIds.get(c.group) : undefined;
    return {
      id,
      stencil,
      label: c.label,
      ...(sublabel ? { sublabel } : {}),
      x: 0,
      y: 0,
      ...(group ? { group } : {}),
      ...(c.props ? { props: { ...c.props } } : {}),
    };
  });
  const labelOf = new Map(g.components.map((c) => [c.key, c.label]));
  const inferred: ReportConnection[] = [];
  const edges: DiagramEdge[] = [];
  for (const l of g.links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (!from || !to) continue;
    const settings = sanitizeSettings(l.props?.settings);
    const props = { ...l.props, ...(settings ? { settings } : {}) };
    if (!settings) delete props.settings;
    edges.push({
      id: `e${edges.length + 1}`,
      from,
      to,
      ...(l.relation === "flow" ? { kind: l.kind ?? "async" } : { relation: l.relation }),
      ...(Object.keys(props).length ? { props } : {}),
    });
    // A setting's name, never its value; a credential-shaped name isn't shown either (sanitizeSettings).
    const named = l.evidence.name && sanitizeSettings([{ key: l.evidence.name }])?.[0]?.key;
    if (l.evidence.source === "setting" && named)
      inferred.push({
        fromId: from,
        toId: to,
        from: labelOf.get(l.from) ?? from,
        to: labelOf.get(l.to) ?? to,
        evidence: named,
        ...(l.evidence.note ? { note: l.evidence.note } : {}),
        ...(l.evidence.guess ? { guess: true } : {}),
      });
  }
  const used = new Set(nodes.map((n) => n.group));
  const groups = g.groups
    .filter((gr) => used.has(groupIds.get(gr.key)))
    .map((gr) => ({
      id: groupIds.get(gr.key)!,
      label: gr.label,
      tone: gr.tone ?? "neutral",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
  // "Imported traffic": a steady rate at each entry point, so the first Go live shows typed messages flowing.
  const traffic = (g.traffic ?? []).filter((t) => ids.has(t.key));
  const simulation: Simulation | undefined = traffic.length
    ? {
        id: "imported-traffic",
        title: "Imported traffic",
        description: `${TRAFFIC_SECONDS / 60} minutes of steady traffic where messages start, from the import.`,
        traffic: traffic.map((t, i) => ({
          id: `t${i + 1}`,
          node: ids.get(t.key)!,
          ...(t.messageType ? { messageType: t.messageType } : {}),
          shape: { kind: "constant", ratePerSec: t.ratePerSec, durationMs: TRAFFIC_SECONDS * 1000 },
        })),
      }
    : undefined;
  const diagram = layoutImport({
    format: DIAGRAM_FORMAT,
    title: g.title,
    direction: "LR",
    ...(groups.length ? { groups } : {}),
    nodes,
    edges,
    ...(simulation ? { simulations: [simulation] } : {}),
  });
  const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString("en")} ${k === 1 ? one : many}`;
  const summary =
    `Imported “${g.title}” from ${g.format}: ${n(nodes.length, "node")}, ${n(edges.length, "connection")}.` +
    (guesses.length ? ` ${n(guesses.length, "guess", "guesses")}.` : "");
  return {
    diagram,
    report: {
      summary,
      format: g.format,
      source: g.source,
      title: g.title,
      nodes: nodes.length,
      connections: edges.length,
      boundaries: groups.length,
      guesses,
      inferred,
      notDrawn: g.notDrawn,
      unread: g.unread,
      notes: simulation ? [...g.notes, "Go live and pick “Imported traffic” to watch messages flow"] : g.notes,
      ...(traffic.length
        ? {
            traffic: traffic.map((t) => ({
              nodeId: ids.get(t.key)!,
              label: labelOf.get(t.key) ?? t.key,
              ...(t.messageType ? { messageType: t.messageType } : {}),
              ratePerSec: t.ratePerSec,
              seconds: TRAFFIC_SECONDS,
            })),
          }
        : {}),
    },
  };
}
