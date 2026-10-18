import { stencilLabel, stencilDescription } from "../i18n/stencils";
import { useLocale } from "../i18n";
import { getStencil } from "../stencils/registry";
import { useSyncExternalStore, type RefObject } from "react";
import { MarkdownView } from "../components/markdown";
import { NODE_TIP_ID, useTipDescribes, type TipStore } from "./useNodeTooltip";

/** Screen-space tooltip for a canvas node: the full label (cards truncate) and what the stencil is. */
export interface NodeTip {
  rect: DOMRect;
  /** The node it describes (aria-describedby). */
  nodeId?: string;
  label: string;
  sublabel?: string;
  stencil: string;
  description?: string;
}

export function NodeTooltip({ tip }: { tip: NodeTip }) {
  useLocale();
  const stencil = getStencil(tip.stencil);
  const above = tip.rect.top > 120;
  const hasDoc = Boolean(tip.description?.trim());
  const style = {
    left: tip.rect.left + tip.rect.width / 2,
    top: above ? tip.rect.top - 8 : tip.rect.bottom + 8,
  };
  return (
    <div
      className={`node-tip${above ? " is-above" : " is-below"}${hasDoc ? " has-doc" : ""}`}
      style={style}
      id={NODE_TIP_ID}
      role="tooltip"
      data-testid="node-tooltip"
    >
      <strong>{tip.label}</strong>
      {tip.sublabel && <span className="node-tip-sub mono">{tip.sublabel}</span>}
      <span className="node-tip-kind">{stencilLabel(stencil)}</span>
      {stencil.description && <span className="node-tip-desc">{stencilDescription(stencil)}</span>}
      {hasDoc && (
        <div className="node-tip-doc" data-testid="node-tooltip-doc">
          <MarkdownView text={tip.description!} className="node-tip-md" />
        </div>
      )}
    </div>
  );
}

/**
 * Draws the tip in `tips` (useNodeTooltip) while `enabled`, and names it as the node's description. Its own component,
 * subscribed to the tip alone: hovering a node renders this, not the canvas.
 */
export function NodeTipLayer({
  tips,
  enabled,
  covered,
  root,
}: {
  tips: TipStore;
  enabled: boolean;
  /** A menu is open: the tip isn't drawn (the node stays described by it). */
  covered: boolean;
  root: RefObject<HTMLElement | null>;
}) {
  const shown = useSyncExternalStore(tips.subscribe, tips.get);
  const tip = enabled ? shown : null;
  useTipDescribes(root, tip?.nodeId);
  return tip && !covered ? <NodeTooltip tip={tip} /> : null;
}
