import { getStencil } from "../stencils/registry";
import { NODE_TIP_ID } from "./useNodeTooltip";

/** Screen-space tooltip for a canvas node: the full label (cards truncate) and what the stencil is. */
export interface NodeTip {
  rect: DOMRect;
  /** The node it describes (aria-describedby). */
  nodeId?: string;
  label: string;
  sublabel?: string;
  stencil: string;
}

export function NodeTooltip({ tip }: { tip: NodeTip }) {
  const stencil = getStencil(tip.stencil);
  const above = tip.rect.top > 120;
  const style = {
    left: tip.rect.left + tip.rect.width / 2,
    top: above ? tip.rect.top - 8 : tip.rect.bottom + 8,
  };
  return (
    <div
      className={`node-tip${above ? " is-above" : " is-below"}`}
      style={style}
      id={NODE_TIP_ID}
      role="tooltip"
      data-testid="node-tooltip"
    >
      <strong>{tip.label}</strong>
      {tip.sublabel && <span className="node-tip-sub mono">{tip.sublabel}</span>}
      <span className="node-tip-kind">{stencil.label}</span>
      {stencil.description && <span className="node-tip-desc">{stencil.description}</span>}
    </div>
  );
}
