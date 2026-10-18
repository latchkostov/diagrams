import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { OnConnectEnd, OnConnectStart, ReactFlowInstance } from "@xyflow/react";
import type { EditorApi, NewNode } from "../../editor/types";
import { quickAddMenu } from "../../editor/builtinActions";
import { getRecentStencils, pushRecentStencil } from "../../lib/recentStencils";
import { t as tr } from "../../i18n";
import type { AnnotationFlowNode, DiagramFlowEdge, FlowNode } from "../types";
import type { MenuState } from "../menus/useCanvasMenus";
import { connectHitAt, connectOver, connectTarget } from "../gestures";

export function useConnectionPlacement({
  getNode,
  hideTip,
  wrapper,
  readOnly,
  live,
  editor,
  screenToFlowPosition,
  pickNamed,
  setMenu,
}: {
  getNode: ReactFlowInstance<FlowNode, DiagramFlowEdge>["getNode"];
  hideTip: () => void;
  wrapper: RefObject<HTMLDivElement | null>;
  readOnly: boolean;
  live: boolean;
  editor: EditorApi;
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"];
  pickNamed: (make: () => NewNode | null, fallback: string) => void;
  setMenu: Dispatch<SetStateAction<MenuState | null>>;
}) {
  // ---------------------------------------------------------------- connecting (D1, D2)
  // While a connection is drawn: a crosshair throughout, the node a drop would connect to lit up (a
  // drop anywhere on it connects), not-allowed over things that take no edges, and a "+" at the end
  // of the line over empty canvas, where a drop opens quick-add for the next node.
  const connecting = useRef<{ from: string; over: Element | null; stop: () => void } | null>(null);
  const annotationKindOf = useCallback(
    (id: string) => {
      const n = getNode(id);
      return n?.type === "annotation" ? (n as AnnotationFlowNode).data.kind : undefined;
    },
    [getNode],
  );
  const endConnecting = useCallback(() => {
    const c = connecting.current;
    connecting.current = null;
    c?.stop();
    connectOver.set(null);
  }, []);
  useEffect(() => endConnecting, [endConnecting]);
  const onConnectStart: OnConnectStart = useCallback(
    (_e, { nodeId }) => {
      endConnecting();
      if (!nodeId) return;
      setMenu(null);
      hideTip();
      const wrap = wrapper.current;
      wrap?.classList.add("is-connecting");
      const state = { from: nodeId, over: null as Element | null, stop: () => {} };
      const mark = (el: Element | null, on: boolean) => el?.classList.toggle("is-connect-target", on);
      const onMove = (e: PointerEvent) => {
        const el = e.target instanceof Element ? e.target : null;
        const t = connectTarget(connectHitAt(el, annotationKindOf), nodeId);
        const node = t.kind === "node" ? (el?.closest(".react-flow__node") ?? null) : null;
        if (node !== state.over) {
          mark(state.over, false);
          mark(node, true);
          state.over = node;
        }
        wrap?.classList.toggle("is-connect-invalid", t.kind === "invalid");
        connectOver.set(t.kind);
      };
      document.addEventListener("pointermove", onMove, true);
      state.stop = () => {
        document.removeEventListener("pointermove", onMove, true);
        mark(state.over, false);
        wrap?.classList.remove("is-connecting", "is-connect-invalid");
      };
      connecting.current = state;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setter and wrapper are stable; preserve CanvasView's original dependencies
    [endConnecting, hideTip, annotationKindOf],
  );
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      const from = connecting.current?.from;
      endConnecting();
      // A drop on a handle (or near one) already connected in onConnect.
      if (!from || state.isValid || readOnly) return;
      const pt = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!pt) return;
      const el = document.elementFromPoint(pt.clientX, pt.clientY);
      const t = connectTarget(connectHitAt(el, annotationKindOf), from);
      if (t.kind === "node") {
        editor.connect(from, t.id);
        return;
      }
      if (t.kind !== "canvas" || live) return;
      // Empty canvas: quick-add there; the pick lands on the drop point, connected, ready to name.
      const point = screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      setMenu({
        alignment: "physical-left",
        x: pt.clientX,
        y: pt.clientY,
        get label() {
          return tr("canvas.addAConnectedNode");
        },
        testId: "quick-add",
        get searchable() {
          return tr("canvas.addANode");
        },
        items: () =>
          quickAddMenu((s) => {
            pickNamed(() => editor.createConnected({ from, stencil: s.id, at: point }), s.label);
            pushRecentStencil(s.id);
          }, getRecentStencils()),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMenu is stable; preserve CanvasView's original dependencies
    [endConnecting, readOnly, annotationKindOf, editor, live, screenToFlowPosition, pickNamed],
  );
  return { annotationKindOf, onConnectStart, onConnectEnd };
}
