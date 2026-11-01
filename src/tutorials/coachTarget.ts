import { intersect, intersects, type Box } from "./placement";
import { fillTestId } from "./checks";
import type { Target } from "./types";

export interface TargetProps {
  targets: readonly Target[];
  subjects: Record<string, string | undefined>;
  edges?: Readonly<Record<string, string>>;
  selected: readonly string[];
}
export interface Located {
  testId: string;
  tip: string;
  rect: Box;
}

/** A coach-owned action is ringed in place; a card cannot be anchored outside itself. */
export function externalCoachTarget(card: Element, target: Element | null, rect: Box | null): Box | null {
  return target && !card.contains(target) ? rect : null;
}

export const find = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
export const box = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};
export const CHROME = [
  "tool-rail",
  "inspector",
  "dock-snap-controls",
  "live-controls",
  "live-note",
  "canvas-controls",
  "live-panel",
  "sim-panel",
  "capacity-panel",
  "live-events",
  "tutorial-tools",
];

/** Resolve only visible, unclipped targets; a field wins over its containing disclosure. */
export function locate({ targets, subjects, edges, selected }: TargetProps): Located | null {
  const viewport = window.visualViewport;
  const top = 0;
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
    // A canvas gesture is context, not a control that a card can sit outside of.
    if (target.testId === "canvas-pane") continue;
    if (target.live !== undefined && (find("live-toggle")?.getAttribute("aria-pressed") === "true") !== target.live)
      continue;
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
    return {
      testId: testId!,
      tip: target.tip(),
      rect: visible,
    };
  }
  return null;
}

/** Coalesce camera/simulation updates to a frame. Paused-clock UI still lays out when chrome changes. */
export function observeCoach(card: HTMLElement | null, measure: () => void) {
  let frame = 0;
  const run = () => {
    frame = 0;
    measure();
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const immediate = () => {
    if (frame) cancelAnimationFrame(frame);
    run();
  };
  const chrome =
    '[role="menu"], [role="listbox"], [data-testid="live-note"], [data-testid="inspector"], [data-testid="palette"], [data-testid="toast"]';
  const mounts = `${chrome}, [data-testid="coach-card"], [data-testid="tutorial-handoff"]`;
  const mutations = new MutationObserver((records) => {
    const ui = records.some(
      (r) =>
        r.target instanceof Element &&
        (r.target.closest(chrome) ||
          [...(r.addedNodes ?? []), ...(r.removedNodes ?? [])].some(
            (n) => n instanceof Element && (n.matches(mounts) || n.querySelector(mounts)),
          )),
    );
    if (ui) immediate();
    else schedule();
  });
  mutations.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "class", "hidden", "data-testid", "aria-expanded", "dir"],
  });
  const sizes = new ResizeObserver((entries) => {
    if (card && entries.some((entry) => entry.target === card)) immediate();
    else schedule();
  });
  sizes.observe(document.documentElement);
  if (card) sizes.observe(card);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  immediate();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    mutations.disconnect();
    sizes.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
  };
}
