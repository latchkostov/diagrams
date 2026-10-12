import { DIAGRAM_FORMAT, type DiagramEdge, type DiagramFile, type DiagramNode } from "../../model/types";
import { sanitizeSettings } from "../../model/relations";
import type { ImportGraph, ImportReport, ReportConnection, ReportGuess } from "./graph";
import { resolveStencil } from "./stencils";
import { layoutImport } from "./layout";
import { ImportError } from "./yaml";

// ImportGraph → diagram: stencils from the shared resolver, links to relationships, groups to boundaries,
// then the three-step layout. The caller runs the result through validateDiagram, like every other import.

/** The importer's own cap: anything bigger isn't drawn (the validator's budget is the same). */
export const MAX_DRAWN = 5_000;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "node";

export function graphToDiagram(g: ImportGraph): { diagram: DiagramFile; report: ImportReport } {
  if (g.components.length > MAX_DRAWN)
    throw new ImportError(
      `It would draw ${g.components.length.toLocaleString("en")} nodes; the most an import draws is ${MAX_DRAWN.toLocaleString("en")}.`,
    );
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  const idFor = (key: string, label: string) => {
    let base = slug(label);
    if (key.startsWith("\u0004")) base = `topic-${base}`;
    else if (key.startsWith("\u0003")) base = `ext-${base}`;
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    ids.set(key, id);
    return id;
  };
  const groupIds = new Map(g.groups.map((gr) => [gr.key, `boundary-${slug(gr.label)}`]));
  const guesses: ReportGuess[] = [];
  const nodes: DiagramNode[] = g.components.map((c) => {
    const id = idFor(c.key, c.label);
    let stencil = c.stencil;
    if (!stencil) {
      const pick = resolveStencil(c.hint);
      stencil = "id" in pick ? pick.id : "generic.service";
      if ("id" in pick && pick.confidence !== "high")
        guesses.push({
          nodeId: id,
          label: c.label,
          stencil,
          evidence: [c.sublabel, pick.evidence].filter(Boolean).join(" · ") || undefined,
          alternatives: pick.alternatives,
        });
    }
    const group = c.group ? groupIds.get(c.group) : undefined;
    return {
      id,
      stencil,
      label: c.label,
      ...(c.sublabel ? { sublabel: c.sublabel } : {}),
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
  const diagram = layoutImport({
    format: DIAGRAM_FORMAT,
    title: g.title,
    direction: "LR",
    ...(groups.length ? { groups } : {}),
    nodes,
    edges,
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
      notes: g.notes,
    },
  };
}
