import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "@xyflow/react";
import type { LiveState } from "./controller";
import { useLive } from "./context";
import { formatClock } from "./format";
import { LiveIcon } from "./icons";

// Clears the metric pill under the focused nodes.
const GAP = 48;
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
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 420, h: 110 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) setSize({ w: r.width, h: r.height });
  });

  if (!note) return null;
  // The authoring panel covers the right side of the pane.
  const width = paneWidth - (ui.panelOpen ? 408 : 0);

  // Screen-space bounding box of the focused nodes.
  const [tx, ty, zoom] = transform;
  let box: { l: number; t: number; r: number; b: number } | null = null;
  for (const id of note.focus) {
    const n = lookup.get(id);
    if (!n) continue;
    const l = n.internals.positionAbsolute.x * zoom + tx;
    const t = n.internals.positionAbsolute.y * zoom + ty;
    const r = l + (n.measured.width ?? 0) * zoom;
    const b = t + (n.measured.height ?? 0) * zoom;
    box = box ? { l: Math.min(box.l, l), t: Math.min(box.t, t), r: Math.max(box.r, r), b: Math.max(box.b, b) } : { l, t, r, b };
  }

  let style: CSSProperties;
  let placement: "below" | "above" | "free" = "free";
  if (box) {
    const cx = (box.l + box.r) / 2;
    const left = Math.min(Math.max(16, cx - size.w / 2), Math.max(16, width - size.w - 16));
    const below = box.b + GAP + size.h < height - BOTTOM_RESERVE;
    placement = below ? "below" : box.t - GAP - size.h > 16 ? "above" : "below";
    const top = placement === "below" ? Math.min(box.b + GAP, height - BOTTOM_RESERVE - size.h) : box.t - GAP - size.h;
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
          <button className="lv-note-continue" onClick={() => ui.controller.resume()} data-testid="live-note-continue" autoFocus={ui.presenting}>
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
