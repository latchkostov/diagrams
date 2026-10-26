import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  type RefObject,
} from "react";
import type { EdgeMouseHandler, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import { actionRegistry, type ActionContext, type MenuNode } from "../../editor/actions";
import type { EditorApi, Selection } from "../../editor/types";
import { t as tr, type useLocale } from "../../i18n";
import { isMac, shortcutKeys } from "../../editor/shortcuts";
import type { InteractionController } from "../interaction";
import type { ConnectedMenuAnchor } from "../geometry/connectedMenuPlacement";
import type { InlineEdit } from "../DiagramContext";
import { menuTargets } from "./menuTargets";
import { isAnnotationNode, isGroupNode, type DiagramFlowEdge, type FlowNode } from "../types";

const EMPTY: Selection = { nodeIds: [], edgeIds: [], groupIds: [] };

export type MenuState = {
  menuId?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  connected?: ConnectedMenuAnchor;
  x: number;
  y: number;
  flipX?: number;
  above?: boolean;
  items: () => MenuNode[];
  alignment?: "physical-left";
  label: string;
  searchable?: string;
  testId?: string;
  /** The items a node, connection or selection menu acts on (flow ids): a peer deleting one closes it (`remote`). */
  targets?: readonly string[];
};
/** The toolbar uses the same menu and camera command paths as the canvas and keyboard. */
export function toolbarViewMenu(editor: EditorApi): Omit<MenuState, "x" | "y"> {
  return {
    get label() {
      return tr("view.menu");
    },
    testId: "view-tools-menu",
    items: () => {
      const selection = editor.getSelection();
      const hasSelection = selection.nodeIds.length + selection.groupIds.length + selection.edgeIds.length > 0;
      return [
        {
          type: "item",
          id: "toolbar-view:zoom-100",
          label: tr("shortcuts.zoom100"),
          icon: "zoom",
          shortcut: shortcutKeys("zoom-100"),
          run: () => editor.zoomTo100(),
        },
        {
          type: "item",
          id: "toolbar-view:zoom-selection",
          label: tr("shortcuts.zoomSelection"),
          icon: "zoom",
          shortcut: shortcutKeys("zoom-selection"),
          disabled: !hasSelection,
          title: hasSelection ? undefined : tr("menu.selectSomethingFirst"),
          run: () => void editor.zoomToSelection(),
        },
      ];
    },
  };
}

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
    (
      e: Pick<MouseEvent, "preventDefault" | "clientX" | "clientY">,
      ctx: Omit<ActionContext, "editor" | "point">,
      via: "pointer" | "keyboard" = "pointer",
    ) => {
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
          targets: menuTargets(ctx),
          get label() {
            return tr("menu.valueNodeValueEdgeValueGroupValueSelectionValueAnnotation", { target: ctx.target });
          },
        },
        { via, platform: platform() },
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
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
      const target = e.target;
      if (
        !(target instanceof Element) ||
        !target.closest('[data-testid="canvas-wrap"]') ||
        !target.matches(".react-flow__node, .react-flow__edge")
      )
        return;
      const id = target.getAttribute("data-id");
      if (!id || readOnly) return;
      let selection = editor.getSelection();
      const groupId = id.startsWith("group:") ? id.slice("group:".length) : undefined;
      const selected =
        selection.nodeIds.includes(id) ||
        selection.edgeIds.includes(id) ||
        (!!groupId && selection.groupIds.includes(groupId));
      const multiple = selected && selection.nodeIds.length + selection.edgeIds.length + selection.groupIds.length > 1;
      const ctx: Omit<ActionContext, "editor" | "point"> | undefined = editor.getNode(id)
        ? { target: "node", nodeId: id, selection }
        : editor.getEdge(id)
          ? { target: "edge", edgeId: id, selection }
          : editor.getAnnotation(id)
            ? { target: "annotation", nodeId: id, selection }
            : groupId && editor.getGroup(groupId)
              ? { target: "group", groupId, selection }
              : undefined;
      if (!ctx) return;
      if (multiple) ctx.target = "selection";
      else {
        menus.selecting("keyboard");
        selection = {
          ...EMPTY,
          ...(ctx.target === "edge"
            ? { edgeIds: [id] }
            : ctx.target === "group"
              ? { groupIds: [groupId!] }
              : { nodeIds: [id] }),
        };
        editor.select(selection);
        ctx.selection = selection;
      }
      e.preventDefault();
      e.stopPropagation();
      const box = target.getBoundingClientRect();
      openMenu(
        { preventDefault: () => {}, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 },
        ctx,
        "keyboard",
      );
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [editor, openMenu, readOnly, menus]);
  return [onPaneContextMenu, onNodeContextMenu, openEdgeMenu, onEdgeContextMenu, onSelectionContextMenu] as const;
}
