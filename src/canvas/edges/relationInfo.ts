import { deriveRelationInfo, type EdgeRelationInfo } from "../../model/relations";
import type { DiagramFlowEdge } from "../types";

export type { EdgeRelationInfo } from "../../model/relations";
const cache = new WeakMap<readonly DiagramFlowEdge[], Map<string, EdgeRelationInfo>>();
const stable = new WeakMap<object, EdgeRelationInfo>();

const same = (a: EdgeRelationInfo, b: EdgeRelationInfo) =>
  a.relation === b.relation &&
  a.text === b.text &&
  a.derived === b.derived &&
  a.settings.length === b.settings.length &&
  a.settings.every((s, i) => s.key === b.settings[i].key && s.secret === b.settings[i].secret);

/** Adapt at the canvas boundary; derivation and indexing live in the shared model. */
export function relationInfo(edges: readonly DiagramFlowEdge[]): Map<string, EdgeRelationInfo> {
  const cached = cache.get(edges);
  if (cached) return cached;
  const result = deriveRelationInfo(edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...e.data })));
  for (const e of edges) {
    const info = result.get(e.id);
    if (!info || !e.data) continue;
    const previous = stable.get(e.data);
    if (previous && same(previous, info)) result.set(e.id, previous);
    else stable.set(e.data, info);
  }
  cache.set(edges, result);
  return result;
}
