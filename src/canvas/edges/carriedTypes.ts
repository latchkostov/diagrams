import { cachedMessageTypesAt, sameElements, sameRoutingFields } from "../../model/messageTypes";
import type { DiagramFile } from "../../model/types";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode } from "../types";
import type { MessageTypes } from "../../model/messageTypes";
import { t } from "../../i18n";
import { createElement, useCallback, useEffect, useState } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { MessageTypesCard } from "./MessageTypesCard";

/** Characters of type names one tooltip shows; full names stay in the analysis and the inspector. */
export const TIP_CHARS = 240;
const texts = new WeakMap<MessageTypes, Map<string, string>>();

/** Only these flow fields reach the analysis (see sameRoutingFields); geometry, measurements and selection never do. */
const sameNode = (a: FlowNode, b: FlowNode) =>
  a === b ||
  (a.id === b.id &&
    a.type === b.type &&
    (a.type !== "diagram" || sameRoutingFields(a.data, (b as DiagramFlowNode).data)));
const sameEdge = (a: DiagramFlowEdge, b: DiagramFlowEdge) =>
  a === b ||
  (a.id === b.id &&
    a.source === b.source &&
    a.target === b.target &&
    a.data?.kind === b.data?.kind &&
    a.data?.relation === b.data?.relation &&
    a.data?.props === b.data?.props);

let last:
  | {
      nodes: readonly FlowNode[];
      edges: readonly DiagramFlowEdge[];
      metadata?: Pick<DiagramFile, "simulations" | "planning">;
      result: MessageTypes;
    }
  | undefined;

/**
 * One semantic propagation shared across canvas snapshots, edges and the inspector. A hovered or focused edge reads
 * this on every React Flow store update: pan and zoom keep the same arrays (one comparison); a drag replaces node
 * objects but not their data (a reference comparison per element). Only a routing edit converts and analyzes.
 */
export function carriedTypes(
  nodes: readonly FlowNode[],
  edges: readonly DiagramFlowEdge[],
  metadata?: Pick<DiagramFile, "simulations" | "planning">,
): MessageTypes {
  if (
    last &&
    last.metadata?.simulations === metadata?.simulations &&
    last.metadata?.planning === metadata?.planning &&
    (last.nodes === nodes || sameElements(last.nodes, nodes, sameNode)) &&
    (last.edges === edges || sameElements(last.edges, edges, sameEdge))
  ) {
    last.nodes = nodes;
    last.edges = edges;
    return last.result;
  }
  const types = cachedMessageTypesAt({
    format: "diagrams/v1",
    title: "",
    ...metadata,
    nodes: nodes
      .filter((n): n is DiagramFlowNode => n.type === "diagram")
      .map((n) => ({ id: n.id, x: 0, y: 0, ...n.data })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...e.data })),
  });
  last = { nodes, edges, metadata, result: types };
  return types;
}

/**
 * One edge's type list for display, built on request and cached with its analysis: names until TIP_CHARS, a single
 * longer name cut with an ellipsis, then a count of the rest. Never formats the other edges.
 */
export function carriedText(types: MessageTypes, id: string): string {
  let cache = texts.get(types);
  if (!cache) texts.set(types, (cache = new Map()));
  let text = cache.get(id);
  if (text !== undefined) return text;
  const carried = types.carried.get(id) ?? new Set<string>();
  const shown: string[] = [];
  let left = TIP_CHARS;
  for (const type of carried) {
    if (type.length + 2 > left) {
      if (!shown.length) shown.push(`${type.slice(0, TIP_CHARS - 1)}…`);
      break;
    }
    left -= type.length + 2;
    shown.push(type);
  }
  const more = carried.size - shown.length;
  text = more ? `${shown.join(", ")} +${t("importReport.more", { count: more })}` : shown.join(", ");
  cache.set(id, text);
  return text;
}

/** An edge's hover and focus text, built here so the canvas chunk carries none of it. */
export function messageTip(
  nodes: readonly FlowNode[],
  edges: readonly DiagramFlowEdge[],
  metadata: Pick<DiagramFile, "simulations" | "planning"> | undefined,
  id: string,
): string {
  return t("messageTypes.hover", {
    types: carriedText(carriedTypes(nodes, edges, metadata), id) || t("messageTypes.noMessages"),
  });
}

/**
 * Mounted by the canvas-wide EdgeMessages reader only while its edge is hovered or focused: reads the edge's
 * carried types on store updates, hands the text back for the edge's titles, and shows the readable card while
 * focused. Unmounting suspends the reader and clears the text.
 */
export function MessageTip({
  id,
  meta,
  focused,
  hovered,
  x,
  y,
  onTip,
}: {
  id: string;
  meta?: Pick<DiagramFile, "simulations" | "planning">;
  focused: boolean;
  hovered: boolean;
  x: number;
  y: number;
  onTip: (tip: string | undefined) => void;
}) {
  const tip = useStore(
    useCallback(
      (s: ReactFlowState) => messageTip(s.nodes as FlowNode[], s.edges as DiagramFlowEdge[], meta, id),
      [id, meta],
    ),
  );
  useEffect(() => onTip(tip), [tip, onTip]);
  useEffect(() => () => onTip(undefined), [onTip]);
  // Keyboard focus is focus that arrives while the pointer isn't on the edge: browsers omit :focus-visible after
  // modified navigation (Ctrl+Alt) that follows a click, and a click on the edge or its label never opens the card.
  const [focus, setFocus] = useState(() => ({ on: focused, pointer: focused && hovered }));
  if (focus.on !== focused) setFocus({ on: focused, pointer: focused && hovered });
  return focused && !focus.pointer ? createElement(MessageTypesCard, { id, text: tip, x, y }) : null;
}

export { MessageTypesCard };
