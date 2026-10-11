import { isDependency, relationOf, type DependencyRelation } from "../../model/relations";
import type { DiagramFlowEdge } from "../types";

type Row = { relation: DependencyRelation; target: string };
const cache = new WeakMap<readonly DiagramFlowEdge[], Map<string, Row[]>>();

/** Structured rows preserve arbitrary IDs; selectors share stable arrays per edges snapshot. */
export function pipsByNode(edges: readonly DiagramFlowEdge[]): Map<string, Row[]> {
  const cached = cache.get(edges);
  if (cached) return cached;
  const result = new Map<string, Row[]>();
  for (const e of edges) {
    const relation = relationOf(e.data);
    if (!isDependency(e.data) || relation === "flow") continue;
    let rows = result.get(e.source);
    if (!rows) {
      rows = [];
      result.set(e.source, rows);
    }
    rows.push({ relation, target: e.target });
  }
  cache.set(edges, result);
  return result;
}
