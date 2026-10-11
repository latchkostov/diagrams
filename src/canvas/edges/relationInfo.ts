import {
  derivedLabel,
  edgeSettingsList,
  isDependency,
  relationOf,
  type ConfigSetting,
  type DependencyRelation,
} from "../../model/relations";
import type { DiagramFlowEdge } from "../types";

/** What a dependency edge shows besides its line: the glyph's relation, text, and settings for the card. */
export interface EdgeRelationInfo {
  relation: DependencyRelation;
  /** The user's label, else a derived one ("4 settings · 2 secret", "2 references"), else none. */
  text?: string;
  /** True when `text` was derived (a user label always wins). */
  derived: boolean;
  /** Settings for the hover card: a config edge's own, or the references a secret edge carries. */
  settings: ConfigSetting[];
}

const cache = new WeakMap<readonly DiagramFlowEdge[], Map<string, EdgeRelationInfo>>();
const EMPTY = new Map<string, EdgeRelationInfo>();

/**
 * Per-edge relationship info for one React Flow edges array, computed once per array (React Flow
 * replaces it on every edge change) and shared by the router and every FlowEdge. Flows have no entry.
 */
export function relationInfo(edges: readonly DiagramFlowEdge[]): Map<string, EdgeRelationInfo> {
  let hit = cache.get(edges);
  if (hit) return hit;
  if (!edges.some((e) => isDependency(e.data))) {
    cache.set(edges, EMPTY);
    return EMPTY;
  }
  const plain = edges.map((e) => ({
    id: e.id,
    from: e.source,
    to: e.target,
    label: e.data?.label?.trim(),
    relation: e.data?.relation,
    props: e.data?.props,
  }));
  hit = new Map();
  for (const e of plain) {
    if (!isDependency(e)) continue;
    const derived = e.label ? undefined : derivedLabel(e, plain);
    hit.set(e.id, {
      relation: relationOf(e) as DependencyRelation,
      text: e.label || derived,
      derived: !e.label && !!derived,
      settings: edgeSettingsList(e, plain),
    });
  }
  cache.set(edges, hit);
  return hit;
}
