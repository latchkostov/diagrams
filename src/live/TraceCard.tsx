import { routeWords, type RouteWords } from "../trace/routeWords";
import { RouteSwatch } from "../components/RouteSwatch";
import { routeName } from "../model/requestRouting";
import { t, useLocale } from "../i18n";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import "../styles/trace.css";
import type { DiagramFile } from "../model/types";
import { messageColor } from "../sim/colors";
import {
  buildJourney,
  formatDuration,
  formatOffset,
  type DiagramLike,
  type Journey,
  type JourneyRow,
} from "../trace/journey";
import { stencilRole } from "../stencils/roles";
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
  /** "Slow motion": replay this journey paced, node by node (absent where it isn't offered). */
  onSlowMotion?(): void;
  /** While slow motion plays this journey: the hop being told, and replay controls. */
  slowmo?: SlowCard | null;
  /** Replaces the waiting line (slow motion recording ahead, or waiting for its message). */
  waitingText?: string;
}

export interface SlowCard {
  playing: boolean;
  /** The hop being told (a journey row key) and every hop in progress. */
  row?: string;
  activeRows: readonly string[];
  onToggle(): void;
  /** A hop row was clicked: tell the story from there. */
  onSeek(key: string): void;
  /** Back to live (the close button and Esc). */
  onExit(): void;
  /** Copies left out of a fan-out wider than four. */
  hiddenCopies: number;
  /** A warning or a status line under the hops (a long replay, a journey still under way). */
  note?: string;
}

/** "Done", "In flight", "Dead-lettered", "Dropped", or "Kept" in a topic nobody reads ("Waiting" in a queue). */
function journeyStatus(
  j: Journey,
  diagram: DiagramLike,
): { key: "flight" | "done" | "dlq" | "dropped" | "blocked" | "rejected" | "kept"; label: string; title?: string } {
  if (j.deadLettered) return { key: "dlq", label: "Dead-lettered" };
  if (!j.done) return { key: "flight", label: "In flight" };
  if (j.rejected) return { key: "rejected", label: t("admission.rejected") };
  if (j.dropped) return { key: "dropped", label: "Dropped" };
  // A deny rule's block is on purpose: its own outcome, never a drop.
  if (j.blocked) return { key: "blocked", label: "Blocked", title: "A deny rule stopped it: on purpose, not lost" };
  const at = j.kept.length ? diagram.nodes.find((n) => n.id === j.kept[0]) : undefined;
  if (at) {
    const queue = stencilRole(at.stencil) === "queue";
    return {
      key: "kept",
      label: queue ? "Waiting" : "Kept",
      title: `Nobody reads ${at.label || at.id}: ${queue ? "it waits there for a consumer" : "it keeps the message"}`,
    };
  }
  return { key: "done", label: "Done" };
}

/**
 * The compact card for a traced message: its hops with timestamps and the latency of each, the
 * end-to-end total, retries (amber) and dead letters (red). One primary action: the sequence diagram.
 */
