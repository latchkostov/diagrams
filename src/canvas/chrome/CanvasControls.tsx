import { useLayoutEffect, type RefObject } from "react";
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
import { t as tr } from "../../i18n";
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
  const undoTitle = tr("canvas.undoValue", { combo: formatCombo(shortcutKeys("undo")) });
  const redoTitle = tr("canvas.redoValue", { combo: formatCombo(shortcutKeys("redo")) });
  return (
    <Controls
      showInteractive={false}
      showFitView={false}
      position="bottom-left"
      onZoomIn={zoomedByButton}
      onZoomOut={zoomedByButton}
    >
      {/* Our fit keeps content clear of the title card, minimap and live bar. */}
      <ControlButton
        onClick={fit}
        title={tr("chrome.fitViewValue", { combo: formatCombo(shortcutKeys("fit-view")) })}
        aria-label={tr("menu.fitView")}
        data-testid="fit-view-button"
      >
        <Icon name="fit" size={14} />
      </ControlButton>
      <ControlButton
        onClick={editor.undo}
        disabled={!editor.canUndo()}
        title={undoTitle}
        aria-label={tr("ai.undo")}
        data-testid="undo-button"
      >
        <Icon name="undo" size={14} />
      </ControlButton>
      <ControlButton
        onClick={editor.redo}
        disabled={!editor.canRedo()}
        title={redoTitle}
        aria-label={tr("shortcuts.redo")}
        data-testid="redo-button"
      >
        <Icon name="redo" size={14} />
      </ControlButton>
      <ControlButton
        onClick={onShortcuts}
        title={tr("canvas.keyboardShortcuts")}
        aria-label={tr("shortcuts.title")}
        data-testid="shortcuts-button"
      >
        <Icon name="keyboard" size={14} />
      </ControlButton>
    </Controls>
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
