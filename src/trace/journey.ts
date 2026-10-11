// A recorded message trace, read for people: the hops it took (node → edge → node) with the time
// each one took, where it waited, retries, dead letters and drops, plus the totals. Pure: the trace
// card and the sequence generator both build on this.

import type { DiagramFile } from "../model/types";
import type { MessageTrace, TraceStep } from "../sim/types";

export type DiagramLike = Pick<DiagramFile, "nodes" | "edges">;

/** One node visit by one message (or copy): when it got there, started and finished. */
export interface Visit {
  id: number;
  node: string;
  /** Arrival (or creation) time, ms since the trace started. */
  at: number;
  start?: number;
  done?: number;
  /** When it left (its first send from here). */
  left?: number;
}

export type HopKind = "origin" | "hop" | "redeliver" | "dlq" | "fail" | "deadletter" | "drop";

export interface JourneyRow {
  /** Unique within the journey. */
  key: string;
  kind: HopKind;
  /** Ms since the trace started. */
  t: number;
  /** The message or copy. */
  id: number;
  /** Its type here. */
  type: string;
  /** Where it is (the arrival node for a hop). */
  node: string;
  /** Hops: where it came from, along which edge. */
  from?: string;
  edge?: string;
  sync?: boolean;
  /** Hops: from arriving at (or leaving) `from` to arriving here: the hop's latency. */
  latencyMs?: number;
  /** Hops: the parts of that latency. */
  waitMs?: number;
  processMs?: number;
  travelMs?: number;
  /** The type changed on the way (a node or edge renamed it). */
  renamed?: boolean;
  /** fail / deadletter: the delivery attempt; redeliver: the attempt it starts. */
  attempt?: number;
  /** fail: the last of several back-to-back failed attempts folded into this row. */
  lastAttempt?: number;
  /** drop: why. */
  reason?: string;
  /** This row belongs to a fan-out copy, not the original message. */
  copy: boolean;
}

export interface Journey {
  rootId: number;
  type: string;
  origin: string;
  /** Absolute simulation time the trace started at. */
  startedAt: number;
  /** End to end so far (ms): to the last copy's end, or to `now` while in flight. */
  totalMs: number;
  done: boolean;
  partial: boolean;
  truncated: boolean;
  rows: JourneyRow[];
  visits: Visit[];
  /** Message ids in the family (the root and its copies). */
  ids: number[];
  copies: number;
  retries: number;
  failures: number;
  deadLettered: number;
  dropped: number;
  /** Nodes reached and edges travelled, in order of first use: the path so far. */
  nodes: string[];
  edges: string[];
}

export function edgeIndex(diagram: DiagramLike) {
  return new Map(diagram.edges.map((e) => [e.id, e]));
}