export function TraceCard({
  trace,
  diagram,
  now,
  onClose,
  onSequence,
  onSendOne,
  room = 0,
  onSlowMotion,
  slowmo,
  waitingText,
}: TraceCardProps) {
  useLocale();
  const labels = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n.label || n.id])), [diagram]);
  const name = (id: string | undefined) => (id ? (labels.get(id) ?? id) : "");
  const words = useMemo(() => routeWords(diagram), [diagram]);
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
    if (el && pinned.current && !slowmo) el.scrollTop = el.scrollHeight;
  }, [rows, trace.rootId, slowmo]);
  // Slow motion keeps the hop being told in view (inside the list only: the page never scrolls).
  const row = slowmo?.row;
  useEffect(() => {
    const el = list.current;
    if (!el || row === undefined) return;
    const item = el.querySelector<HTMLElement>(`[data-row="${CSS.escape(row)}"]`);
    if (!item) return;
    const top = item.offsetTop - el.offsetTop;
    if (top < el.scrollTop + 8) el.scrollTop = Math.max(0, top - 24);
    else if (top + item.offsetHeight > el.scrollTop + el.clientHeight - 8)
      el.scrollTop = top + item.offsetHeight - el.clientHeight + 24;
  }, [row]);
  const activeRows = slowmo?.activeRows;
  const active = useMemo(() => new Set(activeRows ?? []), [activeRows]);

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
              {waitingText ??
                (p?.next === "deadletter"
                  ? "Waiting for a message to dead-letter…"
                  : where
                    ? `Waiting for the next message at ${name(where)}…`
                    : trace.rootId !== undefined
                      ? `Waiting for message #${trace.rootId}…`
                      : "Waiting for the next message…")}
            </span>
          </div>
          <CloseButton key="close" onClose={slowmo?.onExit ?? onClose} slowmo={!!slowmo} />
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

  const status = journeyStatus(journey, diagram);
  // An addressed journey is named by its route (its swatch and marker, not colour alone).
  const rootRouteId = journey.rows[0]?.route;
  const rootRoute = rootRouteId ? diagram.planning?.requestRoutes?.find((r) => r.id === rootRouteId) : undefined;
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
        {rootRoute ? (
          <RouteSwatch route={rootRoute} size={14} />
        ) : (
          <span className="tr-swatch" style={{ background: messageColor(journey.type) }} aria-hidden />
        )}
        <div className="tr-titles">
          <strong
            title={`${rootRoute ? (words.address(rootRoute.id) ?? journey.type) : journey.type} #${journey.rootId}`}
          >
            {rootRoute ? routeName(rootRoute) : journey.type} <span className="tr-id">#{journey.rootId}</span>
          </strong>
          <span>from {name(journey.origin)}</span>
        </div>
        <span
          className={`tr-status is-${status.key}`}
          data-testid="trace-status"
          data-status={status.key}
          title={status.title}
        >
          {status.label}
        </span>
        <CloseButton key="close" onClose={slowmo?.onExit ?? onClose} slowmo={!!slowmo} />
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
          {!!slowmo?.hiddenCopies && (
            <span
              className="tr-chip"
              data-testid="trace-slowmo-more"
              title="Slow motion shows four copies leaving together; the list has them all"
            >
              +{slowmo.hiddenCopies} more
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
          <Hop
            key={row.key}
            row={row}
            name={name}
            words={words}
            current={slowmo ? slowmo.row === row.key : undefined}
            active={active.has(row.key)}
            onSeek={slowmo?.onSeek}
          />
        ))}
      </ol>
      {(journey.partial || journey.truncated) && (
        <p className="tr-note">
          {journey.partial ? "Joined in flight: earlier hops weren't recorded." : "Cut short: a very long journey."}
        </p>
      )}
      {slowmo?.note && (
        <p className="tr-note" data-testid="trace-slowmo-note">
          {slowmo.note}
        </p>
      )}

      <footer className="tr-foot">
        <button className="btn btn-primary" onClick={onSequence} data-testid="trace-sequence">
          <LiveIcon name="sequence" size={14} /> Sequence diagram
        </button>
        {slowmo ? (
          <button
            className="btn"
            onClick={slowmo.onToggle}
            data-testid="trace-slowmo"
            data-state={slowmo.playing ? "playing" : "paused"}
            title={slowmo.playing ? "Pause the slow motion (Space)" : "Play the slow motion (Space)"}
          >
            <LiveIcon name={slowmo.playing ? "pause" : "play"} size={12} /> {slowmo.playing ? "Pause" : "Play"}
          </button>
        ) : (
          onSlowMotion && (
            <button
              className="btn"
              onClick={onSlowMotion}
              data-testid="trace-slowmo"
              title="Watch this message node by node, in slow motion"
            >
              <LiveIcon name="slowmo" size={14} /> Slow motion
            </button>
          )
        )}
        {/* Two actions leave room for one short hint (the close button's title says Esc too). */}
        {slowmo ? (
          <span className="tr-hint" data-testid="trace-slowmo-hint" title="← → step hop by hop · Space pauses">
            Esc returns
          </span>
        ) : (
          !onSlowMotion && (
            <span className="tr-hint">{journey.done ? "Esc ends the trace" : "Still travelling · Esc ends"}</span>
          )
        )}
      </footer>
    </section>
  );
}

