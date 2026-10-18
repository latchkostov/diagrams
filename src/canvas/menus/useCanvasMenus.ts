import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import type { EdgeMouseHandler, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import { actionRegistry, type ActionContext, type MenuNode } from "../../editor/actions";
import type { EditorApi, Selection } from "../../editor/types";
import { t as tr, type useLocale } from "../../i18n";
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
export function useCanvasMenuState(locale: ReturnType<typeof useLocale>) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- factories resolve translated metadata from the locale store
  const menuItems = useMemo(() => menu?.items() ?? [], [menu, locale]);
  return { menu, setMenu, menuItems };
}

export function useMenuOpen(menu: MenuState | null) {
  const menuOpen = useRef(false);
  useEffect(() => {
    menuOpen.current = !!menu;
  });
  return menuOpen;
}

export function useCanvasContextMenus({
  editor,
  screenToFlowPosition,
  readOnly,
  live,
  hideTip,
  hintSeen,
  dismissHint,
  setEditing,
  setMenu,
}: {
  editor: EditorApi;
  screenToFlowPosition: ReactFlowInstance<FlowNode, DiagramFlowEdge>["screenToFlowPosition"];
  readOnly: boolean;
  live: boolean;
  hideTip: () => void;
  hintSeen: boolean;
  dismissHint: () => void;
  setEditing: Dispatch<SetStateAction<InlineEdit | null>>;
  setMenu: Dispatch<SetStateAction<MenuState | null>>;
}) {
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
      setMenu(
        items.length
          ? {
              x: e.clientX,
              y: e.clientY,
              items: () => actionRegistry.build(full),
              get label() {
                return tr("menu.valueNodeValueEdgeValueGroupValueSelectionValueAnnotation", { target: ctx.target });
              },
            }
          : null,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state setters are stable; preserve CanvasView's original dependencies
    [editor, screenToFlowPosition, readOnly, live, hideTip, hintSeen, dismissHint],
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
    [editor, openMenu],
  );

  const openEdgeMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent, edgeId: string) => {
      editor.select({ edgeIds: [edgeId] });
      openMenu(e, { target: "edge", edgeId, selection: { ...EMPTY, edgeIds: [edgeId] } });
    },
    [editor, openMenu],
  );
  const onEdgeContextMenu: EdgeMouseHandler<DiagramFlowEdge> = useCallback(
    (e, edge) => openEdgeMenu(e, edge.id),
    [openEdgeMenu],
  );

  const onSelectionContextMenu = useCallback(
    (e: ReactMouseEvent) => openMenu(e, { target: "selection", selection: editor.getSelection() }),
    [openMenu, editor],
  );
  return { onPaneContextMenu, onNodeContextMenu, openEdgeMenu, onEdgeContextMenu, onSelectionContextMenu };
}
