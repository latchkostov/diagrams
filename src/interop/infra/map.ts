import type { AutoscalingConfig } from "../../model/autoscaling";
import { bindingValidator, remapScaler } from "../../model/kedaBindings";
import { diagnostic } from "./graph";
import { t as tr } from "../../i18n";
import {
  DIAGRAM_FORMAT,
  type DiagramEdge,
  type DiagramFile,
  type DiagramNode,
  type Simulation,
} from "../../model/types";
import { sanitizeSettings } from "../../model/relations";
import type { ImportGraph, ImportReport, ReportConnection, ReportGuess, ReportLine } from "./graph";
import { pickFor, withoutCredentials } from "./stencils";
import { LIMITS } from "../native";
import { layoutImport } from "./layout";
import { ImportError } from "./yaml";
import { idClaimer } from "../../model/ids";
import { MAX_DRAWN } from "./pick";

// ImportGraph → diagram: stencils from the shared resolver, links to relationships, groups to boundaries,
// then the three-step layout. The caller runs the result through validateDiagram, like every other import.

/** Report rows listed per section: the rest are counted in one line, so a hostile file can't flood the dialog. */
export const MAX_REPORT_LINES = 200;
const capped = (lines: ReportLine[]): ReportLine[] =>
  lines.length <= MAX_REPORT_LINES
    ? lines
    : [
        ...lines.slice(0, MAX_REPORT_LINES),
        {
          name: diagnostic("importReport.more", { count: lines.length - MAX_REPORT_LINES }),
          reason: diagnostic("importDetail.notListed"),
        },
      ];

/** How long the "Imported traffic" simulation sends. */
export const TRAFFIC_SECONDS = 120;

export { MAX_DRAWN };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "node";

