import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { clearPanes, intersect, intersects, placeTip, type Box } from "./placement";
import { fillTestId } from "./checks";
import type { Target } from "./types";

/**
 * The coach mark: a ring around where to click (dimming the rest unless the step says not to) and a short tip beside
 * it. Purely visual and never in the way: it takes no pointer events and no focus, and the step strip says the same
 * thing in words, for keyboards and screen readers. It follows its target as the page changes (a menu opening, the
 * canvas panning) through observers coalesced to one measurement per frame, and stops observing when it's hidden.
 */
interface Props {
  targets: readonly Target[];
  subjects: Record<string, string | undefined>;
  /** Connections between subjects, for edge test ids (RunnerSnapshot.edges). */
  edges?: Readonly<Record<string, string>>;
  selected: readonly string[];
}

interface Placed {
  testId: string;
  tip: string;
  dim: boolean;
  rect: Box;
  pane: Box;
  panes: Box[];
}
const PAD = 6;
const TIP_W = 220;
const find = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
const box = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};
const CHROME = ["tool-rail", "inspector", "live-controls", "live-note", "canvas-controls", "live-panel"];

function locate({ targets, subjects, edges, selected }: Props): Placed | null {
  const viewport = window.visualViewport;
  const top = find("tutorial-step")?.getBoundingClientRect().bottom ?? 0;
  const visual = {
    x: viewport?.offsetLeft ?? 0,
    y: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
  const pane = intersect(visual, {
    x: 0,
    y: top,
    width: window.innerWidth,
    height: Math.max(0, window.innerHeight - top),
  });
  const modal = document.querySelector('[aria-modal="true"]');
  // A field is more useful than its disclosure, which is more useful than a canvas subject.
  const priority = (t: Target) =>
    t.testId.startsWith("inspector-field-") ? 0 : t.testId.startsWith("inspector-section-") ? 1 : 2;
  for (const target of [...targets].sort((a, b) => priority(a) - priority(b))) {
    if (
      target.selected &&
      (!subjects[target.selected] || selected.length !== 1 || selected[0] !== subjects[target.selected])
    )
      continue;
    const testId = fillTestId(target.testId, subjects, edges);
    const el = testId && find(testId);
    if (!el || !el.checkVisibility() || (modal && !modal.contains(el))) continue;
    const rect = box(el);
    let visible = intersect(rect, pane);
    // checkVisibility does not account for scrolling or a clipped disclosure body.
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY))
        visible = intersect(visible, box(parent));
    }
    if (visible.width < 1 || visible.height < 1) continue;
    if (priority(target) < 2 && (visible.width < rect.width - 1 || visible.height < rect.height - 1)) continue;
    const obstacles = CHROME.flatMap((id) => {
      const chrome = find(id);
      return chrome?.checkVisibility() && !chrome.contains(el) ? [box(chrome)] : [];
    });
    if (obstacles.some((obstacle) => intersects(obstacle, visible))) continue;
    const owner = el.closest('[data-testid="inspector-body"]');
    const available = owner ? intersect(pane, box(owner)) : pane;
    return {
      testId: testId!,
      tip: target.tip(),
      dim: target.dim !== false,
      rect: visible,
      pane,
      panes: clearPanes(available, obstacles),
    };
  }
  return null;
}

export function Coachmark(props: Props) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, text: "" });
  const tip = useRef<HTMLDivElement>(null);
  const { targets, subjects, edges, selected } = props;
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = locate({ targets, subjects, edges, selected });
      setPlaced((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      const r = tip.current?.getBoundingClientRect();
      const text = tip.current?.textContent ?? "";
      if (r)
        setSize((current) =>
          current.width === r.width && current.height === r.height && current.text === text
            ? current
            : { width: r.width, height: r.height, text },
        );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "data-testid", "aria-expanded", "dir"],
    });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(document.documentElement);
    if (tip.current) sizes.observe(tip.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [targets, subjects, edges, selected]);
  const position =
    placed && size.text === placed.tip && size.width > 0 && size.height > 0
      ? placeTip(placed.rect, size, placed.panes, document.documentElement.dir === "rtl")
      : null;
  const stripHint = find("tutorial-target-hint");
  const maxWidth = Math.min(TIP_W, Math.max(0, ...(placed?.panes.map((p) => p.width - 16) ?? [TIP_W])));
  return (
    <>
      <div
        className="tutorial-coach"
        aria-hidden="true"
        data-testid="tutorial-coach"
        data-target={placed?.testId}
        style={{ clipPath: placed ? `inset(${Math.round(placed.pane.y)}px 0 0 0)` : undefined }}
      >
        {placed && (
          <div
            className={`tutorial-spot${placed.dim ? " is-dimming" : ""}`}
            data-testid="tutorial-spot"
            style={{
              left: placed.rect.x - PAD,
              top: placed.rect.y - PAD,
              width: placed.rect.width + PAD * 2,
              height: placed.rect.height + PAD * 2,
            }}
          />
        )}
        <div
          ref={tip}
          className={`tutorial-tip is-${position?.side ?? "right"}`}
          data-testid="tutorial-tip"
          style={{
            left: position?.x ?? 0,
            top: position?.y ?? 0,
            maxWidth,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {placed?.tip}
        </div>
      </div>
      {targets.length > 0 &&
        !position &&
        stripHint &&
        createPortal(
          <span className="tutorial-fallback" data-testid="tutorial-target-fallback" aria-hidden="true">
            {t("tutorials.targetUnavailable")}
          </span>,
          stripHint,
        )}
    </>
  );
}
