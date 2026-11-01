import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { CHROME, box, find, locate, observeCoach, externalCoachTarget } from "./coachTarget";
import { clearPanes, intersect, type Box } from "./placement";
import { keepCard, placeCard, placeHome, placeSheet, type CardPlace, type SheetPlace } from "./coachPlacement";
import type { Target } from "./types";
import "./coach.css";

/**
 * The anchored coach: the step's instruction is a compact card anchored to what the step asks
 * you to use. It sits beside the target on the side with the most clear room and points at it, follows it as the view
 * changes, and never dims the page: the target gets a quiet ring. Phones get a sheet on the edge away from the target.
 *
 * The card is ordinary page content (after the bar in the reading and Tab order), so it never takes focus by itself;
 * the step's words are announced by the lesson's live region, as before. Only the ring and the leader are decoration.
 */
interface Props {
  targets: readonly Target[];
  subjects: Record<string, string | undefined>;
  edges?: Readonly<Record<string, string>>;
  selected: readonly string[];
  /** Point at the step's target (false: a study before Show me, or no step). */
  anchored: boolean;
  /** Ring the target (Highlights, or Show me). */
  ring: boolean;
  /** The learner folded the card to its head. (A phone sheet folds its words by itself to keep off the target.) */
  collapsed: boolean;
  complete: boolean;
  /** The card's content, given the tip of the target it points at now (a route's next move). */
  onProgress(): void;
  children: (now: string | null) => ReactNode;
}

type Layout =
  | { mode: "card"; place: CardPlace; ring: Box | null; target: string | null }
  | { mode: "sheet"; sheet: SheetPlace; left: number; width: number; ring: Box | null; target: string | null };

const PAD = 5;
/** Targets may be anywhere, the bar included (Live's switch is there); only the card keeps below the bar. */
const PHONE = "(max-width: 600px)";
/** Open things the card must not sit on: menus, the Add flyout, popovers. */
const OPEN =
  '[role="menu"], [role="listbox"], [data-testid="palette"], [data-testid="palette-annotate-flyout"], [role="dialog"]:not([aria-modal="true"]), [data-testid^="node-detail-"], [data-testid^="edge-detail-"]';

