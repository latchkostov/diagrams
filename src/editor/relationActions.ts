import type { IconName } from "../components/Icon";
import type { DiagramEdge, EdgeRelation } from "../model/types";
import { DEPENDENCY_RELATIONS, RELATION_META, relationOf, type DependencyRelation } from "../model/relations";
import type { Action, ActionContext, MenuNode } from "./actions";
import type { EditorApi } from "./types";

// Relationship ▸ (right-click an edge or a selection, the inspector, Ctrl+K): one concept with eight
// choices. Message and Request are the two flows (async / sync); the six dependencies follow, grouped
// as the reader thinks of them: what it reads (config, secret, identity, telemetry), then what changes
// or underpins it (deploys, depends on).

export type RelationChoiceId = "message" | "request" | DependencyRelation;

export interface RelationChoice {
  id: RelationChoiceId;
  label: string;
  icon: IconName;
  hint: string;
  relation: EdgeRelation;
  kind?: "async" | "sync";
}

export const relationIcon = (relation: EdgeRelation, kind?: "async" | "sync"): IconName =>
  relation === "flow" ? (kind === "sync" ? "rel-request" : "rel-message") : `rel-${relation}`;

export const RELATION_CHOICES: readonly RelationChoice[] = [
  {
    id: "message",
    label: "Message",
    icon: "rel-message",
    hint: "Async: queued, dashed",
    relation: "flow",
    kind: "async",
  },
  {
    id: "request",
    label: "Request",
    icon: "rel-request",
    hint: "Sync: waits for a reply",
    relation: "flow",
    kind: "sync",
  },
  ...DEPENDENCY_RELATIONS.map((r): RelationChoice => ({
    id: r,
    label: RELATION_META[r].label,
    icon: relationIcon(r),
    hint: RELATION_META[r].hint,
    relation: r,
  })),
];

/** Separators go before these (flows | reads | changes). */
const GROUP_STARTS = new Set<RelationChoiceId>(["config", "deploy"]);

export function choiceOf(e: Pick<DiagramEdge, "kind" | "relation"> | undefined): RelationChoiceId {
  const r = relationOf(e);
  return r === "flow" ? (e?.kind === "sync" ? "request" : "message") : r;
}

/** Sets one relationship on many edges as a single undo step. Kind is kept on dependencies. */
export function applyChoice(editor: EditorApi, edgeIds: readonly string[], choice: RelationChoice): void {
  const merge = `relation:${edgeIds.join(",")}:${Date.now()}`;
  const existing = new Set(editor.getDiagram().edges.map((e) => e.id));
  const ids = edgeIds.filter((id) => existing.has(id));
  if (!ids.length) return;
  editor.updateEdges(
    ids,
    choice.relation === "flow" ? { relation: undefined, kind: choice.kind } : { relation: choice.relation },
    { merge },
  );
}

/** The edges a menu acts on: the selection when the clicked edge is part of it, else just that edge. */
function targetEdges(ctx: ActionContext): string[] {
  const sel = ctx.selection.edgeIds;
  if (ctx.edgeId && !sel.includes(ctx.edgeId)) return [ctx.edgeId];
  return sel.length ? sel : ctx.edgeId ? [ctx.edgeId] : [];
}

export function relationMenu(ctx: ActionContext): MenuNode[] {
  const ids = targetEdges(ctx);
  const byId = new Map(ctx.editor.getDiagram().edges.map((e) => [e.id, e]));
  const current = new Set(ids.map((id) => choiceOf(byId.get(id))));
  return RELATION_CHOICES.flatMap((c): MenuNode[] => [
    ...(GROUP_STARTS.has(c.id) ? [{ type: "separator" } as const] : []),
    {
      type: "item",
      id: `relation:${c.id}`,
      label: c.label,
      icon: c.icon,
      hint: c.relation === "flow" ? (c.kind === "sync" ? "sync" : "async") : undefined,
      keywords: `relationship ${c.hint} ${c.relation === "flow" ? "flow" : `dependency ${RELATION_META[c.relation].implicit}`}`,
      checked: current.size === 1 && current.has(c.id),
      run: () => applyChoice(ctx.editor, ids, c),
    },
  ]);
}

/** Replaces the old "Make sync / Make async" row; the edge menu keeps its length. */
export const relationshipAction: Action = {
  id: "edge.relationship",
  section: "edge",
  targets: ["edge", "selection"],
  label: "Relationship",
  icon: "rel-any",
  order: 10,
  when: (ctx) => targetEdges(ctx).length > 0,
  children: relationMenu,
};

/** Flow-only rows (dead-letter path, consumer group) hide for dependencies: their menu is shorter. */
export const isFlowEdgeTarget = (ctx: ActionContext) => relationOf(ctx.editor.getEdge(ctx.edgeId!)) === "flow";
