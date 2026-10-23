import type { InternalNode, ReactFlowInstance } from "@xyflow/react";
import type { AnnotationKind } from "../../model/types";
import type { DiagramFlowEdge, FlowNode } from "../types";
import type { Point } from "../geometry/rect";
import type { Side } from "../../model/types";
import { connectHitAt, connectTarget, connectionRadius, portSide, type ConnectTarget } from "../gestures";

// The dots' resolver: its own chunk, loaded by connectDots.ts (which falls back to node bodies until it arrives).

type Flow = Pick<ReactFlowInstance<FlowNode, DiagramFlowEdge>, "getZoom" | "screenToFlowPosition">;

/** The same measured handles and zoom-aware radius as React Flow, also used by reconnect previews. */
export function connectionTargetAt(
  screen: Point,
  from: string,
  flow: Flow,
  nodes: Iterable<InternalNode<FlowNode>>,
  kindOf: (id: string) => AnnotationKind | undefined,
) {
  const at = flow.screenToFlowPosition(screen, { snapToGrid: false });
  const element = document.elementFromPoint(screen.x, screen.y);
  const body = connectTarget(connectHitAt(element, kindOf), from);
  // Outside the canvas, on the source itself, or on something that takes no connections (a note, a text): rejected,
  // however near another node's dot it is.
  if (body.kind === "outside" || body.kind === "source" || body.kind === "invalid") return { target: body, at };
  // React Flow gives the actual handle under the pointer priority over distance (including its hit area).
  const directNode = element?.classList?.contains("react-flow__handle") ? element.getAttribute("data-nodeid") : null;
  const directSide = directNode ? portSide(element?.getAttribute("data-handleid")) : undefined;
  if (directNode === from) return { target: { kind: "source" as const }, at };
  const radius = connectionRadius(flow.getZoom());
  let distance = Infinity;
  let target: ConnectTarget = body;
  let snapped = at;
  for (const node of nodes) {
    if (
      node.hidden ||
      node.id === from ||
      !(node.type === "diagram" || (node.type === "annotation" && kindOf(node.id) === "shape"))
    )
      continue;
    const origin = node.internals.positionAbsolute;
    if (
      directNode !== node.id &&
      (at.x < origin.x - radius ||
        at.y < origin.y - radius ||
        at.x > origin.x + (node.measured.width ?? 0) + radius ||
        at.y > origin.y + (node.measured.height ?? 0) + radius)
    )
      continue;
    const handles = (node.internals.handleBounds?.source ?? []).map((h) => ({
      id: h.id ?? "",
      x: origin.x + h.x + h.width / 2,
      y: origin.y + h.y + h.height / 2,
    }));
    if (directNode === node.id) {
      const port = handles.find((h) => h.id === directSide);
      return {
        target: { kind: "node" as const, id: node.id, side: directSide },
        at: port ? { x: port.x, y: port.y } : at,
      };
    }
    const side = portAt(at, handles, radius);
    const port = side && handles.find((h) => h.id === side);
    if (!port) continue;
    const d = (port.x - at.x) ** 2 + (port.y - at.y) ** 2;
    if (d >= distance) continue;
    distance = d;
    target = { kind: "node", id: node.id, side };
    snapped = { x: port.x, y: port.y };
  }
  return { target, at: snapped };
}

/** The nearest measured dot within radius, in absolute flow coordinates (including shape-outline dots). */
export function portAt(
  p: { x: number; y: number },
  handles: readonly { id: string; x: number; y: number }[],
  radius: number,
): Side | undefined {
  let found: Side | undefined;
  let distance = radius * radius;
  for (const handle of handles) {
    const side = portSide(handle.id);
    const d = (p.x - handle.x) ** 2 + (p.y - handle.y) ** 2;
    if (side && d <= distance && (d < distance || !found)) {
      found = side;
      distance = d;
    }
  }
  return found;
}
