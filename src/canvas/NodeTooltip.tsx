import { getStencil } from "../stencils/registry";

/** Screen-space tooltip for a canvas node: the full label (cards truncate) and what the stencil is. */
export interface NodeTip {
  rect: DOMRect;
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
