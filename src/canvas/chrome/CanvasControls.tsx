import { frameView } from "../detail";
import { useSyncExternalStore, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Background, BackgroundVariant, ControlButton, MiniMap, useStore, type ReactFlowState } from "@xyflow/react";
import { useCameraController } from "../camera/useCameraCore";
import { Icon } from "../../components/Icon";
import { HistoryButtons } from "../../components/ModeSwitch";
import type { EditorApi } from "../../editor/types";
import { formatCombo, shortcutKeys } from "../../editor/shortcuts";
import { getStencil } from "../../stencils/registry";
import { t as tr, useLocale } from "../../i18n";
import { platform, toolbarViewMenu, type CanvasMenus, type MenuState } from "../menus/useCanvasMenus";
import { resolveAnnotationColor } from "../annotations";
import { resolveGroupTone } from "../groupTones";
import type { AnnotationFlowNode, DiagramFlowNode, FlowNode, GroupFlowNode } from "../types";

/** The minimap draws every node again when one of these changes identity (see SNAP_GRID). */
const MINIMAP_STYLE = { width: 168, height: 112 };
const minimapFill = (n: FlowNode) =>
  n.type === "boundary"
    ? "transparent"
    : n.type === "annotation"
      ? annotationMinimapFill(n as AnnotationFlowNode)
      : getStencil((n as DiagramFlowNode).data.stencil).accent;
const minimapStroke = (n: FlowNode) =>
  n.type === "boundary"
    ? resolveGroupTone((n as GroupFlowNode).data.tone)
    : n.type === "annotation" && (n as AnnotationFlowNode).data.kind !== "note"
      ? resolveAnnotationColor((n as AnnotationFlowNode).data.color, (n as AnnotationFlowNode).data.kind).hex
      : "transparent";

/**
 * The view's zoom as a CSS variable on the canvas (`--rf-zoom`), for sizes that must hold on screen at
 * any zoom. Drawing styles retain their rounded-down step; gesture targets use
 * the exact scale. This component alone subscribes; panning never changes the scale.
 */
export function ZoomVar({ host }: { host: RefObject<HTMLElement | null> }) {
  const zoom = useStore((s: ReactFlowState) => Math.max(0.02, s.transform[2]));
  useLayoutEffect(() => {
    host.current?.style.setProperty("--rf-zoom", String(Math.max(0.02, Math.floor(zoom * 50 + 1e-6) / 50)));
    host.current?.style.setProperty("--rf-zoom-exact", String(zoom));
  }, [host, zoom]);
  return null;
}

/**
 * The dot grid: a dot every 10 px from 100% zoom up and every 20 px below, so the dots and the snap agree
 * where they can be told apart. Re-renders only when the zoom crosses 100%.
 */
export function DotGrid() {
  const fine = useStore((s: ReactFlowState) => s.transform[2] >= 1);
  return <Background variant={BackgroundVariant.Dots} gap={fine ? 10 : 20} size={1.3} color="var(--dot)" />;
}

/** Minimap: notes show their tint; zones, text and shapes are outlines. */
function annotationMinimapFill(n: AnnotationFlowNode): string {
  return n.data.kind === "note" ? resolveAnnotationColor(n.data.color, n.data.kind).hex : "transparent";
}

export function CanvasControls({
  editor,
  fit,
  zoomedByButton,
  menus,
  menu,
  history = false,
}: {
  editor: EditorApi;
  fit: () => void;
  zoomedByButton: () => void;
  menus: CanvasMenus;
  menu: MenuState | null;
  history?: boolean;
}) {
  useLocale();
  const camera = useCameraController();
  const view = useSyncExternalStore(camera?.subscribe ?? (() => () => {}), () => camera?.state.view ?? "overview");
  const displayedView = useStore((s) =>
    frameView(
      view,
      s.nodes.filter((n) => n.selected).length,
      s.nodes.some((n) => n.selected && n.type === "diagram") &&
        [...s.nodeLookup.values()].some(
          (n) =>
            n.type === "diagram" &&
            !n.hidden &&
            (n.internals.positionAbsolute.x * s.transform[2] + s.transform[0] < 0 ||
              n.internals.positionAbsolute.x * s.transform[2] +
                s.transform[0] +
                (n.measured.width ?? 0) * s.transform[2] >
                s.width ||
              n.internals.positionAbsolute.y * s.transform[2] + s.transform[1] < 0 ||
              n.internals.positionAbsolute.y * s.transform[2] +
                s.transform[1] +
                (n.measured.height ?? 0) * s.transform[2] >
                s.height),
        ),
    ),
  );
  const zoom = useStore((s) => s.transform[2]);
  const [collapsed, setCollapsed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const menuOpen = menu?.menuId === menuId;
  const openViewMenu = (via: "pointer" | "keyboard") => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    menus.openMenu(
      "context",
      { ...toolbarViewMenu(editor), x: r.left, y: r.top - 8, above: true, triggerRef, menuId },
      { via, platform: platform(), invoker: triggerRef.current },
    );
  };

  const collapseLabel = collapsed ? tr("chrome.expandToolbar") : tr("chrome.collapseToolbar");
  const viewMenuLabel = tr("view.menu");

  return (
    <div
      className={`workbench-view-controls react-flow__panel react-flow__controls${collapsed ? " is-collapsed" : ""}`}
      data-testid="canvas-controls"
    >
      {!collapsed && (
        <>
          {history && <HistoryButtons />}
          <button
            type="button"
            data-testid="fit-view-button"
            aria-pressed={displayedView === "overview"}
            title={tr("chrome.fitViewValue", { combo: formatCombo(shortcutKeys("fit-view")) })}
            onClick={fit}
          >
            <span data-testid="view-overview">{tr("camera.overview")}</span>
          </button>
          <button
            type="button"
            data-testid="view-focus"
            aria-pressed={displayedView === "focus"}
            onClick={() => camera?.dispatch({ type: "view.requested", view: "focus" })}
          >
            {tr("camera.focus")}
          </button>
          <button
            type="button"
            data-testid="zoom-out-button"
            aria-label={tr("chrome.zoomOut")}
            onClick={() => {
              zoomedByButton();
              camera?.dispatch({ type: "zoom.step", direction: -1 });
            }}
          >
            −
          </button>
          <button
            type="button"
            data-testid="zoom-100"
            title={tr("shortcuts.zoom100")}
            onClick={() => camera?.dispatch({ type: "zoom100" })}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            data-testid="zoom-in-button"
            aria-label={tr("chrome.zoomIn")}
            onClick={() => {
              zoomedByButton();
              camera?.dispatch({ type: "zoom.step", direction: 1 });
            }}
          >
            +
          </button>
          <button
            ref={triggerRef}
            type="button"
            data-testid="view-tools-menu-button"
            aria-label={viewMenuLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={(e) =>
              menuOpen ? menus.closeMenu("toggle") : openViewMenu(e.detail === 0 ? "keyboard" : "pointer")
            }
          >
            <Icon name="chevron-down" size={12} />
          </button>
        </>
      )}
      <ControlButton
        data-testid="collapse-toolbar-button"
        title={collapseLabel}
        aria-label={collapseLabel}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <Icon name={collapsed ? "chevrons-right" : "chevrons-left"} size={12} />
      </ControlButton>
    </div>
  );
}

export function CanvasMinimap() {
  return (
    <MiniMap
      position="bottom-right"
      style={MINIMAP_STYLE}
      pannable
      zoomable
      nodeBorderRadius={6}
      nodeStrokeWidth={2}
      nodeColor={minimapFill}
      nodeStrokeColor={minimapStroke}
    />
  );
}
