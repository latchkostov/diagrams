import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import "../styles/trace.css";
import type { DiagramFile } from "../model/types";
import { messageColor } from "../sim/colors";
import { buildJourney, formatDuration, formatOffset, type Journey, type JourneyRow } from "../trace/journey";
import type { LiveTrace } from "./controller";
import { LiveIcon } from "./icons";
import { TRACE_CARD_FOOTPRINT } from "./traceCardLayout";

export interface TraceCardProps {
  trace: LiveTrace;
  diagram: DiagramFile;
  /** Simulation time now, for an unfinished journey's running total. */
  now: number;
  onClose(): void;
  onSequence(): void;
  /** Waiting at a node: inject one message there. Absent where injecting isn't offered. */
  onSendOne?(nodeId: string): void;
  /** How tall it may grow before it reaches the diagram, in px (see `roomUnderCard`); 0 = no limit. */
  room?: number;
}

/** "Done", "In flight", "Dead-lettered", "Dropped". */
function journeyStatus(j: Journey): { key: "flight" | "done" | "dlq" | "dropped"; label: string } {
  if (j.deadLettered) return { key: "dlq", label: "Dead-lettered" };
  if (!j.done) return { key: "flight", label: "In flight" };
  if (j.dropped) return { key: "dropped", label: "Dropped" };
  return { key: "done", label: "Done" };
}

/**
 * The compact card for a traced message: its hops with timestamps and the latency of each, the
 * end-to-end total, retries (amber) and dead letters (red). One primary action: the sequence diagram.
 */
export function TraceCard({ trace, diagram, now, onClose, onSequence, onSendOne, room = 0 }: TraceCardProps) {
  const labels = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n.label || n.id])), [diagram]);
  const name = (id: string | undefined) => (id ? (labels.get(id) ?? id) : "");
  const current = trace.current;
  const journey = useMemo(() => (current ? buildJourney(current, diagram, now) : null), [current, diagram, now]);

  // Follow the newest hop unless the reader scrolled up to look at an earlier one.
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const rows = journey?.rows.length ?? 0;
  useLayoutEffect(() => {
    pinned.current = true;
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [trace.rootId]);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows, trace.rootId]);

  // With a side panel open the card heads the panel's column; the panel starts below it.
  const card = useRef<HTMLElement>(null);
  const shape = journey ? "journey" : "waiting";
  const waitingFocus = useRef<HTMLElement | null>(null);
  const rememberFocus = (target: EventTarget) => {
    if (shape === "waiting" && target instanceof HTMLElement) waitingFocus.current = target;
  };
  useLayoutEffect(() => {
    const focused = waitingFocus.current;
    if (shape === "journey") {
      if (focused && !focused.isConnected && document.activeElement === document.body) list.current?.focus();
      waitingFocus.current = null;
    }
  }, [shape]);
  useLayoutEffect(() => {
    const el = card.current;
    const host = el?.closest<HTMLElement>(".react-flow");
    if (!el || !host) return;
    const report = () => host.style.setProperty("--lv-trace-h", `${el.offsetHeight + 10}px`);
    report();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      host.style.removeProperty("--lv-trace-h");
    };
  }, [shape]);

  if (!journey) {
    const p = trace.pending;
    const where = p?.next === "message" && p.node ? p.node : undefined;
    return (
      <section
        ref={card}
        style={room ? { maxHeight: room } : undefined}
        className="tr-card is-waiting"
        data-canvas-overlay
        data-editor-overlay
        onFocusCapture={(e) => rememberFocus(e.target)}
        onBlurCapture={(e) => {
          if (e.target === waitingFocus.current) waitingFocus.current = null;
        }}
        data-overlay-height={TRACE_CARD_FOOTPRINT}
        data-testid="trace-card"
        data-state="waiting"
        aria-label="Message trace"
      >
        <header className="tr-head">
          <span className="tr-icon" aria-hidden>
            <LiveIcon name="trace" size={14} />
          </span>
          <div className="tr-titles">
            <strong>Trace a message</strong>
            <span data-testid="trace-waiting">
              {p?.next === "deadletter"
                ? "Waiting for a message to dead-letter…"
                : where
                  ? `Waiting for the next message at ${name(where)}…`
                  : trace.rootId !== undefined
                    ? `Waiting for message #${trace.rootId}…`
                    : "Waiting for the next message…"}
            </span>
          </div>
          <CloseButton key="close" onClose={onClose} />
        </header>
        {where && onSendOne && (
          <footer className="tr-foot">
            <button className="btn" onClick={() => onSendOne(where)} data-testid="trace-send-one">
              <LiveIcon name="bolt" size={13} /> Send one now
            </button>
            <span className="tr-hint">Esc ends the trace</span>
          </footer>
        )}
      </section>
    );
  }

  const status = journeyStatus(journey);
  return (
    <section
      ref={card}
      style={room ? { maxHeight: room } : undefined}
      className={`tr-card is-${status.key}`}
      // Fit view keeps its first rows clear; below them it stops above the diagram by itself.
      data-canvas-overlay
      data-editor-overlay
      data-overlay-height={TRACE_CARD_FOOTPRINT}
      data-testid="trace-card"
      data-state={status.key}
      data-root={journey.rootId}
      aria-label={`Message trace: ${journey.type} #${journey.rootId}`}
    >
      <header className="tr-head">
        <span className="tr-swatch" style={{ background: messageColor(journey.type) }} aria-hidden />
        <div className="tr-titles">
          <strong title={`${journey.type} #${journey.rootId}`}>
            {journey.type} <span className="tr-id">#{journey.rootId}</span>
          </strong>
          <span>from {name(journey.origin)}</span>
        </div>
        <span className={`tr-status is-${status.key}`} data-testid="trace-status" data-status={status.key}>
          {status.label}
        </span>
        <CloseButton key="close" onClose={onClose} />
      </header>

      <div className="tr-stats">
        <div className="tr-total" data-testid="trace-total" data-ms={Math.round(journey.totalMs)}>
          <strong>{formatDuration(journey.totalMs)}</strong>
          <span>{journey.done ? "end to end" : "so far"}</span>
        </div>
        <div className="tr-chips">
          <span className="tr-chip" data-testid="trace-hops" data-count={hopCount(journey)}>
            {hopCount(journey)} {hopCount(journey) === 1 ? "hop" : "hops"}
          </span>
          {journey.copies > 0 && (
            <span className="tr-chip" data-testid="trace-copies" data-count={journey.copies}>
              {journey.copies} {journey.copies === 1 ? "copy" : "copies"}
            </span>
          )}
          {journey.retries > 0 && (
            <span className="tr-chip is-warn" data-testid="trace-retries" data-count={journey.retries}>
              {journey.retries} {journey.retries === 1 ? "retry" : "retries"}
            </span>
          )}
          {journey.deadLettered > 0 && (
            <span className="tr-chip is-danger" data-testid="trace-dlq">
              DLQ
            </span>
          )}
        </div>
      </div>

      <ol
        className="tr-hops"
        ref={list}
        aria-label="Hops"
        // Scrollable, so keyboard users can reach it (and scroll with the arrow keys).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        data-testid="trace-hops-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {journey.rows.map((row) => (
          <Hop key={row.key} row={row} name={name} />
        ))}
      </ol>
      {(journey.partial || journey.truncated) && (
        <p className="tr-note">
          {journey.partial ? "Joined in flight: earlier hops weren't recorded." : "Cut short: a very long journey."}
        </p>
      )}

      <footer className="tr-foot">
        <button className="btn btn-primary" onClick={onSequence} data-testid="trace-sequence">
          <LiveIcon name="sequence" size={14} /> Sequence diagram
        </button>
        <span className="tr-hint">{journey.done ? "Esc ends the trace" : "Still travelling · Esc ends"}</span>
      </footer>
    </section>
  );
}

