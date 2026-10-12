import type { DiagramFile, DiagramNode } from "../../model/types";
import { layeredLayout } from "../../editor/layout";
import { boundaryAround } from "../../editor/arrange";
import { estimateCardSize } from "../../canvas/nodes/size";
import { boundsOf, findFree, isClear, placeToward, type Box } from "../../canvas/placement";
import { relationOf } from "../../model/relations";

// The importers' layout (docs/research/imports.md § Layout and boundaries), in three steps:
//  1. inside each boundary, the layered layout on its members and the flows between them, left to right;
//  2. the boundaries as blocks, with the loose nodes, on the flows between blocks: Users → gateway → backend;
//  3. dependency targets (a secret store, a registry: nodes with no flows) beside their users, below the lane,
//     clear of everything. Members never leave their boundary, and nothing overlaps.

/** Room between a dependency target and anything else. */
const MARGIN = 24;

const sizeOf = (n: DiagramNode) => estimateCardSize(n.label, n.sublabel);
const boxOf = (n: DiagramNode): Box => ({ x: n.x, y: n.y, ...sizeOf(n) });

/** More units than this with no flows at all go in a grid below the flows, not one tall column. */
const PACK_OVER = 6;

/**
 * Units with no flow to or from anything (Terraform's Draw everything: policies, networks, helpers) would stack
 * in the layered layout's first column. Past a few, they're packed in a grid under everything that flows.
 */
function packIsolated(
  units: (Box & { id: string })[],
  edges: { from: string; to: string }[],
  at: Map<string, { x: number; y: number }>,
): void {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const isolated = units.filter((u) => !linked.has(u.id) && at.has(u.id));
  if (isolated.length <= PACK_OVER) return;
  const placed = units.filter((u) => linked.has(u.id) && at.has(u.id)).map((u) => ({ ...u, ...at.get(u.id)! }));
  const left = placed.length ? Math.min(...placed.map((b) => b.x)) : 40;
  const top = placed.length ? Math.max(...placed.map((b) => b.y + b.height)) + 80 : 40;
  const columns = Math.max(1, Math.ceil(Math.sqrt(isolated.length * 2)));
  const cellW = Math.max(...isolated.map((u) => u.width)) + 48;
  const cellH = Math.max(...isolated.map((u) => u.height)) + 40;
  isolated.forEach((u, i) =>
    at.set(u.id, { x: left + (i % columns) * cellW, y: top + Math.floor(i / columns) * cellH }),
  );
}

