import { useCallback, useEffect, type RefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import type { Connection, OnConnectEnd, OnConnectStart, ReactFlowInstance } from "@xyflow/react";
import type { EditorApi, NewNode } from "../../editor/types";
import { quickAddMenu } from "../../editor/builtinActions";
import { getRecentStencils, pushRecentStencil } from "../../lib/recentStencils";
import { t as tr } from "../../i18n";
import type { AnnotationFlowNode, DiagramFlowEdge, FlowNode } from "../types";
import { platform, type CanvasMenus } from "../menus/useCanvasMenus";
import { connectHitAt, connectTarget } from "../gestures";
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
    (event, { nodeId }) => {
      if (!nodeId) return;
      hideTip();
      const wrap = wrapper.current;
      let over: Element | null = null;
      const mark = (el: Element | null, on: boolean) => el?.classList.toggle("is-connect-target", on);
      const preview = (screen: { x: number; y: number }): GesturePreview => {
        const el = document.elementFromPoint(screen.x, screen.y);
        const t = connectTarget(connectHitAt(el, annotationKindOf), nodeId);
        const node = t.kind === "node" ? (el?.closest(".react-flow__node") ?? null) : null;
        if (node !== over) {
          mark(over, false);
          mark(node, true);
          over = node;
        }
        wrap?.classList.toggle("is-connect-invalid", t.kind === "invalid");
        return {
          kind: "connect",
          from: nodeId,
          over: t.kind === "node" ? { node: t.id } : null,
          target: t.kind,
          screen,
        };
      };
      const seq = menus.beginGesture(
        "connect",
        { kind: "connect", from: nodeId, over: null },
        {
          via: "touches" in event ? "touch" : "mouse",
          cancel: () => store.getState().cancelConnection(),
          commit(p) {
            if (p.kind !== "connect" || readOnly) return;
            const from = p.from;
            if (p.over) {
              editor.connect(from, p.over.node);
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
                      pickNamed(() => editor.createConnected({ from, stencil: s.id, at: point }), s.label);
                      pushRecentStencil(s.id);
                    },
                    getRecentStencils(),
                    (sh) => {
                      pickNamed(() => editor.createConnected({ from, shape: sh.id, at: point }), sh.label);
                    },
                  ),
              },
              { via: "pointer", platform: platform() },
            );
          },
        },
      );
      wrap?.classList.add("is-connecting");
      watchConnectionGesture(menus, seq, preview, () => {
        mark(over, false);
        wrap?.classList.remove("is-connecting", "is-connect-invalid");
        // React Flow owns the line, but Esc/blur/remote/unmount must also retire its connection.
      });
    },
    [hideTip, wrapper, annotationKindOf, menus, readOnly, editor, live, screenToFlowPosition, pickNamed, store],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const gesture = menus.gesture;
      if (gesture?.preview.kind !== "connect") return;
      menus.updateGesture(gesture.seq, { ...gesture.preview, over: { node: c.target }, target: "node" });
      menus.endGesture(gesture.seq, "drop");
    },
    [menus],
  );
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      const gesture = menus.gesture;
      if (gesture?.preview.kind !== "connect") return;
      if (state.isValid) {
        menus.endGesture(gesture.seq, "cancel");
        return;
      }
      const pt = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!pt) {
        menus.endGesture(gesture.seq, "cancel");
        return;
      }
      const screen = { x: pt.clientX, y: pt.clientY };
      const t = connectTarget(
        connectHitAt(document.elementFromPoint(screen.x, screen.y), annotationKindOf),
        gesture.preview.from,
      );
      menus.updateGesture(gesture.seq, {
        ...gesture.preview,
        over: t.kind === "node" ? { node: t.id } : null,
        target: t.kind,
        screen,
      });
      menus.endGesture(gesture.seq, "drop");
    },
    [menus, annotationKindOf],
  );
  return [annotationKindOf, onConnectStart, onConnectEnd, onConnect] as const;
}
