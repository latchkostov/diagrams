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
/** Room between two units in a column, as the layered layout leaves between cards. */
const ROW_GAP = 48;
/** Packed supporting resources share one gutter, including their dependency targets. */
const GRID_GAP = 40;

type Unit = Box & { id: string; label?: string; sublabel?: string };

/**
 * The layered layout spaces every row by its tallest unit, so one boundary block 450 px tall spreads every column
 * of single cards 500 px apart. Each column is restacked by its own units' heights, in the same order, and centred
 * on one line, so a chain still reads straight across.
 */
export function compactColumns(units: Unit[], at: Map<string, { x: number; y: number }>): void {
  const columns = new Map<number, Unit[]>();
  for (const u of units) {
    const p = at.get(u.id);
    if (!p) continue;
    const col = columns.get(p.x);
    if (col) col.push(u);
    else columns.set(p.x, [u]);
  }
  const height = (col: Unit[]) => col.reduce((h, u) => h + u.height, 0) + ROW_GAP * (col.length - 1);
  const tallest = Math.max(0, ...[...columns.values()].map(height));
  const top = Math.min(...units.filter((u) => at.has(u.id)).map((u) => at.get(u.id)!.y));
  for (const col of columns.values()) {
    col.sort((a, b) => at.get(a.id)!.y - at.get(b.id)!.y);
    let y = top + (tallest - height(col)) / 2;
    for (const u of col) {
      at.set(u.id, { x: at.get(u.id)!.x, y: Math.round(y / 10) * 10 });
      y += u.height + ROW_GAP;
    }
  }
}

/**
 * The layered layout for one level (a boundary's members, or the blocks and loose nodes), compacted. Units with no
 * flow (`linked` says which have one: Terraform's Draw everything has policies, networks, helpers), past a few,
 * never enter it: they'd stack in its first column and spread it. They're packed in a grid under everything that
 * flows instead.
 */
function laneLayout(
  units: Unit[],
  edges: { from: string; to: string }[],
  linked: (id: string) => boolean,
): Map<string, { x: number; y: number }> {
  const isolated = units.filter((u) => !linked(u.id));
  const pack = isolated.length > PACK_OVER;
  const lane = pack ? units.filter((u) => linked(u.id)) : units;
  const at = lane.length ? layeredLayout({ nodes: lane, edges, direction: "LR" }) : new Map();
  compactColumns(lane, at);
  if (!pack) return at;
  const placed = lane.map((u) => ({ ...u, ...at.get(u.id)! }));
  const left = placed.length ? Math.min(...placed.map((b) => b.x)) : 40;
  const top = placed.length ? Math.max(...placed.map((b) => b.y + b.height)) + 80 : 40;
  // Cells as wide as the widest card; something much wider (a boundary with nothing flowing) takes several cells.
  const widths = isolated.map((u) => u.width).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)];
  const cellW = Math.max(...widths.filter((w) => w <= median * 2)) + 48;
  // Rows about as wide as the grid is tall, a little landscape (a screen), and never narrower than the lane above.
  const area = isolated.reduce((sum, u) => sum + Math.ceil((u.width + 48) / cellW) * cellW * (u.height + GRID_GAP), 0);
  const laneWidth = placed.length ? Math.max(...placed.map((b) => b.x + b.width)) - left : 0;
  const columns = Math.max(1, Math.ceil(Math.max(laneWidth, Math.sqrt(area * 1.6)) / cellW));
  let col = 0;
  let y = top;
  let rowH = 0;
  for (const u of isolated) {
    const span = Math.ceil((u.width + 48) / cellW);
    if (col > 0 && col + span > columns) {
      y += rowH + GRID_GAP;
      col = 0;
      rowH = 0;
    }
    at.set(u.id, { x: left + col * cellW, y });
    col += span;
    rowH = Math.max(rowH, u.height);
  }
  return at;
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
    const pos = laneLayout(
      lane.map((n) => ({ ...boxOf(n), id: n.id, label: n.label, sublabel: n.sublabel })),
      flows,
      (id) => inFlow.has(id),
    );
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
  const packedLoose = loose.filter((n) => !inFlow.has(n.id)).length > PACK_OVER;
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
  // A block with flows inside belongs in the lane even when none leave it.
  const linked = new Set([
    ...unitEdges.flatMap((e) => [e.from, e.to]),
    ...[...blocks.keys()].filter((g) => nodes.some((n) => n.group === g && inFlow.has(n.id))).map((g) => `${g}`),
  ]);
  const at = laneLayout(units, unitEdges, (id) => linked.has(id));
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
    let c = placeToward(below, size, obstacles, "down", MARGIN, 80, packedLoose ? GRID_GAP : 80);
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
