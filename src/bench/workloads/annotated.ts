// Workload: boundaries and annotations (docs/BENCHMARKS.md § Workloads). The event pipeline with every lane in its
// own boundary (instead of one per domain), a zone and a title per domain, a sticky note per lane, and a connectable
// shape per ten nodes with a documentation edge to it: the canvas's annotation layer, layer order and group geometry
// at scale. Exactly `n` nodes; annotations come on top (they're a separate list, capped by the file format).

import type { DiagramAnnotation, DiagramFile, DiagramGroup } from "../../model/types";
import { ANNOTATION_LIMITS } from "../../model/annotations";
import { bounds, CARD } from "./common";
import { eventPipeline, LANE } from "./pipeline";

const TONES = ["k8s", "aws", "azure", "gcp", "onprem", "neutral"] as const;
const COLORS = ["yellow", "green", "blue", "purple", "neutral"] as const;

export function annotatedPipeline(n: number, seed = 31): DiagramFile {
  const d = eventPipeline(n, seed);
  const lanes = new Map<string, typeof d.nodes>();
  const domainOf = new Map<string, string>();
  for (const node of d.nodes) {
    const lane = /^(l\d+)-/.exec(node.id)?.[1];
    if (lane) {
      lanes.set(lane, [...(lanes.get(lane) ?? []), node]);
      if (node.group) domainOf.set(lane, node.group);
    }
  }
  // One boundary per lane.
  const groups: DiagramGroup[] = [];
  let i = 0;
  for (const [lane, members] of lanes) {
    const box = bounds(members);
    for (const m of members) m.group = `g-${lane}`;
    groups.push({
      id: `g-${lane}`,
      label: `Lane ${lane.slice(1)}`,
      tone: TONES[i++ % TONES.length],
      x: box.x - 30,
      y: box.y - 46,
      width: box.width + 60,
      height: box.height + 70,
    });
  }
  const extras = d.nodes.filter((node) => !/^l\d+-/.test(node.id));
  for (const node of extras) delete node.group;
  d.groups = groups;

  const annotations: DiagramAnnotation[] = [];
  // A zone and a title per domain, around its lanes.
  const domains = new Map<string, typeof d.nodes>();
  for (const [lane, members] of lanes) {
    const dom = domainOf.get(lane) ?? "dom";
    domains.set(dom, [...(domains.get(dom) ?? []), ...members]);
  }
  for (const [dom, members] of domains) {
    const box = bounds(members);
    annotations.push({
      id: `zone-${dom}`,
      kind: "zone",
      text: `Zone ${dom.slice(3)}`,
      x: box.x - 70,
      y: box.y - 110,
      width: box.width + 140,
      height: box.height + 160,
      color: "blue",
    });
    annotations.push({
      id: `title-${dom}`,
      kind: "text",
      text: `Domain ${dom.slice(3)}: ingestion, enrichment and work queues`,
      x: box.x - 60,
      y: box.y - 104,
      width: 520,
      height: 40,
      textSize: "xl",
    });
  }
  // A sticky note per lane, to its right.
  for (const [lane, members] of lanes) {
    const box = bounds(members);
    annotations.push({
      id: `note-${lane}`,
      kind: "note",
      text: `Lane ${lane.slice(1)}\nOwner: team ${(Number(lane.slice(1)) % 9) + 1}\nSLO: p99 < 2 s`,
      x: box.x + box.width + 50,
      y: box.y,
      width: 200,
      height: 110,
      color: COLORS[Number(lane.slice(1)) % COLORS.length],
    });
  }
  // A shape per ten nodes, joined to the node by a documentation edge (an edge may end on a shape).
  const shapes = Math.floor(n / 10);
  for (let k = 0; k < shapes; k++) {
    const target = d.nodes[(k * 10) % d.nodes.length];
    const id = `shape-${k + 1}`;
    annotations.push({
      id,
      kind: "shape",
      shape: k % 2 ? "cylinder" : "rounded",
      text: `Runbook ${k + 1}`,
      x: target.x + 20,
      y: target.y + CARD.height + 14,
      width: 140,
      height: 30,
      color: "neutral",
    });
    d.edges.push({ id: `doc-${k + 1}`, from: target.id, to: id, kind: "sync", relation: "depends" });
  }
  d.annotations = annotations.slice(0, ANNOTATION_LIMITS.maxAnnotations);
  const kept = new Set([...d.nodes.map((x) => x.id), ...d.annotations.map((a) => a.id)]);
  d.edges = d.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  d.title = `Boundaries and annotations (${n} nodes)`;
  d.description = `Synthetic benchmark workload: ${LANE}-node lanes, each its own boundary, with zones, notes and shapes.`;
  return d;
}
