// The agent skill's layout (skills/livediagrams/scripts/layout.mjs). `pnpm schemas` bundles this module,
// with the app's own layout code, into skills/livediagrams/scripts/lib/layout.mjs, so a diagram an agent
// writes without coordinates is laid out by the same code as a pasted file in the app (fileToDiagram in
// src/ai/ui/apply.ts), except that boundary membership is taken as written. Pure and dependency-free:
// it must run under plain Node.

import type { DiagramFile } from "../../model/types";
import { fitGroupToContents, placeNew } from "../place";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const BOX = ["x", "y", "width", "height"] as const;

export interface LayoutResult {
  diagram: Record<string, unknown>;
  /** Every node was placed by the layered layout. */
  laidOut: boolean;
  /** Boundaries whose boxes were fitted around their members. */
  fitted: string[];
  /** Notes and texts that were given a position. */
  placedNotes: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fills in what an agent may leave out: node x/y (any node without them, or `force`, lays out every
 * node with the app's layered layout), boundary boxes (fitted around their members) and note/text
 * boxes (a row below the diagram). Everything else is returned untouched. Malformed input is returned
 * as is, for validate.mjs to explain.
 */
export function layoutDiagram(input: unknown, opts: { force?: boolean } = {}): LayoutResult {
  const none: LayoutResult = { diagram: isObj(input) ? input : {}, laidOut: false, fitted: [], placedNotes: [] };
  if (!isObj(input) || !Array.isArray(input.nodes) || !input.nodes.every(isObj)) return none;
  const nodes = (input.nodes as Obj[]).map((n) => ({ ...n }));
  const needsLayout = opts.force || nodes.some((n) => !isNum(n.x) || !isNum(n.y));
  for (const n of nodes) {
    if (!isNum(n.x)) n.x = 0;
    if (!isNum(n.y)) n.y = 0;
    if (typeof n.label !== "string") n.label = typeof n.id === "string" ? n.id : "";
  }
  const groups = Array.isArray(input.groups) ? (input.groups as unknown[]).map((g) => (isObj(g) ? { ...g } : g)) : [];
  const unboxed = groups.filter((g): g is Obj => isObj(g) && BOX.some((k) => !isNum(g[k]))).map((g) => g.id as string);
  for (const g of groups) if (isObj(g)) for (const k of BOX) if (!isNum(g[k])) g[k] = 0;
  const edges = Array.isArray(input.edges) ? (input.edges as unknown[]).filter(isObj) : [];

  let d = {
    ...input,
    nodes,
    edges,
    ...(Array.isArray(input.groups) ? { groups } : {}),
  } as unknown as DiagramFile;
  let fitted: string[];
  if (needsLayout) {
    // Every id is "kept outside": a file's boundary membership is deliberate, so unlike an added
    // node, a node next to a boundary isn't pulled into it.
    const ids = d.nodes.map((n) => n.id);
    d = placeNew(d, ids, "full", [], ids);
    fitted = (d.groups ?? []).map((g) => g.id);
  } else {
    for (const id of unboxed) d = fitGroupToContents(d, id);
    fitted = unboxed;
  }

  // Notes and texts without a box go in a row under everything else.
  const placedNotes: string[] = [];
  if (Array.isArray(input.annotations)) {
    const boxes = [...d.nodes.map((n) => ({ x: n.x, y: n.y, width: 260, height: 72 })), ...(d.groups ?? [])];
    let x = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 40;
    const y = boxes.length ? Math.max(...boxes.map((b) => b.y + b.height)) + 60 : 40;
    const annotations = (input.annotations as unknown[]).map((raw) => {
      if (!isObj(raw) || BOX.every((k) => isNum(raw[k])) || (raw.kind !== "note" && raw.kind !== "text")) return raw;
      const a = { ...raw };
      if (!isNum(a.width)) a.width = 240;
      if (!isNum(a.height)) a.height = a.kind === "text" ? 80 : 160;
      if (!isNum(a.x) || !isNum(a.y)) {
        a.x = Math.round(x);
        a.y = Math.round(y);
        x += (a.width as number) + 40;
      }
      if (typeof a.id === "string") placedNotes.push(a.id);
      return a;
    });
    d = { ...d, annotations } as DiagramFile;
  }
  return { diagram: d as unknown as Obj, laidOut: needsLayout, fitted, placedNotes };
}