/** `total`: the whole import's nodes, when this graph is a pick of it ("287 of 1,240 nodes"). */
export function graphToDiagram(g: ImportGraph, total?: number): { diagram: DiagramFile; report: ImportReport } {
  // The budgets first: nothing is laid out for a graph the validator would refuse anyway.
  const over = (n: number, max: number, what: string) => {
    if (n > max)
      throw new ImportError(tr("importDetail.itWouldDrawValue0NumberValue1", { value0: n, value1: what, value2: max }));
  };
  over(g.components.length, MAX_DRAWN, "nodes");
  over(g.links.length, LIMITS.maxEdges, "connections");
  over(g.groups.length, LIMITS.maxGroups, "boundaries");
  // One id space for nodes, connections and boundaries (#71), unique after normalizing ("Frontend" and "frontend"
  // are two), from the shared allocator.
  const unique = idClaimer();
  const ids = new Map<string, string>();
  const idFor = (key: string, label: string, prefix = "") => {
    const base = prefix + slug(label);
    const id = unique(key.startsWith("\u0004") ? `topic-${base}` : key.startsWith("\u0003") ? `ext-${base}` : base);
    ids.set(key, id);
    return id;
  };
  // Report rows name where a node lives when there's more than one place: "orders (shop)" and "orders (staging)".
  const rowLabel = (c: { label: string; context?: string }) =>
    c.context && g.groups.length > 1 ? `${c.label} (${c.context})` : c.label;
  const groupIds = new Map(g.groups.map((gr) => [gr.key, unique(`boundary-${slug(gr.label)}`)]));
  const guesses: ReportGuess[] = [];
  const nodes: DiagramNode[] = g.components.map((c) => {
    const id = idFor(c.key, c.label, c.idPrefix);
    // Subtitles carry evidence (an image, a build context), never anything credential-shaped.
    // Only a location (a URL, an image, a path) loses its query: a schedule's "cron(0 2 * * ? *)" stays whole.
    const located = c.sublabel && /[/:@]/.test(c.sublabel) ? withoutCredentials(c.sublabel) : c.sublabel;
    const sublabel = located && sanitizeSettings([{ key: located }])?.[0]?.key;
    let stencil = c.stencil;
    if (!stencil) {
      const pick = pickFor(c);
      stencil = "id" in pick ? pick.id : "generic.service";
      if ("id" in pick && pick.confidence !== "high")
        guesses.push({
          nodeId: id,
          label: rowLabel(c),
          stencil,
          evidence: [sublabel, pick.evidence].filter(Boolean).join(" · ") || undefined,
          alternatives: pick.alternatives,
        });
    } else if (c.guess)
      // The reader drew it on its best stencil, but isn't sure (a protocol with no stencil of its own).
      guesses.push({
        nodeId: id,
        label: rowLabel(c),
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
  for (const n of nodes) remapScaler(n.props, ids);
  const labelOf = new Map(g.components.map((c) => [c.key, rowLabel(c)]));
  const inferred: ReportConnection[] = [];
  /** Inferred connections past MAX_REPORT_LINES: counted in a note, not listed. */
  let unlisted = 0;
  const edges: DiagramEdge[] = [];
  for (const l of g.links) {
    const from = ids.get(l.from);
    const to = ids.get(l.to);
    if (!from || !to) continue;
    const settings = sanitizeSettings(l.props?.settings);
    const props = { ...l.props, ...(settings ? { settings } : {}) };
    if (!settings) delete props.settings;
    edges.push({
      id: unique(`e${edges.length + 1}`),
      from,
      to,
      ...(l.relation === "flow" ? { kind: l.kind ?? "async" } : { relation: l.relation }),
      ...(l.label ? { label: l.label } : {}),
      ...(Object.keys(props).length ? { props } : {}),
    });
    // A setting's name, never its value; a credential-shaped name isn't shown either (sanitizeSettings).
    const named = l.evidence.name && sanitizeSettings([{ key: l.evidence.name }])?.[0]?.key;
    if (
      (l.evidence.source === "setting" || l.evidence.source === "resource") &&
      named &&
      inferred.length >= MAX_REPORT_LINES
    )
      unlisted++;
    else if ((l.evidence.source === "setting" || l.evidence.source === "resource") && named)
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
  // A partial/external graph must still open with a report if a source or its group route is absent.
  const binding = bindingValidator(nodes, edges);
  const omitted: ReportLine[] = [];
  for (const n of nodes) {
    const a = n.props?.autoscaling as AutoscalingConfig | undefined;
    if (binding(a)) continue;
    n.props!.autoscaling = {
      mode: "unsupported",
      provider: g.format,
      reason: "KEDA source binding omitted from import; include its broker and consumer group route",
    };
    omitted.push({ name: n.label, reason: diagnostic("importDetail.scalingSourceOmitted") });
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
        // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
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
    format: nodes.some((n) => n.props?.resources || n.props?.autoscaling) ? "diagrams/v2" : DIAGRAM_FORMAT,
    ...(nodes.some((n) => n.props?.resources || n.props?.autoscaling)
      ? { planning: { revision: "p3-a1" as const } }
      : {}),
    title: g.title,
    direction: "LR",
    ...(groups.length ? { groups } : {}),
    nodes,
    edges,
    ...(simulation ? { simulations: [simulation] } : {}),
  });
  const summary = diagnostic("importReport.summary", {
    title: g.title,
    format: g.format,
    total: total && total > nodes.length ? "part" : "all",
    drawn: nodes.length,
    nodes: total && total > nodes.length ? total : nodes.length,
    connections: edges.length,
    guesses: guesses.length,
  });
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
      ...(g.connectionsTitle ? { connectionsTitle: g.connectionsTitle } : {}),
      notDrawn: capped([...g.notDrawn, ...omitted]),
      unread: capped(g.unread),
      notes: [
        ...g.notes,
        ...(unlisted ? [diagnostic("importReport.unlisted", { count: unlisted })] : []),
        // eslint-disable-next-line local/no-literal-ui-text -- persisted diagram content, not UI copy
        ...(simulation ? [diagnostic("importReport.watchTraffic", { title: "Imported traffic" })] : []),
      ],
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