/** Builds the journey of a trace. `now` (absolute ms) bounds an unfinished trace's total. */
export function buildJourney(trace: MessageTrace, diagram: DiagramLike, now = trace.endedAt): Journey {
  const edges = edgeIndex(diagram);
  const t0 = trace.startedAt;
  const rel = (t: number) => t - t0;
  const rows: JourneyRow[] = [];
  const visits: Visit[] = [];
  const at = new Map<number, Visit>();
  const sent = new Map<number, TraceStep>();
  const types = new Map<number, string>();
  // Its type when it last arrived somewhere: a different type on the next hop means it was renamed.
  const hopType = new Map<number, string>();
  const ids: number[] = [];
  const nodes: string[] = [];
  const edgeList: string[] = [];
  const seenNode = new Set<string>();
  const seenEdge = new Set<string>();
  const lastFail = new Map<number, number>();
  const redelivering = new Set<number>();
  const returned = new Map<number, number>();
  let retries = 0,
    failures = 0,
    deadLettered = 0,
    dropped = 0;

  const reach = (node: string | undefined) => {
    if (node && !seenNode.has(node)) {
      seenNode.add(node);
      nodes.push(node);
    }
  };
  const travel = (edge: string | undefined) => {
    if (edge && !seenEdge.has(edge)) {
      seenEdge.add(edge);
      edgeList.push(edge);
    }
  };
  const visit = (id: number, node: string, t: number): Visit => {
    const v: Visit = { id, node, at: t };
    visits.push(v);
    at.set(id, v);
    return v;
  };
  const known = (id: number) => {
    if (!types.has(id)) ids.push(id);
  };
  reach(trace.origin);

  trace.steps.forEach((step, i) => {
    const t = rel(step.t);
    const key = `${i}`;
    const copy = step.id !== trace.rootId;
    const renamed = hopType.has(step.id) && hopType.get(step.id) !== step.type;
    known(step.id);
    switch (step.kind) {
      case "emit":
        visit(step.id, step.node!, t);
        rows.push({ key, kind: "origin", t, id: step.id, type: step.type, node: step.node!, copy });
        break;
      case "copy": {
        const parent = at.get(step.parent!);
        const v = visit(step.id, step.node!, parent?.at ?? t);
        if (parent) Object.assign(v, { start: parent.start, done: parent.done });
        types.set(step.id, step.type);
        break;
      }
      case "send": {
        travel(step.edge);
        if (step.via === "message" || step.via === "dlq") {
          // Redelivered from its broker: it has been back there since its retry trip ended.
          if (at.get(step.id)?.node !== step.node) visit(step.id, step.node!, returned.get(step.id) ?? t);
          sent.set(step.id, step);
          const v = at.get(step.id);
          if (v && v.left === undefined) v.left = t;
        }
        if (step.via === "retry") {
          redelivering.add(step.id);
          returned.set(step.id, rel(step.until ?? step.t));
        }
        break;
      }
      case "arrive": {
        reach(step.node);
        const send = sent.get(step.id);
        const prev = at.get(step.id);
        const edge = step.edge ? edges.get(step.edge) : undefined;
        const left = send ? rel(send.t) : undefined;
        const latency = prev ? t - prev.at : left !== undefined ? t - left : undefined;
        const processMs = prev?.start !== undefined && prev.done !== undefined ? prev.done - prev.start : undefined;
        const waitMs = prev && left !== undefined ? Math.max(0, left - prev.at - (processMs ?? 0)) : undefined;
        const redeliver = redelivering.has(step.id) && send?.via === "message";
        rows.push({
          key,
          kind: send?.via === "dlq" ? "dlq" : redeliver ? "redeliver" : "hop",
          t,
          id: step.id,
          type: step.type,
          node: step.node!,
          from: send?.node ?? prev?.node,
          edge: step.edge,
          sync: edge?.kind === "sync",
          latencyMs: latency,
          waitMs,
          processMs,
          travelMs: left !== undefined ? t - left : undefined,
          renamed,
          ...(redeliver ? { attempt: (lastFail.get(step.id) ?? 0) + 1 } : {}),
          copy,
        });
        redelivering.delete(step.id);
        sent.delete(step.id);
        visit(step.id, step.node!, t);
        break;
      }
      case "start": {
        const v = at.get(step.id);
        if (v && v.node === step.node && v.start === undefined) v.start = t;
        break;
      }
      case "done": {
        const v = at.get(step.id);
        if (v && v.node === step.node) v.done = t;
        break;
      }
      case "fail": {
        failures++;
        lastFail.set(step.id, step.attempt ?? 1);
        // Back-to-back failures at one node (in-place retries) are one row: "attempts 1-5 failed".
        const prev = rows.at(-1);
        if (prev?.kind === "fail" && prev.id === step.id && prev.node === step.node) {
          prev.lastAttempt = step.attempt;
          break;
        }
        rows.push({
          key,
          kind: "fail",
          t,
          id: step.id,
          type: step.type,
          node: step.node!,
          attempt: step.attempt,
          copy,
        });
        break;
      }
      case "retry":
        retries++;
        break;
      case "deadletter":
        deadLettered++;
        if (at.get(step.id)?.node !== step.node) visit(step.id, step.node!, t);
        rows.push({
          key,
          kind: "deadletter",
          t,
          id: step.id,
          type: step.type,
          node: step.node!,
          attempt: step.attempt,
          copy,
        });
        break;
      case "drop":
        dropped++;
        rows.push({ key, kind: "drop", t, id: step.id, type: step.type, node: step.node!, reason: step.reason, copy });
        break;
      case "park":
      case "end":
        break;
    }
    types.set(step.id, step.type);
    if (step.kind === "emit" || step.kind === "copy" || step.kind === "arrive") hopType.set(step.id, step.type);
  });

  const end = trace.done ? trace.endedAt : now;
  return {
    rootId: trace.rootId,
    type: trace.type,
    origin: trace.origin,
    startedAt: trace.startedAt,
    totalMs: Math.max(0, (end ?? trace.steps.at(-1)?.t ?? t0) - t0),
    done: trace.done,
    partial: trace.partial,
    truncated: trace.truncated,
    rows,
    visits,
    ids,
    copies: Math.max(0, ids.length - 1),
    retries,
    failures,
    deadLettered,
    dropped,
    nodes,
    edges: edgeList,
  };
}

/** "0.45 s", "120 ms", "2.4 s", "1 min 5 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  const v = Math.max(0, Math.round(ms));
  if (v < 1000) return `${v} ms`;
  if (v < 10_000) return `${(v / 1000).toFixed(2)} s`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)} s`;
  const min = Math.floor(v / 60_000);
  const s = Math.round((v % 60_000) / 1000);
  return s ? `${min} min ${s} s` : `${min} min`;
}

/** "+0.45 s" relative timestamps for the trace card and the sequence gutter. */
export function formatOffset(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(2)} s`;
}
