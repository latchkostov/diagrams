import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "@xyflow/react";
import type { LiveState } from "./controller";
import { useLive } from "./context";
import { formatClock } from "./format";
import { LiveIcon } from "./icons";
import { NOTE_GAP, placeNote, type Box } from "./notePlacement";

/** Keep clear of the control bar at the bottom. */
const BOTTOM_RESERVE = 170;

/**
 * Narration from the simulation timeline. Anchored under (or over) the focused nodes in screen
 * space so it stays the same size whatever the zoom; the session dims everything else and pans to
 * the focus. A pausing note waits for Continue (or Space / Enter).
 */
export function NoteCallout({ state }: { state: LiveState }) {
  const ui = useLive();
  const note = state.run?.note;
  const waiting = !!state.run?.waiting;
  const transform = useStore((s) => s.transform);
  const paneWidth = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const lookup = useStore((s) => s.nodeLookup);
  const pane = useStore((s) => s.domNode);
  const ref = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ w: 420, h: 110 });
  const noteKey = note ? `${note.atMs}:${note.text}` : "";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((previous) =>
        Math.abs(r.width - previous.w) > 1 || Math.abs(r.height - previous.h) > 1
          ? { w: r.width, h: r.height }
          : previous,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [noteKey]);

  useLayoutEffect(() => {
    // A pausing presentation note moves keyboard focus to its explicit resume action.
    if (waiting && ui.presenting) continueRef.current?.focus();
  }, [noteKey, waiting, ui.presenting]);

  if (!note) return null;
  // The authoring panel covers the right side of the pane.
  const width = paneWidth - (ui.panelOpen ? 408 : 0);

  // Screen-space boxes of every node, and the bounding box of the focused ones.
  const [tx, ty, zoom] = transform;
  const focusIds = new Set(note.focus);
  const others: Box[] = [];
  const focused: Box[] = [];
  let box: Box | null = null;
  for (const n of lookup.values()) {
    if (n.type !== "diagram" || n.hidden) continue;
    const l = n.internals.positionAbsolute.x * zoom + tx;
    const t = n.internals.positionAbsolute.y * zoom + ty;
    const rect = { l, t, r: l + (n.measured.width ?? 0) * zoom, b: t + (n.measured.height ?? 0) * zoom };
    if (!focusIds.has(n.id)) {
      others.push(rect);
      continue;
    }
    focused.push(rect);
    box = box
      ? {
          l: Math.min(box.l, rect.l),
          t: Math.min(box.t, rect.t),
          r: Math.max(box.r, rect.r),
          b: Math.max(box.b, rect.b),
        }
      : rect;
  }

  let style: CSSProperties;
  let placement: "below" | "above" | "right" | "left" | "free" = "free";
  // Beside the focus, in the free space around it (covering as little of the diagram as it can).
  // The title card and the bottleneck callout float over the canvas too: keep clear of them like
  // the focused nodes (in presentation the title card is large).
  const keepClear = [...focused, ...overlayBoxes(pane)];
  const spot = box && placeNote(box, size, { width, height: height - BOTTOM_RESERVE }, others, keepClear);
  if (spot) {
    placement = spot.placement;
    const vertical = placement === "below" || placement === "above";
    style = {
      left: spot.left,
      top: spot.top,
      [vertical ? "--arrow" : "--arrow-y"]: `${spot.arrow}px`,
    } as CSSProperties;
  } else if (box) {
    const cx = (box.l + box.r) / 2;
    const left = Math.min(Math.max(16, cx - size.w / 2), Math.max(16, width - size.w - 16));
    placement = "below";
    const top = Math.min(box.b + NOTE_GAP, height - BOTTOM_RESERVE - size.h);
    const arrow = Math.min(Math.max(24, cx - left), size.w - 24);
    style = { left, top: Math.max(16, top), "--arrow": `${arrow}px` } as CSSProperties;
  } else {
    // No focus: a caption just above the control bar, clear of the title card.
    style = { left: Math.max(16, width / 2 - size.w / 2), top: height - BOTTOM_RESERVE + 70 - size.h };
  }

  return (
    <div
      ref={ref}
      key={`${note.atMs}:${note.text}`}
      className={`lv-note is-${placement}${waiting ? " is-waiting" : ""}${ui.presenting ? " is-presenting" : ""}`}
      style={style}
      role="status"
      aria-live="polite"
      data-testid="live-note"
      data-placement={placement}
      data-waiting={waiting ? "1" : undefined}
      data-editor-overlay
    >
      <div className="lv-note-head">
        <LiveIcon name="note" size={13} />
        <span>{state.simulation?.title ?? "Note"}</span>
        <span className="lv-note-time mono">{formatClock(note.atMs)}</span>
      </div>
      <p className="lv-note-text">{note.text}</p>
      {waiting && (
        <div className="lv-note-actions">
          <button
            ref={continueRef}
            className="lv-note-continue"
            onClick={() => ui.controller.resume()}
            data-testid="live-note-continue"
          >
            Continue <LiveIcon name="play" size={10} />
          </button>
          <span className="lv-note-hint">
            or press <kbd>Space</kbd>
          </span>
        </div>
      )}
    </div>
  );
}

/** Canvas overlays (title card, bottleneck callout, corner buttons) in pane coordinates. */
function overlayBoxes(pane: HTMLElement | null): Box[] {
  const wrap = pane?.parentElement;
  if (!pane || !wrap) return [];
  const origin = pane.getBoundingClientRect();
  const out: Box[] = [];
  // Plus the Live toggle and "Exit presentation" in the top-right corner.
  for (const el of wrap.querySelectorAll<HTMLElement>("[data-canvas-overlay], .lv-toggle, .present-exit")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    out.push({ l: r.left - origin.left, t: r.top - origin.top, r: r.right - origin.left, b: r.bottom - origin.top });
  }
  return out;
}
