import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  useStore,
  type ReactFlowState,
} from "@xyflow/react";
import { ContextMenu } from "../../components/ContextMenu";
import { Icon } from "../../components/Icon";
import type { MenuNode } from "../../editor/actions";
import type { EditorApi } from "../../editor/types";
import { formatCombo, shortcutKeys } from "../../editor/shortcuts";
import { getStencil } from "../../stencils/registry";
import { t as tr, useLocale } from "../../i18n";
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
  onShortcuts,
}: {
  editor: EditorApi;
  fit: () => void;
  zoomedByButton: () => void;
  onShortcuts: () => void;
}) {
  const locale = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const viewGroupRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const menuOpen = menuPos !== null;

  const openViewMenu = () => {
    const r = viewGroupRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ x: r.right + 6, y: r.top });
  };

  const viewMenuItems = useMemo((): MenuNode[] => {
    if (!menuOpen) return [];
    const sel = editor.getSelection();
    const hasSelection = sel.nodeIds.length + sel.groupIds.length + sel.edgeIds.length > 0;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when menu opens or locale changes
  }, [menuOpen, editor, locale]);

  const collapseLabel = collapsed ? tr("chrome.expandToolbar") : tr("chrome.collapseToolbar");
  const viewMenuLabel = tr("view.menu");

  return (
    <>
      <Controls
        className={collapsed ? "is-collapsed" : undefined}
        showInteractive={false}
        showFitView={false}
        position="bottom-left"
        onZoomIn={zoomedByButton}
        onZoomOut={zoomedByButton}
      >
        <div className="rf-ctrl-body" inert={collapsed || undefined}>
          <div className="rf-ctrl-inner">
            {/* Our fit keeps content clear of the title card, minimap and live bar; flyout offers Zoom tools. */}
            <div
              ref={viewGroupRef}
              className="rf-ctrl-split"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openViewMenu();
              }}
            >
              <ControlButton
                onClick={fit}
                title={tr("chrome.fitViewValue", { combo: formatCombo(shortcutKeys("fit-view")) })}
                aria-label={tr("menu.fitView")}
                data-testid="fit-view-button"
              >
                <Icon name="fit" size={14} />
              </ControlButton>
              <button
                type="button"
                className={`rf-ctrl-flyout${menuOpen ? " is-open" : ""}`}
                onClick={(e: ReactMouseEvent) => {
                  e.stopPropagation();
                  if (menuOpen) setMenuPos(null);
                  else openViewMenu();
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
              disabled={!editor.canUndo()}
              title={tr("canvas.undoValue", { combo: formatCombo(shortcutKeys("undo")) })}
              aria-label={tr("ai.undo")}
              data-testid="undo-button"
            >
              <Icon name="undo" size={14} />
            </ControlButton>
            <ControlButton
              onClick={editor.redo}
              disabled={!editor.canRedo()}
              title={tr("canvas.redoValue", { combo: formatCombo(shortcutKeys("redo")) })}
              aria-label={tr("shortcuts.redo")}
              data-testid="redo-button"
            >
              <Icon name="redo" size={14} />
            </ControlButton>
            <div className="rf-ctrl-sep" role="separator" data-testid="toolbar-divider-shortcuts" />
            <ControlButton
              onClick={onShortcuts}
              title={tr("canvas.keyboardShortcuts")}
              aria-label={tr("shortcuts.title")}
              data-testid="shortcuts-button"
            >
              <Icon name="keyboard" size={14} />
            </ControlButton>
            <div className="rf-ctrl-sep" role="separator" data-testid="toolbar-divider-collapse" />
          </div>
        </div>
        <ControlButton
          onClick={() => {
            setMenuPos(null);
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
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          label={viewMenuLabel}
          testId="view-tools-menu"
          menuId={menuId}
          triggerRef={viewGroupRef}
          items={viewMenuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
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
