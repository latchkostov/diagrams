// The agent skill's layout (skills/livediagrams/scripts/layout.mjs), bundled with the app's own code into
// skills/livediagrams/scripts/lib/app.mjs by `pnpm schemas`. A diagram an agent writes without coordinates
// is laid out by the same code as a pasted file in the app (fileToDiagram in src/ai/ui/apply.ts); both keep
// boundary membership as written. Unlike a paste, any node without x/y lays out every node (an agent writes
// whole diagrams). Pure and dependency-free: it must run under plain Node.

import type { DiagramFile } from "../../model/types";
import { validateDiagram } from "../../interop/native";
import { estimateCardSize } from "../../canvas/nodes/size";
import { fitGroups, placeNew } from "../place";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const BOX = ["x", "y", "width", "height"] as const;
const hasBox = (o: Obj) => BOX.every((k) => isNum(o[k]));

export type LayoutResult =
  | {
      ok: true;
      /** The input with node/annotation positions and boundary boxes updated; authored fields survive. */
      diagram: Obj & { nodes: unknown[]; groups?: unknown[]; annotations?: unknown[] };
      /** Every node was placed by the layered layout. */
      laidOut: boolean;
      /** Boundaries whose boxes were fitted around their members. */
      fitted: string[];
      /** Notes and texts that were given a position. */
      placedNotes: string[];
    }
  | { ok: false; error: string };

/**
 * Fills in what an agent may leave out: node x/y (any node without them, or `force`, lays out every
 * node with the app's layered layout), boundary boxes (fitted around their members) and note/text
 * boxes (a row under everything else). The layout runs on a copy checked by the app's own validator,
 * and only the positions are written back, so the rest of the input is returned exactly as written.
 */
export function layoutDiagram(input: unknown, opts: { force?: boolean } = {}): LayoutResult {
  if (!isObj(input)) return { ok: false, error: "The file must hold one JSON object: the diagram." };
  if (!Array.isArray(input.nodes)) return { ok: false, error: 'The diagram needs a "nodes" list.' };
  const nodesIn = input.nodes as unknown[];
  const groupsIn = Array.isArray(input.groups) ? (input.groups as unknown[]) : [];
  const needsLayout = !!opts.force || nodesIn.some((n) => isObj(n) && (!isNum(n.x) || !isNum(n.y)));

  // A copy the validator can accept: placeholder positions and boxes where the layout will fill them in.
  const draft: Obj = {
    ...input,
    nodes: nodesIn.map((n) => (isObj(n) ? { ...n, x: isNum(n.x) ? n.x : 0, y: isNum(n.y) ? n.y : 0 } : n)),
    ...(Array.isArray(input.groups)
      ? {
          groups: groupsIn.map((g) =>
            isObj(g) ? { ...g, ...Object.fromEntries(BOX.map((k) => [k, isNum(g[k]) ? g[k] : 0])) } : g,
          ),
        }
      : {}),
  };
  const checked = validateDiagram(draft);
  if (!checked.ok) return { ok: false, error: checked.error };
  let d: DiagramFile = checked.diagram;

  const unboxed = new Set(groupsIn.filter((g): g is Obj => isObj(g) && !hasBox(g)).map((g) => g.id as string));
  let fitted: string[];
  if (needsLayout) {
    // Every id is "kept outside": a file's boundary membership is deliberate, so unlike an added
    // node, a node next to a boundary isn't pulled into it.
    const ids = d.nodes.map((n) => n.id);
    d = placeNew(d, ids, "full", [], ids);
    fitted = (d.groups ?? []).map((g) => g.id);
  } else {
    d = fitGroups(d, unboxed);
    fitted = (d.groups ?? []).filter((g) => unboxed.has(g.id)).map((g) => g.id);
  }

  // Write the positions back onto the input.
  const nodeAt = new Map(d.nodes.map((n) => [n.id, n]));
  const groupAt = new Map((d.groups ?? []).map((g) => [g.id, g]));
  const out: Extract<LayoutResult, { ok: true }>["diagram"] = {
    ...input,
    nodes: nodesIn.map((n) => {
      const placed = isObj(n) && nodeAt.get(n.id as string);
      return placed ? { ...n, x: placed.x, y: placed.y } : n;
    }),
  };
  if (Array.isArray(input.groups))
    out.groups = groupsIn.map((g) => {
      const box = isObj(g) && fitted.includes(g.id as string) ? groupAt.get(g.id as string) : undefined;
      return box && isObj(g) ? { ...g, x: box.x, y: box.y, width: box.width, height: box.height } : g;
    });

  // Notes and texts without a box go in a row under everything else: nodes, boundaries and the
  // annotations that already have a place, so nothing is covered.
  const placedNotes: string[] = [];
  if (Array.isArray(input.annotations)) {
    const annotationAt = new Map((d.annotations ?? []).map((a) => [a.id, a]));
    const annotations = (input.annotations as unknown[]).map((raw) => {
      const placed = isObj(raw) && hasBox(raw) && annotationAt.get(raw.id as string);
      return placed ? { ...raw, x: placed.x, y: placed.y } : raw;
    });
    const occupied = [
      ...d.nodes.map((n) => ({ x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) })),
      ...(d.groups ?? []),
      ...annotations
        .filter((a): a is Obj => isObj(a) && hasBox(a))
        .map((a) => a as { x: number; y: number; width: number; height: number }),
    ];
    let x = occupied.length ? Math.min(...occupied.map((b) => b.x)) : 40;
    const y = occupied.length ? Math.max(...occupied.map((b) => b.y + b.height)) + 60 : 40;
    out.annotations = annotations.map((raw) => {
      if (!isObj(raw) || hasBox(raw) || (raw.kind !== "note" && raw.kind !== "text")) return raw;
      const a = { ...raw };
      if (!isNum(a.width) || a.width < 1) a.width = 240;
      if (!isNum(a.height) || a.height < 1) a.height = a.kind === "text" ? 80 : 160;
      if (!isNum(a.x) || !isNum(a.y)) {
        a.x = Math.round(x);
        a.y = Math.round(y);
        x += (a.width as number) + 40;
      }
      if (typeof a.id === "string") placedNotes.push(a.id);
      return a;
    });
  }
  return { ok: true, diagram: out, laidOut: needsLayout, fitted, placedNotes };
}
