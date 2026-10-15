import { t } from "../i18n";
// A finished trace (the whole fan-out tree from its root) as a sequence diagram: participants are the
// nodes in path order, each message is an arrow (async open, sync solid, replies dashed), failures,
// retries and dead letters are notes, and long quiet stretches become "gap" rows that say where the
// time went. Pure data; `toMermaid` and `toSvg` render it.

import type { MessageTrace, TraceStep } from "../sim/types";
import { buildJourney, edgeIndex, formatDuration, type DiagramLike, type Journey } from "./journey";

export interface Participant {
  id: string;
  label: string;
}

export type ArrowStyle = "async" | "sync" | "reply" | "retry" | "dlq";

export interface SequenceArrow {
  kind: "arrow";
  /** Ms since the trace started (when it was sent). */
  t: number;
  /** When it arrived. */
  until: number;
  from: string;
  to: string;
  style: ArrowStyle;
  /** The message type (or "reply" / "redeliver"). */
  label: string;
  /** The edge's own label, if any (e.g. "POST /orders"). */
  detail?: string;
  /** The message or copy it carries. */
  id: number;
  type: string;
}

export interface SequenceNote {
  kind: "note";
  t: number;
  over: string;
  text: string;
  /** neutral: on purpose (a deny rule's block), never a failure. */
  tone: "warn" | "danger" | "neutral";
}

export interface SequenceGap {
  kind: "gap";
  t: number;
  ms: number;
  text: string;
  /** Where the time went (the node the next message leaves from), if known. */
  node?: string;
}

export type SequenceItem = SequenceArrow | SequenceNote | SequenceGap;

export interface SequenceModel {
  title: string;
  /** "2.41 s end to end · 3 copies · 2 retries · dead-lettered". */
  summary: string;
  participants: Participant[];
  items: SequenceItem[];
  totalMs: number;
  done: boolean;
  partial: boolean;
  truncated: boolean;
}

export interface SequenceOptions {
  /** A quiet stretch at least this long (ms) gets a gap row. Default: max(250, 12% of the total). */
  gapMs?: number;
}

