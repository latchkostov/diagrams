import { useLayoutEffect, useState } from "react";
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
  rect: { x: number; y: number; width: number; height: number };
  /** Where the step strip ends: the dim stays below it, so the words stay readable and dialogs cover both. */
  top: number;
}

const PAD = 6;
const TIP_W = 220;
const GAP = 14;

function locate({ targets, subjects, edges, selected }: Props): Placed | null {
  // A dialog over everything (Ctrl+K, Share) owns the screen: point at nothing under it.
  const modal = document.querySelector('[aria-modal="true"]');
  const top = document.querySelector('[data-testid="tutorial-step"]')?.getBoundingClientRect().bottom ?? 0;
  for (const target of targets) {
    if (target.selected) {
      const id = subjects[target.selected];
      if (!id || selected.length !== 1 || selected[0] !== id) continue;
    }
    const testId = fillTestId(target.testId, subjects, edges);
    if (!testId) continue;
    const el = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
    if (!el || !el.checkVisibility() || (modal && !modal.contains(el))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0) continue;
    if (r.top > window.innerHeight || r.left > window.innerWidth) continue;
    return {
      testId,
      tip: target.tip(),
      dim: target.dim !== false,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      top,
    };
  }
  return null;
}

const same = (a: Placed | null, b: Placed | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.testId === b.testId &&
    a.tip === b.tip &&
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.rect.x) === Math.round(b.rect.x) &&
    Math.round(a.rect.y) === Math.round(b.rect.y) &&
    Math.round(a.rect.width) === Math.round(b.rect.width) &&
    Math.round(a.rect.height) === Math.round(b.rect.height));

export function Coachmark(props: Props) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const { targets, subjects, edges, selected } = props;
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = locate({ targets, subjects, edges, selected });
      setPlaced((current) => (same(current, next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "data-testid", "aria-expanded"],
    });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [targets, subjects, edges, selected]);

  if (!placed) return null;
  const { rect } = placed;
  const rtl = document.documentElement.dir === "rtl";
  // Beside the target on its inline-end side when there's room, else the other side, else below it.
  const endRoom = rtl ? rect.x : window.innerWidth - (rect.x + rect.width);
  const startRoom = rtl ? window.innerWidth - (rect.x + rect.width) : rect.x;
  const side = endRoom >= TIP_W + GAP * 2 ? "end" : startRoom >= TIP_W + GAP * 2 ? "start" : "below";
  const right = (side === "end") !== rtl;
  // Physical coordinates: the rect is physical too. The tip sizes to its words, up to TIP_W.
  const tipStyle =
    side === "below"
      ? {
          left: Math.max(8 + TIP_W / 2, Math.min(window.innerWidth - TIP_W / 2 - 8, rect.x + rect.width / 2)),
          top: rect.y + rect.height + PAD + GAP,
        }
      : right
        ? { left: rect.x + rect.width + PAD + GAP, top: Math.max(8, rect.y + rect.height / 2 - 17) }
        : { right: window.innerWidth - rect.x + PAD + GAP, top: Math.max(8, rect.y + rect.height / 2 - 17) };
  return (
    <div
      className="tutorial-coach"
      aria-hidden="true"
      data-testid="tutorial-coach"
      data-target={placed.testId}
      style={{ clipPath: `inset(${Math.round(placed.top)}px 0 0 0)` }}
    >
      <div
        className={`tutorial-spot${placed.dim ? " is-dimming" : ""}`}
        data-testid="tutorial-spot"
        style={{
          left: rect.x - PAD,
          top: rect.y - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }}
      />
      <div
        className={`tutorial-tip is-${side === "below" ? "below" : right ? "right" : "left"}`}
        data-testid="tutorial-tip"
        style={{ ...tipStyle, maxWidth: TIP_W }}
      >
        {placed.tip}
      </div>
    </div>
  );
}
