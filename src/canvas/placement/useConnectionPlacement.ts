import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import type { Connection, OnConnectEnd, OnConnectStart, ReactFlowInstance } from "@xyflow/react";
import type { EditorApi, NewNode } from "../../editor/types";
import { quickAddMenu } from "../../editor/builtinActions";
import { getRecentStencils, pushRecentStencil } from "../../lib/recentStencils";
import { t as tr } from "../../i18n";
import type { AnnotationFlowNode, DiagramFlowEdge, FlowNode } from "../types";
import { platform, type CanvasMenus } from "../menus/useCanvasMenus";
import { portSide } from "../gestures";
import { connectionMarks, connectionTargetAt } from "../interaction/connectTarget";
import { watchConnectionGesture } from "../interaction/usePointerGesture";
import type { GesturePreview } from "../interaction/types";

export function useConnectionPlacement(
  getNode: ReactFlowInstance<FlowNode, DiagramFlowEdge>["getNode"],
  hideTip: () => void,
  wrapper: RefObject<HTMLDivElement | null>,
  readOnly: boolean,
  live: boolean,
  editor: EditorApi,
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"],
  pickNamed: (make: () => NewNode | null, fallback: string) => void,
  menus: CanvasMenus,
) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const flow = useReactFlow<FlowNode, DiagramFlowEdge>();
  const clickConnect = useRef(false);
  // ---------------------------------------------------------------- connecting (D1, D2)
  // While a connection is drawn: a crosshair throughout, the node a drop would connect to lit up (a
  // drop anywhere on it connects), not-allowed over things that take no edges, and a "+" at the end
  // of the line over empty canvas, where a drop opens quick-add for the next node.
  const annotationKindOf = useCallback(
    (id: string) => {
      const n = getNode(id);
      return n?.type === "annotation" ? (n as AnnotationFlowNode).data.kind : undefined;
    },
    [getNode],
  );
  useEffect(
    () => () => {
      const gesture = menus.gesture;
      if (gesture?.kind === "connect") menus.endGesture(gesture.seq, "unmount");
    },
    [menus, readOnly, live],
  );
  const onConnectStart: OnConnectStart = useCallback(
    (event, { nodeId, handleId }) => {
      if (!nodeId) return;
      clickConnect.current = false;
      hideTip();
      const wrap = wrapper.current;
      const marks = connectionMarks(wrap);
      const fromSide = portSide(handleId);
      const preview = (screen: { x: number; y: number }): GesturePreview => {
        const { target: t, at } = connectionTargetAt(
          screen,
          nodeId,
          flow,
          store.getState().nodeLookup.values(),
          annotationKindOf,
        );
        marks.show(t);
        return {
          kind: "connect",
          from: nodeId,
          fromSide,
          over: t.kind === "node" ? { node: t.id, side: t.side } : null,
          target: t.kind,
          screen,
          at,
        };
      };
      const seq = menus.beginGesture(
        "connect",
        { kind: "connect", from: nodeId, fromSide, over: null },
        {
          via: "touches" in event ? "touch" : "mouse",
          cancel: () => {
            store.getState().cancelConnection();
            store.setState({ connectionClickStartHandle: null });
            // Retire XYHandle's document listeners and auto-pan frame as well as its store state.
            // The controller has already ended this gesture, so these late callbacks cannot commit.
            document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            document.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
          },
          commit(p) {
            if (p.kind !== "connect" || readOnly) return;
            const from = p.from;
            const fromSide = p.fromSide;
            if (p.over) {
              editor.connect(from, p.over.node, { sourceSide: fromSide, targetSide: p.over.side });
              return;
            }
            if (p.target !== "canvas" || live || !p.screen) return;
            const screen = p.screen;
            // Empty canvas: quick-add there; the pick lands on the drop point, connected, ready to name.
            const point = screenToFlowPosition({ x: screen.x, y: screen.y });
            menus.openMenu(
              "quickAdd",
              {
                alignment: "physical-left",
                x: screen.x,
                y: screen.y,
                get label() {
                  return tr("canvas.addAConnectedNode");
                },
                testId: "quick-add",
                get searchable() {
                  return tr("canvas.addANode");
                },
                items: () =>
                  quickAddMenu(
                    (s) => {
                      pickNamed(
                        () => editor.createConnected({ from, sourceSide: fromSide, stencil: s.id, at: point }),
                        s.label,
                      );
                      pushRecentStencil(s.id);
                    },
                    getRecentStencils(),
                    (sh) => {
                      pickNamed(
                        () => editor.createConnected({ from, sourceSide: fromSide, shape: sh.id, at: point }),
                        sh.label,
                      );
                    },
                  ),
              },
              { via: "pointer", platform: platform() },
            );
          },
        },
      );
      wrap?.classList.add("is-connecting");
      const pt = "touches" in event ? event.touches[0] : event;
      watchConnectionGesture(
        menus,
        seq,
        preview,
        marks.clear,
        store,
        pt ? { x: pt.clientX, y: pt.clientY } : undefined,
      );
    },
    [hideTip, wrapper, annotationKindOf, menus, readOnly, editor, live, screenToFlowPosition, pickNamed, store, flow],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      // Clicks name an explicit handle; pointer drops resolve in onConnectEnd, exactly as their preview.
      if (!clickConnect.current) return;
      const gesture = menus.gesture;
      if (gesture?.preview.kind !== "connect" || gesture.preview.from !== c.source) return;
      menus.updateGesture(gesture.seq, {
        ...gesture.preview,
        from: c.source,
        fromSide: portSide(c.sourceHandle),
        over: { node: c.target, side: portSide(c.targetHandle) },
        target: "node",
      });
      menus.endGesture(gesture.seq, "drop");
    },
    [menus],
  );
  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const gesture = menus.gesture;
      if (gesture?.preview.kind !== "connect") return;
      const pt = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!pt) {
        menus.endGesture(gesture.seq, "cancel");
        return;
      }
      const screen = { x: pt.clientX, y: pt.clientY };
      const { target: t, at } = connectionTargetAt(
        screen,
        gesture.preview.from,
        flow,
        store.getState().nodeLookup.values(),
        annotationKindOf,
      );
      menus.updateGesture(gesture.seq, {
        ...gesture.preview,
        over: t.kind === "node" ? { node: t.id, side: t.side } : null,
        target: t.kind,
        screen,
        at,
      });
      menus.endGesture(gesture.seq, "drop");
    },
    [menus, annotationKindOf, flow, store],
  );
  const onClickConnectStart: OnConnectStart = useCallback(
    (event, params) => {
      onConnectStart(event, params);
      clickConnect.current = true;
    },
    [onConnectStart],
  );
  const onClickConnectEnd: OnConnectEnd = useCallback(() => {
    const gesture = menus.gesture;
    if (gesture?.kind === "connect") menus.endGesture(gesture.seq, "cancel");
  }, [menus]);
  return [annotationKindOf, onConnectStart, onConnectEnd, onConnect, onClickConnectEnd, onClickConnectStart] as const;
}