export function buildSequence(trace: MessageTrace, diagram: DiagramLike, opts: SequenceOptions = {}): SequenceModel {
  const journey = buildJourney(trace, diagram);
  const edges = edgeIndex(diagram);
  const labels = new Map(diagram.nodes.map((n) => [n.id, n.label || n.id]));
  const t0 = trace.startedAt;
  const items: (SequenceArrow | SequenceNote)[] = [];
  const failed = new Map<number, number>();
  let streak: { note: SequenceNote; id: number; first: number } | undefined;

  trace.steps.forEach((step: TraceStep) => {
    const t = step.t - t0;
    if (step.kind === "send" && step.edge) {
      const edge = edges.get(step.edge);
      if (!edge) return;
      const via = step.via ?? "message";
      const back = via === "reply" || via === "retry";
      const style: ArrowStyle = via === "message" ? (edge.kind === "sync" ? "sync" : "async") : (via as ArrowStyle);
      const label =
        via === "reply"
          ? "reply"
          : via === "retry"
            ? `back to the broker after attempt ${failed.get(step.id) ?? 1}`
            : via === "dlq"
              ? `${step.type} (dead letter)`
              : step.type;
      items.push({
        kind: "arrow",
        t,
        until: (step.until ?? step.t) - t0,
        from: back ? edge.to : edge.from,
        to: back ? edge.from : edge.to,
        style,
        label,
        ...(via === "message" && edge.label && edge.label !== step.type ? { detail: edge.label } : {}),
        id: step.id,
        type: step.type,
      });
    } else if (step.kind === "fail") {
      const attempt = step.attempt ?? 1;
      failed.set(step.id, attempt);
      // Back-to-back failures of one message at one node (in-place retries) read as one note.
      const prev = items.at(-1);
      if (prev && prev === streak?.note && streak.id === step.id && prev.over === step.node) {
        prev.text = `✕ attempts ${streak.first}–${attempt} failed`;
        return;
      }
      const note: SequenceNote = {
        kind: "note",
        t,
        over: step.node!,
        text: `✕ attempt ${attempt} failed`,
        tone: "warn",
      };
      streak = { note, id: step.id, first: attempt };
      items.push(note);
    } else if (step.kind === "deadletter") {
      items.push({
        kind: "note",
        t,
        over: step.node!,
        text: `Dead-lettered after ${step.attempt ?? "?"} deliveries`,
        tone: "danger",
      });
    } else if (step.kind === "drop") {
      items.push({ kind: "note", t, over: step.node!, text: `Dropped: ${step.reason ?? "lost"}`, tone: "danger" });
    } else if (step.kind === "reject") {
      items.push({ kind: "note", t, over: step.node!, text: tRejected(), tone: "neutral" });
    } else if (step.kind === "block") {
      items.push({ kind: "note", t, over: step.node!, text: "Blocked by a deny rule", tone: "neutral" });
    }
  });

  // Gaps: stretches where nothing was sent or travelling (so the time went inside a node), explained
  // by what the next message was doing there.
  const threshold = opts.gapMs ?? Math.max(250, journey.totalMs * 0.12);
  const out: SequenceItem[] = [];
  let last = 0;
  for (const item of items) {
    const quiet = item.t - last;
    if (quiet >= threshold)
      out.push({
        kind: "gap",
        t: last,
        ms: quiet,
        text: explainGap(journey, item, last, labels),
        node: item.kind === "arrow" ? item.from : item.over,
      });
    out.push(item);
    last = Math.max(last, item.kind === "arrow" ? item.until : item.t);
  }

  // Participants in path order: the origin, then each node as the diagram first reaches it.
  const order: string[] = [];
  const add = (id: string) => {
    if (!order.includes(id)) order.push(id);
  };
  add(trace.origin);
  for (const item of out) {
    if (item.kind === "arrow") {
      add(item.from);
      add(item.to);
    } else if (item.kind === "note") add(item.over);
  }

  const facts = [
    `${formatDuration(journey.totalMs)} end to end${journey.done ? "" : " so far"}`,
    journey.copies ? `${journey.copies} ${journey.copies === 1 ? "copy" : "copies"}` : "",
    journey.retries ? `${journey.retries} ${journey.retries === 1 ? "retry" : "retries"}` : "",
    journey.deadLettered ? "dead-lettered" : "",
    journey.dropped ? `${journey.dropped} dropped` : "",
    journey.blocked ? `${journey.blocked} blocked by a deny rule` : "",
  ].filter(Boolean);

  return {
    title: `${trace.type} #${trace.rootId}`,
    summary: facts.join(" · "),
    participants: order.map((id) => ({ id, label: labels.get(id) ?? id })),
    items: out,
    totalMs: journey.totalMs,
    done: trace.done,
    partial: trace.partial,
    truncated: trace.truncated,
  };
}

/** What the message was doing during a quiet stretch before `next`. */
function explainGap(journey: Journey, next: SequenceItem, from: number, labels: Map<string, string>): string {
  const ms = next.t - from;
  const time = formatDuration(ms);
  const node = next.kind === "arrow" ? next.from : next.kind === "note" ? next.over : undefined;
  const name = node ? (labels.get(node) ?? node) : "";
  if (!node) return `${time} later`;
  const id = next.kind === "arrow" ? next.id : undefined;
  const retrying = journey.rows.some(
    (r) =>
      r.kind === "fail" && r.node === node && (id === undefined || r.id === id) && r.t >= from - 1e-6 && r.t <= next.t,
  );
  if (retrying || (next.kind === "arrow" && next.style === "retry")) return `${time} at ${name}: failing and retrying`;
  const visit = [...journey.visits]
    .reverse()
    .find((v) => v.node === node && (id === undefined || v.id === id) && v.at <= next.t + 1e-6);
  if (!visit) return `${time} at ${name}`;
  const processing = visit.start !== undefined && visit.done !== undefined ? visit.done - visit.start : 0;
  const waited = Math.max(0, (visit.start ?? next.t) - visit.at);
  if (processing > 0 && waited >= processing)
    return `${time} at ${name}: waited ${formatDuration(waited)} for a worker`;
  if (processing > 0) return `${time} at ${name}: processing`;
  return `${time} waiting in ${name}`;
}

const tRejected = () => t("admission.rejected");