const hopCount = (j: Journey) =>
  j.rows.filter((r) => r.kind === "hop" || r.kind === "dlq" || r.kind === "redeliver").length;

function CloseButton({ onClose }: { onClose(): void }) {
  return (
    <button
      className="lv-btn tr-close"
      onClick={onClose}
      aria-label="End trace (Esc)"
      title="End trace (Esc)"
      data-testid="trace-card-close"
    >
      <LiveIcon name="close" size={13} />
    </button>
  );
}

function Hop({ row, name }: { row: JourneyRow; name: (id: string | undefined) => string }) {
  const tone =
    row.kind === "fail" || row.kind === "redeliver"
      ? "warn"
      : row.kind === "deadletter" || row.kind === "dlq" || row.kind === "drop"
        ? "danger"
        : "plain";
  let main: string;
  let sub: string;
  switch (row.kind) {
    case "origin":
      main = name(row.node);
      sub = `sent ${row.type}`;
      break;
    case "fail":
      main = name(row.node);
      sub =
        row.lastAttempt !== undefined
          ? `attempts ${row.attempt ?? 1}\u2013${row.lastAttempt} failed`
          : `attempt ${row.attempt ?? 1} failed`;
      break;
    case "deadletter":
      main = name(row.node);
      sub = `dead-lettered after ${row.attempt ?? "?"} deliveries`;
      break;
    case "drop":
      main = name(row.node);
      sub = `dropped: ${row.reason ?? "lost"}`;
      break;
    default: {
      main = name(row.node);
      sub = [
        row.kind === "redeliver"
          ? `redelivered, attempt ${row.attempt ?? 2}`
          : row.kind === "dlq"
            ? `dead letter from ${name(row.from)}`
            : `from ${name(row.from)}`,
        row.renamed ? `as ${row.type}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
  }
  const breakdown =
    row.latencyMs !== undefined
      ? [
          row.waitMs ? `waited ${formatDuration(row.waitMs)}` : "",
          row.processMs ? `processed ${formatDuration(row.processMs)}` : "",
          row.travelMs !== undefined ? `travelled ${formatDuration(row.travelMs)}` : "",
        ]
          .filter(Boolean)
          .join(", ")
      : "";
  return (
    <li
      className={`tr-hop is-${tone}${row.copy ? " is-copy" : ""}`}
      data-testid={`trace-hop-${row.key}`}
      data-kind={row.kind}
      data-node={row.node}
      title={breakdown ? `From ${name(row.from)}: ${breakdown}` : undefined}
    >
      <span className="tr-time mono">{formatOffset(row.t)}</span>
      <span
        className={`tr-dot is-${row.kind}`}
        style={tone === "plain" ? { background: messageColor(row.type) } : undefined}
        aria-hidden
      >
        {row.kind === "fail" || row.kind === "drop" ? "✕" : row.kind === "deadletter" ? "!" : ""}
      </span>
      <span className="tr-what">
        <b>
          {row.kind === "hop" || row.kind === "dlq" || row.kind === "redeliver" ? "→ " : ""}
          {main}
        </b>
        <small>{sub}</small>
      </span>
      <span className="tr-lat mono">{row.latencyMs !== undefined ? formatDuration(row.latencyMs) : ""}</span>
    </li>
  );
}
