import { cachedMessageTypesAt } from "../../model/messageTypeCache";
import type { DiagramFile } from "../../model/types";
import type { DiagramFlowEdge, DiagramFlowNode } from "../types";
import type { MessageTypes } from "../../model/messageTypes";

const texts = new WeakMap<MessageTypes, ReadonlyMap<string, string>>();

/** One semantic propagation shared across geometry snapshots, edges and the inspector. */
export function carriedTypes(
  nodes: readonly DiagramFlowNode[],
  edges: readonly DiagramFlowEdge[],
  metadata?: Pick<DiagramFile, "simulations" | "planning">,
): ReadonlyMap<string, string> {
  const types = cachedMessageTypesAt({
    format: "diagrams/v1",
    title: "",
    ...metadata,
    nodes: nodes.filter((n) => n.type === "diagram").map((n) => ({ id: n.id, x: 0, y: 0, ...n.data })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...e.data })),
  });
  let result = texts.get(types);
  if (!result) {
    result = new Map([...types.carried].map(([id, list]) => [id, [...list].join(", ")]));
    texts.set(types, result);
  }
  return result;
}

export { MessageTypesCard } from "./MessageTypesCard";
