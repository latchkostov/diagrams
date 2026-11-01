import { surfaceCatalogs } from "../i18n/surfaces";
import { lazyComponent } from "../lib/lazyLoad";
import { stencilLabel } from "../i18n/stencils";
import { t, useLocale } from "../i18n";
import { getStencil } from "../stencils/registry";
import { useSyncExternalStore, useRef, useLayoutEffect, type RefObject } from "react";
import { MarkdownView } from "../components/markdown/lazy";
import { NODE_TIP_ID, useTipDescribes, type TipStore } from "./useNodeTooltip";
import type { Stencil } from "../model/types";
import { placeNodeTip } from "./nodeTipPlacement";

/** Descriptions are display text in the stencils catalog: their code arrives with it, when a tip first opens. */
let describe: ((s: Stencil) => string) | undefined;

/** Screen-space tooltip for a canvas node: the full label (cards truncate) and what the stencil is. */
export interface NodeTip {
  rect: DOMRect;
  /** Follow the actual node through fit-view, zoom and layout changes while the tip is open. */
  anchor?: Element;
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
    let obstacles = [...document.querySelectorAll("[data-tip-obstacle]")];
    const pane = tip.anchor?.closest('[data-testid="canvas-wrap"]');
    const position = () => {
      const { width, height } = el.getBoundingClientRect();
      const target = tip.anchor?.isConnected ? tip.anchor.getBoundingClientRect() : tip.rect;
      const area = pane?.getBoundingClientRect() ?? {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const blocked = obstacles.map((node) => node.getBoundingClientRect()).filter((r) => r.width && r.height);
      const place = placeNodeTip(target, { width, height }, area, blocked);
      el.style.visibility = place ? "" : "hidden";
      if (place) {
        el.style.left = `${place.x}px`;
        el.style.top = `${place.y}px`;
      }
    };
    let frame = 0;
    const moving = new Set<Element>();
    const update = () => {
      frame = 0;
      position();
      if (moving.size) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const relevant = (node: Node) =>
      node instanceof Element &&
      node !== el &&
      !el.contains(node) &&
      [tip.anchor, pane, ...obstacles].some((target) => target && (node.contains(target) || target.contains(node)));
    const sizes = new ResizeObserver(schedule);
    const observeSizes = () => {
      sizes.disconnect();
      for (const target of [el, tip.anchor, pane, ...obstacles]) if (target) sizes.observe(target);
    };
    const mutations = new MutationObserver((records) => {
      const next = [...document.querySelectorAll("[data-tip-obstacle]")];
      const changed = next.length !== obstacles.length || next.some((node, i) => node !== obstacles[i]);
      if (changed || records.some((record) => relevant(record.target))) {
        obstacles = next;
        if (changed) observeSizes();
        schedule();
      }
    });
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "dir", "data-tip-obstacle"],
    });
    const movement = (event: Event) => {
      if (!(event.target instanceof Element) || !relevant(event.target)) return;
      if (event.type === "transitionrun" || event.type === "animationstart") moving.add(event.target);
      else moving.delete(event.target);
      schedule();
    };
    const events = [
      "transitionrun",
      "transitionend",
      "transitioncancel",
      "animationstart",
      "animationend",
      "animationcancel",
    ];
    for (const event of events) document.addEventListener(event, movement, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    observeSizes();
    update();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      for (const event of events) document.removeEventListener(event, movement, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
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
        stencil.description && describe && <span className="node-tip-desc">{describe(stencil)}</span>
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
    const [descriptions] = await Promise.all([import("../i18n/stencilDescriptions"), surfaceCatalogs(["stencils"])]);
    describe = descriptions.stencilDescription;
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
