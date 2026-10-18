import { useCallback, useMemo, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import type { EdgeMouseHandler, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import { actionRegistry, type ActionContext, type MenuNode } from "../../editor/actions";
import type { EditorApi, Selection } from "../../editor/types";
import { t as tr, type useLocale } from "../../i18n";
import { isMac } from "../../editor/shortcuts";
import type { InteractionController } from "../interaction";
import type { ConnectedMenuAnchor } from "../geometry/connectedMenuPlacement";
import type { InlineEdit } from "../DiagramContext";
import { isAnnotationNode, isGroupNode, type DiagramFlowEdge, type FlowNode } from "../types";

const EMPTY: Selection = { nodeIds: [], edgeIds: [], groupIds: [] };

export type MenuState = {
  connected?: ConnectedMenuAnchor;
  x: number;
  y: number;
  flipX?: number;
  items: () => MenuNode[];
  alignment?: "physical-left";
  label: string;
  searchable?: string;
  testId?: string;
};
/** What opens over the canvas: a menu (its anchor and items), or a dialog (no payload). */
export type CanvasSurface = MenuState | null;
/** The canvas's menus: they open and close through the interaction controller, with a reason. */
export type CanvasMenus = InteractionController<CanvasSurface>;

/** The open menu's items, built again when the language changes. */
export function useCanvasMenuItems(menu: MenuState | null, locale: ReturnType<typeof useLocale>) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- factories resolve translated metadata from the locale store
  return useMemo(() => menu?.items() ?? [], [menu, locale]);
}

/** The platform, as menus are told it (macOS opens a context menu on Control-click too). */
export const platform = () => (isMac() ? "mac" : "other");

export function useCanvasContextMenus(
  editor: EditorApi,
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"],
  readOnly: boolean,
  live: boolean,
  hideTip: () => void,
  hintSeen: boolean,
  dismissHint: () => void,
  setEditing: Dispatch<SetStateAction<InlineEdit | null>>,
  menus: CanvasMenus,
) {
  // ---------------------------------------------------------------- context menus

  const openMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent, ctx: Omit<ActionContext, "editor" | "point">) => {
      e.preventDefault();
      if (readOnly) return;
      const full: ActionContext = {
        ...ctx,
        editor,
        mode: live ? "live" : "edit",
        point: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      };
      const items = actionRegistry.build(full);
      setEditing(null);
      hideTip();
      if (!hintSeen) dismissHint();
      if (!items.length) return menus.closeMenu("replaced");
      menus.openMenu(
        "context",
        {
          x: e.clientX,
          y: e.clientY,
          items: () => actionRegistry.build(full),
          get label() {
            return tr("menu.valueNodeValueEdgeValueGroupValueSelectionValueAnnotation", { target: ctx.target });
          },
        },
        { via: "pointer", platform: platform() },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state setters are stable; preserve CanvasView's original dependencies
    [editor, screenToFlowPosition, readOnly, live, hideTip, hintSeen, dismissHint, menus],
  );

  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => openMenu(e, { target: "canvas", selection: editor.getSelection() }),
    [openMenu, editor],
  );

  const onNodeContextMenu: NodeMouseHandler<FlowNode> = useCallback(
    (e, node) => {
      const sel = editor.getSelection();
      const count = sel.nodeIds.length + sel.groupIds.length + sel.edgeIds.length;
      if (node.selected && count > 1) return openMenu(e, { target: "selection", selection: sel });
      // A right-click selects what it's on, as a click does.
      menus.selecting("click");
      if (isAnnotationNode(node)) {
        editor.select({ nodeIds: [node.id] });
        return openMenu(e, { target: "annotation", nodeId: node.id, selection: { ...EMPTY, nodeIds: [node.id] } });
      }
      if (isGroupNode(node)) {
        const groupIds = [node.data.groupId];
        editor.select({ groupIds });
        return openMenu(e, { target: "group", groupId: node.data.groupId, selection: { ...EMPTY, groupIds } });
      }
      editor.select({ nodeIds: [node.id] });
      openMenu(e, { target: "node", nodeId: node.id, selection: { ...EMPTY, nodeIds: [node.id] } });
    },
    [editor, openMenu, menus],
  );

  const openEdgeMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent, edgeId: string) => {
      menus.selecting("click");
      editor.select({ edgeIds: [edgeId] });
      openMenu(e, { target: "edge", edgeId, selection: { ...EMPTY, edgeIds: [edgeId] } });
    },
    [editor, openMenu, menus],
  );
  const onEdgeContextMenu: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (e, edge) => openEdgeMenu(e, edge.id),
    [openEdgeMenu],
  );

  const onSelectionContextMenu = useCallback(
    (e: ReactMouseEvent) => openMenu(e, { target: "selection", selection: editor.getSelection() }),
    [openMenu, editor],
  );
  return [onPaneContextMenu, onNodeContextMenu, openEdgeMenu, onEdgeContextMenu, onSelectionContextMenu] as const;
}
