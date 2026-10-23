import type { InternalNode, ReactFlowInstance } from "@xyflow/react";
import type { AnnotationKind } from "../../model/types";
import type { DiagramFlowEdge, FlowNode } from "../types";
import type { Point } from "../geometry/rect";
import { connectHitAt, connectTarget, type ConnectTarget } from "../gestures";
import { loadFailed, loadOnce } from "../../lib/lazyLoad";

// A connection's or a reconnect's target, with its dots. The dots' resolver (connectTarget.ts) is its own chunk,
// downloaded as soon as an editable canvas is up and again when a gesture needs it. Until it arrives (or if it
// couldn't), a drop attaches to the node under the pointer, its body, as before dots; its preview shows the same.
// Its recovery stays here, outside that chunk: a gesture that needed it hears of a failure in a toast with Retry.

type Resolver = typeof import("./connectTarget");
let resolver: Resolver | undefined;
/** Held gestures waiting for the dots: each re-resolves its preview the moment they arrive. */
const waiting = new Set<() => void>();
const load = loadOnce(() =>
  import("./connectTarget").then((m) => {
    resolver = m;
    for (const run of [...waiting]) run();
    waiting.clear();
  }),
);

/** Starts the dots' download; `gesture`: one is starting now and needs them, so a failure is said, with Retry. */
export function requestDots(gesture = false) {
  if (resolver) return;
  load().catch(() => gesture && loadFailed(() => requestDots(true)));
}

/** Runs `run` when the dots arrive, if they haven't yet; returns the unsubscribe. */
export function onDots(run: () => void): () => void {
  if (resolver) return () => {};
  waiting.add(run);
  return () => void waiting.delete(run);
}

type Flow = Pick<ReactFlowInstance<FlowNode, DiagramFlowEdge>, "getZoom" | "screenToFlowPosition">;

/** What a drop at `screen` connects to: with the dots once they're here, else the node under the pointer. */
export function connectionAt(
  screen: Point,
  from: string,
  flow: Flow,
  nodes: Iterable<InternalNode<FlowNode>>,
  kindOf: (id: string) => AnnotationKind | undefined,
): { target: ConnectTarget; at: Point } {
  if (resolver) return resolver.connectionTargetAt(screen, from, flow, nodes, kindOf);
  return {
    target: connectTarget(connectHitAt(document.elementFromPoint(screen.x, screen.y), kindOf), from),
    at: flow.screenToFlowPosition(screen, { snapToGrid: false }),
  };
}

/** Transient DOM feedback stays local to its gesture; it never changes the document. */
export function connectionMarks(wrap: Element | null) {
  let node: Element | null = null;
  const clearTarget = () => {
    node?.classList.remove("is-connect-target", "has-connect-port");
  };
  return {
    show(target: ConnectTarget) {
      clearTarget();
      node =
        target.kind === "node"
          ? (wrap?.querySelector(`.react-flow__node[data-id="${CSS.escape(target.id)}"]`) ?? null)
          : null;
      node?.classList.add("is-connect-target");
      node?.classList.toggle("has-connect-port", target.kind === "node" && !!target.side);
      wrap?.classList.add("is-connecting");
      wrap?.classList.toggle("is-connect-invalid", target.kind === "invalid" || target.kind === "source");
    },
    clear() {
      clearTarget();
      wrap?.classList.remove("is-connecting", "is-connect-invalid");
    },
  };
}
