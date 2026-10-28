import { surfaceCatalogs } from "../i18n/surfaces";
import { lazyComponent } from "../lib/lazyLoad";
import { stencilLabel, stencilDescription } from "../i18n/stencils";
import { t, useLocale } from "../i18n";
import { getStencil } from "../stencils/registry";
import { useSyncExternalStore, useRef, useLayoutEffect, type RefObject } from "react";
import { MarkdownView } from "../components/markdown/lazy";
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

export function NodeTooltip({ tip, loading = false }: { tip: NodeTip; loading?: boolean }) {
  useLocale();
  const stencil = getStencil(tip.stencil);
  const hasDoc = Boolean(tip.description?.trim());
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const position = () => {
      const pad = 8;
      const { width, height } = el.getBoundingClientRect();
      const aboveSpace = tip.rect.top - pad * 2;
      const belowSpace = window.innerHeight - tip.rect.bottom - pad * 2;
      const above = aboveSpace >= height || (belowSpace < height && aboveSpace > belowSpace);
      const top = above ? tip.rect.top - pad - height : tip.rect.bottom + pad;
      el.style.left = `${Math.max(pad, Math.min(tip.rect.left + tip.rect.width / 2 - width / 2, window.innerWidth - width - pad))}px`;
      el.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - height - pad))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(el);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [tip]);
  return (
    <div
      ref={ref}
      className={`node-tip${hasDoc ? " has-doc" : ""}`}
      id={NODE_TIP_ID}
      role="tooltip"
      data-testid="node-tooltip"
    >
      <div className="node-tip-header">
        <span className="node-tip-icon" aria-hidden>
          ▤
        </span>
        <span>
          <strong>{tip.label}</strong>
          <span className="node-tip-kind">{stencilLabel(stencil)}</span>
        </span>
        <small>{t("hover.editing")}</small>
      </div>
      {tip.sublabel && <span className="node-tip-sub mono">{tip.sublabel}</span>}
      {loading ? (
        <span className="node-tip-desc" role="status" data-testid="node-tooltip-loading">
          {t("common.loading")}
        </span>
      ) : (
        stencil.description && <span className="node-tip-desc">{stencilDescription(stencil)}</span>
      )}
      {hasDoc && (
        <div className="node-tip-doc" data-testid="node-tooltip-doc">
          <MarkdownView text={tip.description!} className="node-tip-md" />
        </div>
      )}
    </div>
  );
}

const TranslatedNodeTooltip = lazyComponent(
  async () => {
    await surfaceCatalogs(["stencils"]);
    return NodeTooltip;
  },
  (props) => <NodeTooltip {...props} loading />,
  true,
);

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
  return tip && !covered ? <TranslatedNodeTooltip tip={tip} /> : null;
}