export function layoutImport(diagram: DiagramFile): DiagramFile {
  const nodes = diagram.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const flows = diagram.edges.filter((e) => relationOf(e) === "flow");
  const deps = diagram.edges.filter((e) => relationOf(e) !== "flow");
  const inFlow = new Set(flows.flatMap((e) => [e.from, e.to]));
  /** Dependency targets: reached only by dependencies. Everything else takes part in the flow lane. */
  const users = new Map<string, string[]>();
  for (const e of deps) if (e.from !== e.to) users.set(e.to, [...(users.get(e.to) ?? []), e.from]);
  const target = (n: DiagramNode) => !inFlow.has(n.id) && users.has(n.id);
  const usersOf = (id: string) => users.get(id) ?? [];

  // Step 1: each boundary on its own, at the origin.
  const groups = diagram.groups ?? [];
  const blocks = new Map<string, Box>();
  for (const group of groups) {
    const members = nodes.filter((n) => n.group === group.id);
    const lane = members.filter((n) => !target(n));
    const pos = layeredLayout({ nodes: lane, edges: flows, direction: "LR" });
    for (const n of lane) Object.assign(n, pos.get(n.id));
    const placed = lane.map(boxOf);
    const bottom = Math.max(0, ...placed.map((b) => b.y + b.height));
    for (const n of members.filter(target)) {
      const size = sizeOf(n);
      const user = usersOf(n.id)
        .map((id) => byId.get(id))
        .find((u) => u && u.group === group.id && !target(u));
      // One row under the flow lane, below the first user where there's room.
      const from = { x: user ? user.x : 40, y: bottom - size.height, ...size };
      const c = placeToward(from, size, placed, "down", MARGIN, 80);
      n.x = Math.round(c.x - size.width / 2);
      n.y = Math.round(c.y - size.height / 2);
      if (!isClear(boxOf(n), placed, MARGIN)) {
        // Below everything placed so far, left-aligned: always clear.
        n.x = 40;
        n.y = Math.max(...placed.map((b) => b.y + b.height)) + 80;
      }
      placed.push(boxOf(n));
    }
    if (members.length) blocks.set(group.id, boundaryAround(placed.map((b, i) => ({ ...b, id: String(i) }))));
  }

  // Step 2: blocks and loose lane nodes, on the flows between them.
  const blockOf = (id: string) => byId.get(id)?.group;
  const unitOf = (id: string) => {
    const g = blockOf(id);
    return g && blocks.has(g) ? `\u0001${g}` : id;
  };
  const loose = nodes.filter((n) => !(n.group && blocks.has(n.group)) && !target(n));
  // Where messages start (the import's traffic) reads first: with request and reply loops between apps and
  // brokers, the layered layout breaks cycles from the leftmost unit it's given.
  const entries = new Set(diagram.simulations?.flatMap((s) => s.traffic.map((t) => t.node)));
  const units = [
    ...[...blocks].map(([id, b]) => ({ id: `\u0001${id}`, x: 0, y: 0, width: b.width, height: b.height })),
    ...loose.map((n) => ({ id: n.id, x: entries.has(n.id) ? -1 : 0, y: 0, ...sizeOf(n) })),
  ];
  // One edge per pair of units, in one pass.
  const seen = new Set<string>();
  const unitEdges: { from: string; to: string }[] = [];
  for (const e of flows) {
    const from = unitOf(e.from);
    const to = unitOf(e.to);
    const pair = `${from}\u0002${to}`;
    if (from === to || seen.has(pair)) continue;
    seen.add(pair);
    unitEdges.push({ from, to });
  }
  const at = layeredLayout({ nodes: units, edges: unitEdges, direction: "LR" });
  packIsolated(units, unitEdges, at);
  for (const n of loose) Object.assign(n, at.get(n.id));
  const out: DiagramFile = { ...diagram, nodes };
  out.groups = groups.map((g) => {
    const b = blocks.get(g.id);
    const p = at.get(`\u0001${g.id}`);
    if (!b || !p) return g;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    for (const n of nodes) if (n.group === g.id) Object.assign(n, { x: n.x + dx, y: n.y + dy });
    return { ...g, x: p.x, y: p.y, width: b.width, height: b.height };
  });

  // Step 3: loose dependency targets beside their users (or under a shared one's users), clear of all.
  const obstacles: Box[] = [
    ...nodes.filter((n) => !target(n) || (n.group && blocks.has(n.group))).map(boxOf),
    ...out.groups.filter((g) => blocks.has(g.id)),
  ];
  for (const n of nodes.filter((n) => target(n) && !(n.group && blocks.has(n.group)))) {
    const size = sizeOf(n);
    // A user in a boundary stands for its boundary: the target goes below the block, not inside it.
    const near = usersOf(n.id)
      .map((id) => byId.get(id))
      .filter((u): u is DiagramNode => !!u)
      .map((u) => out.groups?.find((g) => g.id === u.group && blocks.has(g.id)) ?? boxOf(u));
    const from = boundsOf(near) ?? boundsOf(obstacles) ?? { x: 40, y: 40, width: 0, height: 0 };
    const below = { x: from.x + from.width / 2 - size.width / 2, y: from.y + from.height - size.height, ...size };
    let c = placeToward(below, size, obstacles, "down", MARGIN, 80);
    if (!isClear({ x: c.x - size.width / 2, y: c.y - size.height / 2, ...size }, obstacles, MARGIN))
      c = findFree(c, size, obstacles, { margin: MARGIN, maxRings: 40 }) ?? {
        x: c.x,
        y: Math.max(...obstacles.map((o) => o.y + o.height)) + 80 + size.height / 2,
      };
    n.x = Math.round(c.x - size.width / 2);
    n.y = Math.round(c.y - size.height / 2);
    obstacles.push(boxOf(n));
  }
  return out;
}
