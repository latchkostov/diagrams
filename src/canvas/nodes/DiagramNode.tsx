import { memo, type CSSProperties } from "react";
import { Icon } from "../../components/Icon";
import { useLocale } from "../../i18n";
import { stencilLabel } from "../../i18n/stencils";
import { Handle, useStore, type NodeProps, type ReactFlowState } from "@xyflow/react";
import { FALLBACK_STENCIL, getStencil } from "../../stencils/registry";
import { getNodeVariant } from "../../harness/nodeVariants";
import { useSettings } from "../../harness/settings";
import { useDiagram } from "../DiagramContext";
import { SIDES, sidePosition } from "../edges/routing";
import type { DiagramFlowNode } from "../types";
import { useShowDependencies } from "../dependencyVisibility";
import { DependencyPips } from "./DependencyPips";
import { GrowChip } from "./GrowChip";

/**
 * The one selected thing, when it's a single node (only it shows a "+"); null otherwise. Worked out once per
 * store change and shared by every selected node, so selecting many nodes stays linear.
 */
let sole: { nodes: unknown; edges: unknown; id: string | null } = { nodes: null, edges: null, id: null };
function soleSelectedNode(s: ReactFlowState): string | null {
  if (s.nodes === sole.nodes && s.edges === sole.edges) return sole.id;
  let id: string | null = null;
  for (const x of s.nodes)
    if (x.selected) {
      if (id !== null) {
        id = null;
        break;
      }
      id = x.id;
    }
  if (id !== null && s.edges.some((e) => e.selected)) id = null;
  sole = { nodes: s.nodes, edges: s.edges, id };
  return id;
}
const never = () => false;

/**
 * React Flow wrapper: handles around whichever body variant is selected. A double-click names it in the inspector.
 * One handle per side, all `source` type: the canvas runs in loose connection mode, so a drag
 * can start or end on any side. Edges pick their sides from geometry (see edges/routing.ts).
 */
function DiagramNodeImpl({
  id,
  data,
  selected,
  dragging,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<DiagramFlowNode>) {
  useLocale();
  const { nodeVariant } = useSettings();
  const { rename, openDoc, grow, presenting } = useDiagram();
  const single = useStore(selected && grow ? (s: ReactFlowState) => soleSelectedNode(s) === id : never);
  const stencil = getStencil(data.stencil);
  const unknown = stencil === FALLBACK_STENCIL;
  const { Component } = getNodeVariant(nodeVariant);
  const showDeps = useShowDependencies();
  const hasDoc = Boolean(data.description?.trim());

  return (
    <div
      className={`dn dn-${nodeVariant}${hasDoc ? " has-doc" : ""}`}
      data-testid={`node-${id}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        rename?.({ kind: "node", id });
      }}
      style={{ "--accent": stencil.accent } as CSSProperties}
    >
      <Component
        stencil={stencil}
        stencilName={stencilLabel(stencil)}
        label={data.label}
        sublabel={data.sublabel}
        selected={selected && !presenting}
        unknown={unknown}
      />
      {hasDoc && (
        <span
          className="dn-doc-badge"
          data-testid={`doc-badge-${id}`}
          aria-hidden
          onClick={(e) => {
            if (!openDoc) return;
            e.stopPropagation();
            openDoc(id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon name="note" size={11} />
        </span>
      )}
      {SIDES.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={sidePosition[side]}
          className="dn-handle"
          data-testid={`handle-${id}-${side}`}
        />
      ))}
      {single && !dragging && <GrowChip id={id} x={positionAbsoluteX} y={positionAbsoluteY} />}
      {!showDeps && <DependencyPips id={id} />}
      {unknown && (
        <div className="dn-unknown" title={`Unknown stencil "${data.stencil}"`}>
          ? {data.stencil}
        </div>
      )}
    </div>
  );
}

export const DiagramNode = memo(DiagramNodeImpl);