const hopCount = (j: Journey) =>
  j.rows.filter((r) => r.kind === "hop" || r.kind === "dlq" || r.kind === "redeliver").length;

function CloseButton({ onClose, slowmo = false }: { onClose(): void; slowmo?: boolean }) {
  const label = slowmo ? "Back to live (Esc)" : "End trace (Esc)";
  return (
    <button
      className="lv-btn tr-close"
      onClick={onClose}
      aria-label={label}
      title={label}
      data-testid="trace-card-close"
    >
      <LiveIcon name="close" size={13} />
    </button>
  );
}

function Hop({
  row,
  name,
  words,
  current,
  active,
  onSeek,
}: {
  row: JourneyRow;
  name: (id: string | undefined) => string;
  /** Request routing: the address, the router's rule and split, in words. */
  words?: RouteWords;
  /** Slow motion: this is the hop being told (undefined outside slow motion). */
  current?: boolean;
  active?: boolean;
  onSeek?: (key: string) => void;
}) {
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
    case "rejected":
      main = name(row.node);
      sub = words?.refusal(row.reason) ?? t("admission.rejected");
      break;
    case "blocked":
      main = name(row.node);
      sub = "blocked by a deny rule";
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
  if (row.backoffMs !== undefined)
    sub = t("resilience.retryBeat", {
      attempt: row.attempt ?? 2,
      max: row.maxAttempts ?? 3,
      backoff: row.backoffMs,
      reason: row.reason === "timed out" ? t("resilience.timeout") : (row.reason ?? ""),
    });
  // An addressed request says its address, and on a router's hop the rule and split that chose it.
  const routed = words?.hop(row.route, row.from, row.rule, row.weight);
  if (routed) sub = `${routed} · ${sub}`;
  const look = words?.look(row.route);
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
  const content = (
    <>
      <span className="tr-time mono">{formatOffset(row.t)}</span>
      <span
        className={`tr-dot is-${row.kind}`}
        style={tone === "plain" ? { background: look?.color ?? messageColor(row.type) } : undefined}
        data-marker={look?.marker}
        aria-hidden
      >
        {row.kind === "fail" || row.kind === "drop"
          ? "✕"
          : row.kind === "deadletter"
            ? "!"
            : row.kind === "blocked"
              ? "⊘"
              : ""}
      </span>
      <span className="tr-what">
        <b>
          {row.kind === "hop" || row.kind === "dlq" || row.kind === "redeliver" ? "→ " : ""}
          {main}
        </b>
        <small>{sub}</small>
      </span>
      <span className="tr-lat mono">{row.latencyMs !== undefined ? formatDuration(row.latencyMs) : ""}</span>
    </>
  );
  return (
    <li
      className={`tr-hop is-${tone}${row.copy ? " is-copy" : ""}${current ? " is-current" : ""}${active && !current ? " is-active" : ""}${onSeek ? " is-seekable" : ""}`}
      data-testid={current ? "trace-row-current" : `trace-hop-${row.key}`}
      data-row={row.key}
      data-kind={row.kind}
      data-node={row.node}
      aria-current={current ? "step" : undefined}
      title={breakdown ? `From ${name(row.from)}: ${breakdown}` : undefined}
    >
      {onSeek ? (
        // Slow motion: a hop is a place in the replay. Its name is the row's own words (failures,
        // attempts, reasons, latency), after what a click does.
        <button
          type="button"
          className="tr-hop-seek"
          onClick={() => onSeek(row.key)}
          data-testid={`trace-hop-seek-${row.key}`}
        >
          <span className="sr-only">Play from here: </span>
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
}
