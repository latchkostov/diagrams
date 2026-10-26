import { t } from "../i18n";
import { runEndResult } from "./runEndResult";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePhone } from "../lib/usePhone";
import { useStore } from "@xyflow/react";
import { useInteraction } from "../canvas/interaction";
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
export function NoteCallout({
  state,
  docked = false,
  subject: troubleSubject,
}: {
  state: LiveState;
  docked?: boolean;
  subject?: string;
}) {
  const ui = useLive();
  const maskId = useId();
  const phone = usePhone();
  const [expanded, setExpanded] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const interaction = useInteraction();
  const result = runEndResult(state, ui.controller.currentDiagram);
  const note = result ? { text: result, focus: [], atMs: state.run!.time } : state.run?.note;
  const waiting = !!state.run?.waiting;
  const subject = troubleSubject ?? note?.focus[0];
  const subjectNode = subject ? ui.controller.currentDiagram.nodes.find((n) => n.id === subject) : undefined;
  const transform = useStore((s) => s.transform);
  const paneWidth = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const lookup = useStore((s) => s.nodeLookup);
  const pane = useStore((s) => s.domNode);
  const ref = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ w: 420, h: 110 });
  const noteKey = note ? `${note.atMs}:${note.text}` : "";
  const open = expanded && phone && docked;
  const close = () => {
    setExpanded(false);
    if (expandRef.current) interaction?.dispatch({ type: "dialog.tab", target: expandRef.current });
  };
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setExpanded(false);
      if (expandRef.current) interaction?.dispatch({ type: "dialog.tab", target: expandRef.current });
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, interaction]);

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
    // A pausing presentation note moves keyboard focus to its explicit resume action (focus policy row L2).
    const resume = continueRef.current;
    if (waiting && ui.presenting && resume) interaction?.dispatch({ type: "narration.waiting", resume });
  }, [noteKey, waiting, ui.presenting, interaction]);

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

  const hud = pane?.querySelector<HTMLElement>(".lv-hud");
  const hudBox = hud?.getBoundingClientRect();
  const holes = hudBox
    ? [
        ...(pane?.parentElement?.querySelectorAll<HTMLElement>(
          '.react-flow__node-diagram:not([data-live-dim]):not([data-detail-hidden]), [data-testid^="focus-offscreen-"]',
        ) ?? []),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - hudBox.left - 8, y: r.top - hudBox.top - 8, width: r.width + 16, height: r.height + 16 };
      })
    : [];

  const notes = state.simulation?.timeline?.filter((step) => step.action.do === "note") ?? [];
  const index = notes.findIndex((n) => n.atMs === note.atMs);
  return (
    <>
      {open &&
        hud &&
        createPortal(
          <>
            <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
              <defs>
                <mask
                  id={maskId}
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width={hudBox?.width ?? 0}
                  height={hudBox?.height ?? 0}
                >
                  <rect width="100%" height="100%" fill="white" />
                  {holes.map((rect, index) => (
                    <rect key={index} {...rect} fill="black" />
                  ))}
                </mask>
              </defs>
            </svg>
            <button
              className="lv-note-scrim"
              data-testid="live-note-scrim"
              aria-label={t("common.close")}
              style={{ maskImage: `url("#${maskId}")` }}
              onClick={close}
            />
          </>,
          hud,
        )}
      <div
        ref={ref}
        key={`${note.atMs}:${note.text}`}
        className={`lv-note${docked ? " is-docked" : ""}${open ? " is-expanded" : ""} is-${placement}${waiting ? " is-waiting" : ""}${ui.presenting ? " is-presenting" : ""}`}
        style={docked ? undefined : style}
        role={open ? "dialog" : "status"}
        aria-label={open ? state.simulation?.title : undefined}
        aria-live="polite"
        data-testid="live-note"
        data-placement={placement}
        data-waiting={waiting ? "1" : undefined}
        data-editor-overlay
        data-expanded={open ? "1" : "0"}
      >
        {!result && (
          <div className="lv-note-head">
            <LiveIcon name="note" size={13} />
            <span>{state.simulation?.title ?? "Note"}</span>
            <span className="lv-note-time" data-testid="live-note-time">
              {t("workbench.noteAt", { time: formatClock(note.atMs).replace("s", " s") })}
            </span>
          </div>
        )}
        {open && (
          <button
            className="lv-note-close"
            data-testid="live-note-close"
            aria-label={t("common.close")}
            onClick={close}
          >
            ×
          </button>
        )}
        <p className="lv-note-text" data-testid={result ? "live-run-result" : "live-note-text"}>
          {note.text}
        </p>
        {waiting && (
          <div className="lv-note-actions">
            <button
              ref={continueRef}
              className="lv-note-continue"
              onClick={() => ui.controller.resume()}
              disabled={state.needsRestart}
              data-testid="live-note-continue"
            >
              Continue <LiveIcon name="play" size={10} />
            </button>
            <span className="lv-note-hint">
              or press <kbd>Space</kbd>
            </span>
          </div>
        )}
        {docked && subjectNode && ui.canEdit && ui.openNodeDetails && (
          <button
            className="lv-note-details"
            data-testid="live-note-details"
            onClick={() => {
              setExpanded(false);
              ui.openNodeDetails?.(subjectNode.id);
            }}
          >
            {t("workbench.nodeDetails", { name: subjectNode.label || subjectNode.id })} ›
          </button>
        )}
        {phone && docked && !open && (
          <button
            ref={expandRef}
            className="lv-note-expand"
            data-testid="live-note-expand"
            aria-expanded={open}
            onClick={() => setExpanded(true)}
          >
            {t("workbench.readNote")}
          </button>
        )}
        {open && index >= 0 && (
          <div className="lv-note-navigation">
            <button
              data-testid="live-note-earlier"
              disabled={index === 0}
              onClick={() => ui.controller.seek(notes[index - 1].atMs)}
            >
              ‹ {t("workbench.earlier")}
            </button>
            <span>{t("workbench.noteIndex", { index: index + 1, total: notes.length })}</span>
            <button
              data-testid="live-note-later"
              disabled={index === notes.length - 1}
              onClick={() => ui.controller.seek(notes[index + 1].atMs)}
            >
              {t("workbench.later")} ›
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Canvas overlays (title card, bottleneck callout, corner buttons, trace card) in pane coordinates. */
function overlayBoxes(pane: HTMLElement | null): Box[] {
  const wrap = pane?.parentElement;
  if (!pane || !wrap) return [];
  const origin = pane.getBoundingClientRect();
  const out: Box[] = [];
  // Plus the Live toggle and "Exit presentation" in the top-right corner, and the trace card.
  for (const el of wrap.querySelectorAll<HTMLElement>("[data-canvas-overlay], .lv-toggle, .present-exit, .tr-card")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    out.push({ l: r.left - origin.left, t: r.top - origin.top, r: r.right - origin.left, b: r.bottom - origin.top });
  }
  return out;
}