export function CoachCard({
  targets,
  subjects,
  edges,
  selected,
  anchored,
  ring,
  collapsed,
  complete,
  onProgress,
  children,
}: Props) {
  const card = useRef<HTMLDivElement>(null);
  const previousTarget = useRef<string | null>(null);
  const aiming = useRef(false);
  const holding = useRef(false);
  const previous = useRef<Layout | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [completionHost, setCompletionHost] = useState<HTMLElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [compact, setCompact] = useState(false);
  const [now, setNow] = useState<string | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = card.current;
      if (!el) return;
      setCompletionHost(complete ? find("tutorial-completion-mount") : null);
      const words = el.querySelector<HTMLElement>(".tutorial-words");
      const actions = el.querySelector<HTMLElement>(".tutorial-actions");
      const margin = words ? parseFloat(getComputedStyle(words).marginBlockStart) || 0 : 0;
      const actionsMissing = actions ? Math.max(0, actions.scrollHeight - actions.offsetHeight) : 0;
      const head = el.offsetHeight - (words?.offsetHeight ?? 0) - margin + actionsMissing;
      const phone = window.matchMedia(PHONE).matches;
      const bar = Math.max(
        find("tutorial-bar")?.getBoundingClientRect().bottom ?? 0,
        find("tutorial-tools")?.getBoundingClientRect().bottom ?? 0,
      );
      const vv = window.visualViewport;
      const visual = {
        x: vv?.offsetLeft ?? 0,
        y: vv?.offsetTop ?? 0,
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      };
      const area = intersect(visual, {
        x: 0,
        y: bar,
        width: window.innerWidth,
        height: Math.max(0, window.innerHeight - bar),
      });
      // Translated action rows may wrap. Keep all actions in the available viewport and scroll only the words.
      const wordsBudget = Math.max(0, area.height - head - 24);
      el.style.setProperty("--coach-words-max", `${wordsBudget}px`);
      const wordsHeight = Math.min(words?.scrollHeight ?? 0, window.innerHeight * (phone ? 0.28 : 0.4), wordsBudget);
      const full = head + wordsHeight + (wordsHeight ? 6 : 0);
      const size = { width: el.offsetWidth, height: collapsed ? el.offsetHeight : full };
      const located = anchored && targets.length > 0 ? locate({ targets, subjects, edges, selected }) : null;
      const progress = located ? `${located.testId}:${located.tip}` : null;
      if (progress !== previousTarget.current) {
        previousTarget.current = progress;
        onProgress();
      }
      const target = located ? find(located.testId) : null;
      // Some lessons teach a button in this card (download a fixture, save a copy).
      // Ring it in place; anchoring the card to its own child creates a placement feedback loop.
      const external = externalCoachTarget(el, target, located?.rect ?? null);
      // Chrome holding the target still walls the card off: the card points into a bar, never sits on it.
      const hard = [
        ...CHROME.map(find),
        ...document.querySelectorAll<HTMLElement>(`${OPEN}, [data-testid^="grow-chip-"]`),
      ]
        .filter(
          (e): e is HTMLElement => !!e && e.checkVisibility() && !el.contains(e) && !(target && target.contains(e)),
        )
        .map(box);
      // A target on a node (its "+", a dot) keeps the card off the whole node: it's what the step is about.
      const owner = target?.parentElement?.closest<HTMLElement>(".react-flow__node");
      if (owner) hard.push(box(owner));
      const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].filter(
        (n) => n.checkVisibility() && n !== owner && !(target && (n.contains(target) || target.contains(n))),
      );
      const soft = nodes.map(box).filter((b) => b.width > 0 && intersect(b, area).width > 0);
      const labels = [...document.querySelectorAll<HTMLElement>('[data-testid^="edge-label-"]')]
        .filter((e) => e.checkVisibility())
        .map(box);
      const ringBox = located && ring ? located.rect : null;
      let next: Layout;
      let nextCompact = false;
      if (window.matchMedia(PHONE).matches) {
        const sheet = placeSheet(external, full, area, hard, head);
        next = {
          mode: "sheet",
          sheet,
          left: area.x + 8,
          width: area.width - 16,
          ring: ringBox,
          target: located?.testId ?? null,
        };
      } else {
        const panes = clearPanes(area, hard);
        const rtl = document.documentElement.dir === "rtl";
        const old = previous.current;
        const held =
          (aiming.current || holding.current) && old?.mode === "card"
            ? keepCard({ ...size, x: old.place.x, y: old.place.y }, external, area, hard, holding.current)
            : null;
        let place = held || (external && placeCard(external, size, panes, area, rtl, soft));
        if (external && !place) {
          place = placeCard(external, { ...size, height: head }, panes, area, rtl, soft);
          nextCompact = !!place;
        }
        place ||= placeHome(union(soft.map((b) => intersect(b, area))), size, panes, area, [...soft, ...labels]);
        next = { mode: "card", place, ring: ringBox, target: located?.testId ?? null };
      }
      previous.current = next;
      setLayout((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      setUnavailable(anchored && targets.length > 0 && !targets.some((t) => t.testId === "canvas-pane") && !located);
      setNow(located?.tip ?? null);
      setCompact(next.mode === "sheet" ? next.sheet.compact : nextCompact);
    };
    return observeCoach(card.current, measure);
  }, [targets, subjects, edges, selected, anchored, ring, collapsed, complete, onProgress]);

  const place = layout?.mode === "card" ? layout.place : null;
  const sheet = layout?.mode === "sheet" ? layout : null;
  const style = place
    ? { left: Math.round(place.x), top: Math.round(place.y) }
    : sheet
      ? {
          top: Math.round(sheet.sheet.y),
          left: Math.round(sheet.left),
          inlineSize: Math.floor(sheet.width),
          right: "auto",
        }
      : {};
  const stripHint = find("tutorial-target-hint");
  if (completionHost)
    return createPortal(
      <div className="coach-completion" ref={card}>
        {children(null)}
      </div>,
      completionHost,
    );
  return (
    <>
      <div className="coach-layer" aria-hidden="true" data-testid="tutorial-coach" data-target={layout?.target ?? ""}>
        {layout?.ring && (
          <div
            className="coach-ring"
            data-testid="tutorial-spot"
            style={{
              left: layout.ring.x - PAD,
              top: layout.ring.y - PAD,
              width: layout.ring.width + PAD * 2,
              height: layout.ring.height + PAD * 2,
            }}
          />
        )}
        {place?.leader && (
          <svg className="coach-leader" width="100%" height="100%">
            <line x1={place.leader.x1} y1={place.leader.y1} x2={place.leader.x2} y2={place.leader.y2} />
            <circle cx={place.leader.x2} cy={place.leader.y2} r={3} />
          </svg>
        )}
      </div>
      <div
        ref={card}
        onPointerEnter={() => {
          aiming.current = true;
          // Pointer movement precedes pointer-down: hold before a click can miss the moving help button.
          holding.current = true;
        }}
        onPointerLeave={() => {
          aiming.current = false;
          holding.current = false;
        }}
        onPointerDownCapture={() => {
          holding.current = true;
        }}
        onPointerUp={() => {
          holding.current = false;
        }}
        onPointerCancel={() => {
          holding.current = false;
        }}
        className={[
          "coach-card",
          sheet ? `is-sheet is-${sheet.sheet.edge}` : "is-card",
          place?.side ? `is-${place.side}` : "",
          collapsed ? "is-collapsed" : compact ? "is-compact" : "",
        ].join(" ")}
        data-testid="coach-card"
        data-tip-obstacle
        data-editor-overlay
        data-compact={compact}
        data-side={place?.side ?? sheet?.sheet.edge ?? "home"}
        style={{ ...style, visibility: layout ? "visible" : "hidden" }}
      >
        {children(now)}
        {place?.side && place.nub !== null && (
          <span
            className="coach-nub"
            aria-hidden="true"
            style={place.side === "left" || place.side === "right" ? { top: place.nub } : { left: place.nub }}
          />
        )}
      </div>
      {unavailable &&
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

function union(boxes: readonly Box[]): Box | null {
  const live = boxes.filter((b) => b.width > 0 && b.height > 0);
  if (!live.length) return null;
  const x = Math.min(...live.map((b) => b.x)),
    y = Math.min(...live.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...live.map((b) => b.x + b.width)) - x,
    height: Math.max(...live.map((b) => b.y + b.height)) - y,
  };
}
