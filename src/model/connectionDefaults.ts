import type { DiagramEdge, PlanningModel } from "./types";
import { inferKind } from "../stencils/edgeKind";
import { inferRelation } from "../stencils/relations";
import { stencilRole } from "../stencils/roles";

/** Same defaults for drawn, quick-added and agent-created connections. Labels never identify groups. */
export function connectionDefaults(
  from: { id: string; stencil?: string },
  to: { id: string; stencil?: string },
  planning?: PlanningModel,
  authored: Pick<DiagramEdge, "kind" | "relation" | "props"> = {},
): Required<Pick<DiagramEdge, "kind">> & Pick<DiagramEdge, "relation" | "relationOrigin" | "props"> {
  const relation = authored.relation ?? inferRelation(from.stencil, to.stencil);
  if (relation !== "flow")
    return {
      kind: authored.kind ?? "async",
      relation,
      ...(!authored.relation ? { relationOrigin: "inferred" } : {}),
      ...(authored.props ? { props: authored.props } : {}),
    };
  const kind = authored.kind ?? inferKind(from.stencil, to.stencil);
  const role = from.stencil ? stencilRole(from.stencil) : undefined;
  const group = planning && kind === "async" && (role === "topic" || role === "stream") ? to.id : undefined;
  const props = {
    ...(group && authored.props?.group === undefined ? { group, groupOrigin: "inferred" } : {}),
    ...authored.props,
  };
  return {
    kind,
    ...(authored.relation && authored.relation !== "flow" ? { relation } : {}),
    ...(Object.keys(props).length ? { props } : {}),
  };
}

/** Rewire inferred identity with its consumer; authored group names are stable across copies. */
export function remapConnection(edge: DiagramEdge, ids: ReadonlyMap<string, string>): DiagramEdge {
  const to = ids.get(edge.to) ?? edge.to;
  const next = { ...structuredClone(edge), from: ids.get(edge.from) ?? edge.from, to };
  if (next.props?.groupOrigin === "inferred") next.props.group = to;
  return next;
}

export function connectionProps(before: DiagramEdge["props"], patch: NonNullable<DiagramEdge["props"]>) {
  return { ...before, ...patch, ...("group" in patch ? { groupOrigin: undefined } : {}) };
}
