import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  useStore,
  type ReactFlowState,
} from "@xyflow/react";
import { Icon } from "../../components/Icon";
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
 * any zoom (the handles' hit areas, the inline editors). Rounded down to a step, so what's scaled by
 * 1/zoom is never short of its size. Re-renders only itself, and only when the zoom moves a step.
 */
export function ZoomVar({ host }: { host: RefObject<HTMLElement | null> }) {
  const zoom = useStore((s: ReactFlowState) => Math.max(0.02, Math.floor(s.transform[2] * 50 + 1e-6) / 50));
  useLayoutEffect(() => void host.current?.style.setProperty("--rf-zoom", String(zoom)), [host, zoom]);
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
  canUndo,
  canRedo,
}: {
  editor: EditorApi;
  fit: () => void;
  zoomedByButton: () => void;
  menus: CanvasMenus;
  menu: MenuState | null;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const locale = useLocale();
  const bodyRef = useRef<HTMLDivElement>(null);
  // Deliberately session-only: each new canvas starts expanded; no preference is stored.
  const [collapsed, setCollapsed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const menuOpen = menu?.menuId === menuId;

  // Controls does not forward button props. Retag its zoom buttons after expansion remounts them.
  useLayoutEffect(() => {
    const root = bodyRef.current?.parentElement;
    for (const [selector, testId, label] of [
      [".react-flow__controls-zoomin", "zoom-in-button", tr("chrome.zoomIn")],
      [".react-flow__controls-zoomout", "zoom-out-button", tr("chrome.zoomOut")],
    ] as const) {
      const button = root?.querySelector(selector);
      button?.setAttribute("data-testid", testId);
      button?.setAttribute("title", label);
      button?.setAttribute("aria-label", label);
    }
  }, [collapsed, locale]);

  const openViewMenu = (via: "pointer" | "keyboard") => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    menus.openMenu(
      "context",
      { ...toolbarViewMenu(editor), x: r.right + 6, y: r.top, triggerRef, menuId },
      { via, platform: platform(), invoker: triggerRef.current },
    );
  };

  const collapseLabel = collapsed ? tr("chrome.expandToolbar") : tr("chrome.collapseToolbar");
  const viewMenuLabel = tr("view.menu");

  return (
    <>
      <Controls
        className={collapsed ? "is-collapsed" : undefined}
        showZoom={!collapsed}
        showInteractive={false}
        showFitView={false}
        position="bottom-left"
        onZoomIn={zoomedByButton}
        onZoomOut={zoomedByButton}
      >
        <div ref={bodyRef} className="rf-ctrl-body" inert={collapsed || undefined}>
          <div className="rf-ctrl-inner">
            {/* Our fit keeps content clear of the title card, minimap and live bar; flyout offers Zoom tools. */}
            <div
              className="rf-ctrl-split"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openViewMenu("pointer");
              }}
            >
              <ControlButton
                onClick={() => {
                  menus.closeMenu("command");
                  fit();
                }}
                title={tr("chrome.fitViewValue", { combo: formatCombo(shortcutKeys("fit-view")) })}
                aria-label={tr("menu.fitView")}
                data-testid="fit-view-button"
              >
                <Icon name="fit" size={14} />
              </ControlButton>
              <button
                ref={triggerRef}
                type="button"
                className={`rf-ctrl-flyout${menuOpen ? " is-open" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (menuOpen) menus.closeMenu("toggle");
                  else openViewMenu(e.detail === 0 ? "keyboard" : "pointer");
                }}
                title={viewMenuLabel}
                aria-label={viewMenuLabel}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                data-testid="view-tools-menu-button"
              >
                <svg width="6" height="6" viewBox="0 0 6 6" aria-hidden>
                  <path d="M6 0v6H0Z" fill="currentColor" />
                </svg>
              </button>
            </div>
            <div className="rf-ctrl-sep" role="separator" data-testid="toolbar-divider-history" />
            <ControlButton
              onClick={editor.undo}
              disabled={!canUndo}
              title={tr("canvas.undoValue", { combo: formatCombo(shortcutKeys("undo")) })}
              aria-label={tr("ai.undo")}
              data-testid="undo-button"
            >
              <Icon name="undo" size={14} />
            </ControlButton>
            <ControlButton
              onClick={editor.redo}
              disabled={!canRedo}
              title={tr("canvas.redoValue", { combo: formatCombo(shortcutKeys("redo")) })}
              aria-label={tr("shortcuts.redo")}
              data-testid="redo-button"
            >
              <Icon name="redo" size={14} />
            </ControlButton>
            <div className="rf-ctrl-sep" role="separator" data-testid="toolbar-divider-collapse" />
          </div>
        </div>
        <ControlButton
          onClick={() => {
            menus.closeMenu("command");
            setCollapsed((c) => !c);
          }}
          title={collapseLabel}
          aria-label={collapseLabel}
          aria-expanded={!collapsed}
          data-testid="collapse-toolbar-button"
        >
          <Icon name={collapsed ? "chevrons-right" : "chevrons-left"} size={14} />
        </ControlButton>
      </Controls>
    </>
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
