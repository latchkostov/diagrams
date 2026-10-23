import { cachedMessageTypesAt, sameElements } from "../../model/messageTypeCache";
import type { DiagramFile } from "../../model/types";
import type { DiagramFlowEdge, DiagramFlowNode, FlowNode } from "../types";
import type { MessageTypes } from "../../model/messageTypes";

const texts = new WeakMap<MessageTypes, ReadonlyMap<string, string>>();

/** Only these flow fields reach the analysis (see messageTypeCache); geometry, measurements and selection never do. */
const sameNode = (a: FlowNode, b: FlowNode) =>
  a === b ||
  (a.id === b.id &&
    a.type === b.type &&
    (a.type !== "diagram" ||
      (a.data.stencil === (b as DiagramFlowNode).data.stencil &&
        a.data.label === (b as DiagramFlowNode).data.label &&
        a.data.props === (b as DiagramFlowNode).data.props)));
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
      result: ReadonlyMap<string, string>;
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
): ReadonlyMap<string, string> {
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
  let result = texts.get(types);
  if (!result) {
    result = new Map([...types.carried].map(([id, list]) => [id, [...list].join(", ")]));
    texts.set(types, result);
  }
  last = { nodes, edges, metadata, result };
  return result;
}

export { MessageTypesCard } from "./MessageTypesCard";
