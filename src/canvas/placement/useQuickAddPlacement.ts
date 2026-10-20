import {
  useCallback,
  useEffect,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ReactFlowInstance, useStoreApi } from "@xyflow/react";
import type { EditorApi, NewNode } from "../../editor/types";
import { quickAddMenu } from "../../editor/builtinActions";
import { getRecentStencils, pushRecentStencil } from "../../lib/recentStencils";
import { t as tr } from "../../i18n";
import type { DiagramFlowEdge, FlowNode } from "../types";
import type { InlineEdit } from "../DiagramContext";
import type { DiagramMeta } from "../convert";
import { platform, type CanvasMenus, type MenuState } from "../menus/useCanvasMenus";
import { connectedMenuPlacement } from "../geometry/connectedMenuPlacement";
import { towardOf, type Toward } from "../placement";
import { landing } from "../landing";
import { panForConnectedMenu, type CameraController } from "../camera";

/** About how wide quick-add is (its CSS keeps it 224–320 px): room kept for it beside the outline. */
const QUICK_ADD_W = 300;

export function useQuickAddPlacement(
  readOnly: boolean,
  live: boolean,
  presenting: boolean,
  meta: DiagramMeta,
  editor: EditorApi,
  getNode: ReactFlowInstance<FlowNode, DiagramFlowEdge>["getNode"],
  wrapper: RefObject<HTMLDivElement | null>,
  hideTip: () => void,
  setEditing: Dispatch<SetStateAction<InlineEdit | null>>,
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>,
  controller: CameraController,
  pickNamed: (make: () => NewNode | null, fallback: string) => void,
  menu: MenuState | null,
  menus: CanvasMenus,
) {
  // ---------------------------------------------------------------- the next node (D3)
  // Alt+arrow and the "+" on a selected node: quick-add opens under an outline of where the node will land,
  // and the pick arrives there, connected (→ and ↓ from the node, ← and ↑ into it), ready to name.
  // Alt+Shift+arrow skips the menu: a copy of the node lands there, connected the same way.
  const growTo = useCallback(
    (fromId: string, toward?: Toward) => {
      if (readOnly || live || presenting) return;
      const dir = toward ?? towardOf(meta.direction === "TB" ? "TB" : "LR");
      const spot = editor.nextSpot(fromId, dir);
      const from = getNode(fromId);
      const wrap = wrapper.current;
      if (!spot || !from || !wrap) return;
      hideTip();
      setEditing(null);
      // Quick-add opens beside the outline of where the node will land (left of it when growing left, so it
      // never covers the node it grows from). First the view pans, if it must, to show the node, the outline
      // and the menu's room; the menu opens where the outline will be.
      const [tx, ty, k] = store.getState().transform;
      const r = wrap.getBoundingClientRect();
      const menuLeft = dir === "left";
      const card = {
        x: from.position.x,
        y: from.position.y,
        width: from.measured?.width ?? spot.width,
        height: from.measured?.height ?? spot.height,
      };
      const connected = { spot, card, left: menuLeft, width: QUICK_ADD_W };
      const view = { x: tx, y: ty, zoom: k };
      const next = panForConnectedMenu(controller, connected, view, r);
      const { position } = connectedMenuPlacement(connected, next ?? view, r);
      landing.set(spot);
      menus.openMenu(
        "connected",
        {
          connected,
          alignment: "physical-left",
          ...position,
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
                pickNamed(() => editor.createConnected({ from: fromId, stencil: s.id, toward: dir }), s.label);
                pushRecentStencil(s.id);
              },
              getRecentStencils(),
              (sh) => {
                pickNamed(() => editor.createConnected({ from: fromId, shape: sh.id, toward: dir }), sh.label);
              },
            ),
        },
        { platform: platform() },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters and wrapper are stable; preserve CanvasView's original dependencies
    [readOnly, live, presenting, meta.direction, editor, getNode, hideTip, store, controller, pickNamed, menus],
  );
  const cloneTo = useCallback(
    (fromId: string, toward: Toward) => {
      if (readOnly || live || presenting) return;
      menus.closeMenu("command");
      hideTip();
      const fallback = editor.getNode(fromId)?.label ?? editor.getAnnotation(fromId)?.text ?? "";
      pickNamed(
        () => editor.createConnected({ from: fromId, clone: true, toward }),
        fallback,
      );
    },
    [readOnly, live, presenting, editor, hideTip, pickNamed, menus],
  );
  // The outline goes with its menu.
  useEffect(() => {
    if (!menu) landing.set(null);
  }, [menu]);
  useEffect(() => () => landing.set(null), []);
  const growFromChip = useCallback((id: string) => growTo(id), [growTo]);
  return [growTo, cloneTo, growFromChip] as const;
}

export function paneQuickAdd(
  readOnly: boolean,
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"],
  menus: CanvasMenus,
  pickNamed: (make: () => NewNode | null, fallback: string) => void,
  editor: EditorApi,
) {
  /** Double-click on empty canvas: stencil search at the cursor. */
  const onPaneDoubleClick = (e: ReactMouseEvent) => {
    if (readOnly) return;
    if (!(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) return;
    const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    menus.openMenu(
      "quickAdd",
      {
        alignment: "physical-left",
        x: e.clientX,
        y: e.clientY,
        get label() {
          return tr("canvas.addANodeText");
        },
        testId: "quick-add",
        get searchable() {
          return tr("canvas.addANode");
        },
        // Quick-add opens the new node's name (decision 3), so what's typed next names it instead of reaching the
        // canvas's one-key shortcuts (T, L, C).
        items: () =>
          quickAddMenu(
            (s) => {
              pickNamed(() => editor.addNamed(s.id, point), s.label);
              pushRecentStencil(s.id);
            },
            getRecentStencils(),
            (sh) => {
              pickNamed(
                () => {
                  const id = editor.addAnnotation("shape", { at: point, shape: sh.id });
                  return id ? { id, edge: null, merge: `new:${id}` } : null;
                },
                sh.label,
              );
            },
          ),
      },
      { via: "pointer", platform: platform() },
    );
  };
  return onPaneDoubleClick;
}
