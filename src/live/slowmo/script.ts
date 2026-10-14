// Slow motion: one message's recorded journey, retold as a paced script of "beats" (a hop, a pause
// at a node, a split, a write...). Pure: no DOM, no clocks. The live view records the journey first
// (look-ahead on a checkpoint, see session.ts), builds the script once, then asks `frameAt(script, t)`
// what to draw at script time t. Real timings only ever appear as text; the motion is paced for
// people. Contract: docs/SIMULATION.md, "Slow motion"; research: docs/research/watchable-simulation.md.

import type { SimRole } from "../../model/types";
import { messageColor } from "../../sim/colors";
import type { MessageTrace, TraceStep } from "../../sim/types";
import { buildJourney, formatDuration, type DiagramLike } from "../../trace/journey";

/** Every pacing constant in one place (wall milliseconds at 1×; the speed select scales the clock). */
export const PACING = {
  /** Screen speed of a hop: a mean of 260 px/s (about 6°/s at laptop distance). */
  pxPerSecond: 260,
  travelMin: 900,
  travelMax: 1800,
  /** Lift-off (the dot grows at the node border) and landing (the arrival ring), inside travel. */
  liftOff: 150,
  landing: 250,
  establish: 800,
  /** Processing dwell: clamp(0.55 + 0.22·log2(1 + ms/25), 0.6, 1.6) s. */
  processBase: 550,
  processPerDoubling: 220,
  processScale: 25,
  processMin: 600,
  processMax: 1600,
  /** Waiting (backlog, lag) dwell: clamp(0.5 + 0.3·log2(1 + ms/100), 0.5, 2.0) s; shown above 20 ms. */
  waitBase: 500,
  waitPerDoubling: 300,
  waitScale: 100,
  waitMin: 500,
  waitMax: 2000,
  waitThreshold: 20,
  append: 450,
  split: 400,
  /** A write ends with the dot sinking into the store. */
  sink: 300,
  /** Replies travel at 0.6 × a hop and never hold anything up. */
  replyFactor: 0.6,
  dlqFactor: 1.2,
  /** Failed attempts after the 2nd fold into one beat. */
  retriesShown: 2,
  collapse: 1200,
  drop: 600,
  end: 1200,
  /** Copies leaving a node together beyond this are summed up in one pill ("×6 OrderPlaced"). */
  maxLanes: 4,
  /** prefers-reduced-motion: every beat is a still state held this long, cross-fading in 200 ms. */
  reducedHold: 1500,
  reducedFade: 200,
  /** A script longer than this gets a warning in the trace card. */
  longScript: 60_000,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** easeInOutCubic (d3's easeCubicInOut): slow in, slow out. */
export function easeInOutCubic(x: number): number {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Travel time for an edge `px` long on screen. */
export function travelMs(px: number): number {
  const ms = (Number.isFinite(px) && px > 0 ? px : 0) / (PACING.pxPerSecond / 1000);
  return clamp(ms, PACING.travelMin, PACING.travelMax);
}

/** How long a node's work holds the dot, growing with the log of the real time (order is kept). */
export function processDwell(realMs: number): number {
  const ms = Math.max(0, Number.isFinite(realMs) ? realMs : 0);
  const v = PACING.processBase + PACING.processPerDoubling * Math.log2(1 + ms / PACING.processScale);
  return clamp(v, PACING.processMin, PACING.processMax);
}

/** How long a wait in a backlog or a log holds the dot. */
export function waitDwell(realMs: number): number {
  const ms = Math.max(0, Number.isFinite(realMs) ? realMs : 0);
  const v = PACING.waitBase + PACING.waitPerDoubling * Math.log2(1 + ms / PACING.waitScale);
  return clamp(v, PACING.waitMin, PACING.waitMax);
}

export type BeatKind =
  | "establish"
  | "travel"
  | "retry"
  | "dlq"
  | "reply"
  | "process"
  | "fail"
  | "write"
  | "wait"
  | "append"
  | "split"
  | "collapse"
  | "drop"
  /** Stopped by a deny rule: the dot fades as for a drop, in neutral, with no failure flash. */
  | "block"
  | "end";

export type Tone = "plain" | "warn" | "danger" | "done";

/** Where a dot sits on a node: at an edge's end (1, where it arrived) or start (0, where it leaves). */
export interface Anchor {
  edge: string;
  end: 0 | 1;
}

export interface Beat {
  /** Index in `script.beats`. */
  i: number;
  kind: BeatKind;
  /** The message or copy. */
  msg: number;
  type: string;
  color: string;
  node?: string;
  edge?: string;
  /** Drawn from the edge's target back to its source (retries, replies). */
  reverse?: boolean;
  /** Script time (ms at 1×). */
  start: number;
  duration: number;
  /** Real (simulated) ms since the trace started, at the beat's start and end. */
  realFrom: number;
  realTo: number;
  /** Words shown beside the dot: a node's caption, or the type riding a hop. */
  caption?: string;
  /** The caption without the node's name, for when the full one has no room beside the node. */
  short?: string;
  tone: Tone;
  /** The trace card row (journey row key) this beat tells. */
  rowKey?: string;
  /** Node beats: where the dot sits. */
  anchor?: Anchor;
  /** Split: the edges the copies leave on (shown ones), and how many copies there are in all. */
  lanes?: string[];
  copies?: number;
  /** Number of retries folded into this beat. */
  retries?: number;
  /** Write: the last part of the beat, when the dot sinks into the store. */
  sink?: number;
}

export interface SlowScript {
  rootId: number;
  type: string;
  origin: string;
  beats: Beat[];
  /** Script length in ms at 1×. */
  duration: number;
  /** Real journey length (ms). */
  realTotal: number;
  /** ← / → stop here: the start of every hop (and the first and last beat). */
  stops: number[];
  /** Trace card row → the script time it starts telling it. */
  rowStart: ReadonlyMap<string, number>;
  /** Every node and edge the replay visits (the camera frames these). */
  nodes: string[];
  edges: string[];
  /** Copies left out of a wide fan-out (more than 4 leaving together). */
  hiddenCopies: number;
  /** The journey wasn't over when recording stopped (look-ahead cap). */
  unfinished: boolean;
  /** "Done · 2.33 s · 5 copies · 5 writes", or "Still waiting at …". */
  summary: string;
  reduced: boolean;
}

export interface ScriptInput {
  trace: MessageTrace;
  diagram: DiagramLike;
  roleOf(nodeId: string): SimRole;
  /** An edge's on-screen length (px) at the slow-motion zoom. Default: 260 px (one second). */
  edgeLength?(edgeId: string): number;
  reduced?: boolean;
  /** The trace was cut at the look-ahead cap: what's known about where it waits. */
  waiting?: { lag(nodeId: string): number | undefined };
}

interface Track {
  id: number;
  type: string;
  node: string;
  /** Script time its chain is free. */
  ready: number;
  /** Real ms at that point. */
  real: number;
  arrivedReal: number;
  startReal?: number;
  anchor?: Anchor;
  incoming?: string;
  shown: boolean;
  fails: number;
  collapse?: {
    node: string;
    /** Where the dot sat when the folded retries began (it stays there while they're told). */
    anchor?: Anchor;
    fromReal: number;
    toReal: number;
    count: number;
    lastRetry?: TraceStep;
    rows: string[];
  };
  replies: TraceStep[];
  lastTravel?: Beat;
  ended: boolean;
  deadletterAttempt?: number;
}

const BROKERS: ReadonlySet<SimRole> = new Set(["topic", "queue", "stream"]);
const TRAVELS: ReadonlySet<BeatKind> = new Set(["travel", "retry", "dlq", "reply"]);
const HOPS: ReadonlySet<BeatKind> = new Set(["establish", "travel", "retry", "dlq", "end"]);

/** Builds the slow-motion script of a recorded trace. */
export function buildScript(input: ScriptInput): SlowScript {
  const { trace, diagram, roleOf } = input;
  const reduced = !!input.reduced;
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edges = new Map(diagram.edges.map((e) => [e.id, e]));
  const name = (id: string | undefined) => (id ? nodes.get(id)?.label || id : "");
  const t0 = trace.startedAt;
  const steps = trace.steps;
  // The trace card's rows (back-to-back failures fold into one): a beat names the row it tells.
  const rowOf = buildJourney(trace, diagram).rowOf;
  const beats: Beat[] = [];
  const tracks = new Map<number, Track>();
  const consumed = new Set<number>();
  const hidden = new Set<number>();
  const visitedNodes: string[] = [];
  const seenNode = new Set<string>();
  const usedEdges: string[] = [];
  const seenEdge = new Set<string>();
  const reach = (n: string | undefined) => {
    if (n && !seenNode.has(n)) {
      seenNode.add(n);
      visitedNodes.push(n);
    }
  };
  const markEdge = (e: string | undefined) => {
    if (e && !seenEdge.has(e)) {
      seenEdge.add(e);
      usedEdges.push(e);
    }
  };
  /** A beat's length, after reduced motion's rule (every state held the same time). */
  const len = (ms: number) => (reduced ? PACING.reducedHold : ms);
  const hop = (edge: string) => travelMs(input.edgeLength?.(edge) ?? PACING.pxPerSecond);
  let hiddenCopies = 0;

  const push = (b: Omit<Beat, "i" | "color" | "tone"> & { tone?: Tone; color?: string }): Beat => {
    const beat: Beat = { ...b, i: beats.length, color: b.color ?? messageColor(b.type), tone: b.tone ?? "plain" };
    const prefix = b.node ? `${name(b.node)} · ` : "";
    if (prefix && b.caption?.startsWith(prefix)) beat.short = b.caption.slice(prefix.length);
    beats.push(beat);
    return beat;
  };

  /** The first edge this message leaves the origin on (where its dot waits at the start). */
  const firstSend = (id: number, from: number) =>
    steps.find((s, j) => j >= from && s.id === id && s.kind === "send" && s.via !== "reply");

  const open = (s: TraceStep, index: number): Track => {
    const node = s.node ?? trace.origin;
    const tr: Track = {
      id: s.id,
      type: s.type,
      node,
      ready: 0,
      real: s.t - t0,
      arrivedReal: s.t - t0,
      shown: true,
      fails: 0,
      replies: [],
      ended: false,
    };
    const out = firstSend(s.id, index);
    if (out?.edge) tr.anchor = { edge: out.edge, end: 0 };
    tracks.set(s.id, tr);
    reach(node);
    return tr;
  };

  /** Replies leave when the node's work ends; they never hold anything up. */
  const flushReplies = (tr: Track, at: number, realAt: number) => {
    for (const r of tr.replies) {
      if (!r.edge || reduced) continue;
      markEdge(r.edge);
      const until = (r.until ?? r.t) - t0;
      push({
        kind: "reply",
        msg: tr.id,
        type: r.type,
        edge: r.edge,
        reverse: true,
        start: at,
        duration: hop(r.edge) * PACING.replyFactor,
        realFrom: Math.min(realAt, until),
        realTo: until,
      });
    }
    tr.replies = [];
  };

  /** A node beat for `tr` (the dot sits at its anchor); returns the beat. */
  const atNode = (
    tr: Track,
    kind: BeatKind,
    duration: number,
    realFrom: number,
    realTo: number,
    extra: Partial<Beat> = {},
  ): Beat => {
    const beat = push({
      kind,
      msg: tr.id,
      type: tr.type,
      node: tr.node,
      anchor: tr.anchor,
      start: tr.ready,
      duration: len(duration),
      realFrom,
      realTo,
      ...extra,
    });
    tr.ready = beat.start + beat.duration;
    tr.real = realTo;
    return beat;
  };

  /** What a node did, in its own words: "route POST /orders", "Authorize payment", "write OrderPlaced". */
  const verb = (tr: Track, outgoing?: string): string => {
    const role = roleOf(tr.node);
    if (role === "store") return `write ${tr.type}`;
    // A consumer group's name ("group: orders-payments") isn't something the node does.
    const raw = tr.incoming ? edges.get(tr.incoming)?.label : undefined;
    const inLabel = raw && !/^group\s*:/i.test(raw) ? raw : undefined;
    const outLabel = outgoing ? edges.get(outgoing)?.label : undefined;
    if (role === "gateway" && outLabel) return `route ${outLabel}`;
    return inLabel || outLabel || "processing";
  };

  /** Types this message (and copies made from it here) leave with, when a node renamed it. */
  const renamesAfter = (tr: Track, index: number): { types: string[]; edge?: string } => {
    const at = steps[index].t;
    const ids = new Set([tr.id]);
    const out: string[] = [];
    let edge: string | undefined;
    for (let j = index + 1; j < steps.length && steps[j].t === at; j++) {
      const s = steps[j];
      if (s.kind === "copy" && s.parent !== undefined && ids.has(s.parent) && s.node === tr.node) ids.add(s.id);
      if (s.kind === "send" && s.via !== "reply" && ids.has(s.id) && s.node === tr.node) {
        edge ??= s.edge;
        if (s.type !== tr.type && !out.includes(s.type)) out.push(s.type);
      }
    }
    return { types: out, edge };
  };

  const nodeCaption = (tr: Track, what: string, ms: number | undefined, renamed: string[] = []) =>
    [name(tr.node), what, ms !== undefined && ms > 0 ? formatDuration(ms) : ""].filter(Boolean).join(" · ") +
    (renamed.length ? ` → ${renamed.join(", ")}` : "");

  /** Fold retries after the 2nd into one beat, then show the last trip back to the broker in full. */
  const flushCollapse = (tr: Track) => {
    const c = tr.collapse;
    if (!c) return;
    tr.collapse = undefined;
    const span = Math.max(0, c.toReal - c.fromReal);
    const beat = push({
      kind: "collapse",
      msg: tr.id,
      type: tr.type,
      node: c.node,
      anchor: c.anchor,
      start: tr.ready,
      duration: len(PACING.collapse),
      realFrom: c.fromReal,
      realTo: c.toReal,
      caption: `${name(c.node)} · ↺ retried ${c.count}× over ${formatDuration(span)}`,
      retries: c.count,
      tone: "warn",
      rowKey: c.rows[0],
    });
    tr.ready = beat.start + beat.duration;
    tr.real = c.toReal;
    for (const key of c.rows.slice(1)) rowAlias.set(key, beat.start);
    flushReplies(tr, tr.ready, tr.real);
    const r = c.lastRetry;
    if (r?.edge) travel([{ tr, step: r }], "retry");
  };
  const rowAlias = new Map<string, number>();

  /** Hops leaving together: one shared duration (the longest), common fate, no stagger. */
  const travel = (
    members: { tr: Track; step: TraceStep }[],
    kind: "travel" | "retry" | "dlq",
    depart?: number,
    copies = members.length,
  ) => {
    const shown = members.filter((m) => m.step.edge && edges.has(m.step.edge));
    if (!shown.length) return;
    const factor = kind === "dlq" ? PACING.dlqFactor : 1;
    const duration = len(Math.max(...shown.map((m) => hop(m.step.edge!))) * factor);
    const start = depart ?? Math.max(...shown.map((m) => m.tr.ready));
    shown.forEach((m, n) => {
      const { tr, step } = m;
      const edge = edges.get(step.edge!)!;
      markEdge(edge.id);
      const caption =
        kind === "retry"
          ? `${step.type} ↺`
          : kind === "dlq"
            ? `Dead-lettered after ${tr.deadletterAttempt ?? tr.fails} attempts`
            : copies > PACING.maxLanes
              ? n === 0
                ? `×${copies} ${step.type}`
                : undefined
              : step.type;
      const beat = push({
        kind,
        msg: tr.id,
        type: step.type,
        edge: edge.id,
        reverse: kind === "retry",
        start,
        duration,
        realFrom: step.t - t0,
        realTo: (step.until ?? step.t) - t0,
        caption,
        tone: kind === "retry" ? "warn" : kind === "dlq" ? "danger" : "plain",
      });
      tr.ready = start + duration;
      tr.real = beat.realTo;
      tr.type = step.type;
      tr.lastTravel = beat;
      if (kind === "retry") {
        // A retry trip has no arrival step: it's back at its broker (the edge's source) when it ends.
        tr.node = edge.from;
        tr.anchor = { edge: edge.id, end: 0 };
        tr.arrivedReal = tr.real;
        tr.startReal = undefined;
        reach(edge.from);
      }
    });
  };

  for (let i = 0; i < steps.length; i++) {
    if (consumed.has(i)) continue;
    const s = steps[i];
    const r = s.t - t0;
    if (hidden.has(s.id)) {
      if (s.kind === "copy" && s.parent !== undefined) hidden.add(s.id);
      continue;
    }
    if (s.kind === "copy") {
      const parent = s.parent !== undefined ? tracks.get(s.parent) : undefined;
      if (s.parent !== undefined && hidden.has(s.parent)) {
        hidden.add(s.id);
        continue;
      }
      const base = parent ?? open(s, i);
      tracks.set(s.id, {
        ...base,
        id: s.id,
        type: s.type,
        node: s.node ?? base.node,
        replies: [],
        collapse: undefined,
        lastTravel: undefined,
        fails: 0,
        ended: false,
      });
      continue;
    }
    let tr = tracks.get(s.id);
    if (!tr) {
      tr = open(s, i);
      if (s.kind !== "emit") {
        // Joined in flight: start where it was first seen.
        const b = atNode(tr, "establish", PACING.establish, r, r, {
          caption: `${name(tr.node)} · ${s.type} (joined in flight)`,
        });
        b.realFrom = b.realTo = r;
      }
    }
    switch (s.kind) {
      case "emit": {
        atNode(tr, "establish", PACING.establish, r, r, {
          caption: `${name(tr.node)} sends ${s.type}`,
          rowKey: rowOf.get(i),
        });
        break;
      }
      case "arrive": {
        tr.node = s.node ?? tr.node;
        tr.real = r;
        tr.arrivedReal = r;
        tr.incoming = s.edge;
        tr.startReal = undefined;
        tr.type = s.type;
        reach(tr.node);
        if (s.edge) tr.anchor = { edge: s.edge, end: tr.lastTravel?.reverse ? 0 : 1 };
        if (tr.collapse) {
          const row = rowOf.get(i);
          if (row) tr.collapse.rows.push(row);
          break;
        }
        if (tr.lastTravel && tr.lastTravel.rowKey === undefined) tr.lastTravel.rowKey = rowOf.get(i);
        break;
      }
      case "start": {
        if (tr.collapse) {
          tr.startReal = r;
          break;
        }
        const waited = r - tr.arrivedReal;
        if (waited > PACING.waitThreshold)
          atNode(tr, "wait", waitDwell(waited), tr.arrivedReal, r, {
            caption: `${name(tr.node)} · waited ${formatDuration(waited)}`,
          });
        tr.startReal = r;
        tr.real = r;
        break;
      }
      case "done": {
        if (tr.collapse) {
          if (tr.collapse.node === s.node) flushCollapse(tr);
          else break;
        }
        const role = roleOf(tr.node);
        const isOrigin = tr.node === trace.origin && r === 0 && tr.id === trace.rootId && tr.startReal === undefined;
        if (isOrigin) break;
        const rename = renamesAfter(tr, i);
        if (tr.startReal !== undefined || !BROKERS.has(role)) {
          const ms = tr.startReal !== undefined ? r - tr.startReal : 0;
          const store = role === "store";
          const dwell = processDwell(ms);
          atNode(tr, store ? "write" : "process", dwell + (store ? PACING.sink : 0), tr.startReal ?? r, r, {
            caption: nodeCaption(tr, verb(tr, rename.edge), ms, rename.types),
            sink: store ? (reduced ? PACING.reducedFade : PACING.sink) : undefined,
          });
        } else {
          const parked = steps.some((x, j) => j > i && x.id === s.id && x.kind === "park" && x.node === s.node);
          atNode(tr, "append", PACING.append, r, r, {
            // A topic or stream nobody reads keeps it (lag is per consumer group, and it has none); a queue holds it.
            caption: parked
              ? role === "queue"
                ? `parked in ${name(tr.node)}`
                : `kept in ${name(tr.node)}: nobody reads it`
              : role === "queue"
                ? `queued in ${name(tr.node)}`
                : `appended to ${name(tr.node)}`,
          });
        }
        tr.startReal = undefined;
        flushReplies(tr, tr.ready, tr.real);
        break;
      }
      case "fail": {
        tr.fails++;
        if (tr.collapse) {
          tr.collapse.count++;
          tr.collapse.toReal = r;
          break;
        }
        const from = tr.startReal ?? tr.arrivedReal;
        if (tr.fails > PACING.retriesShown) {
          const row = rowOf.get(i);
          tr.collapse = {
            node: tr.node,
            anchor: tr.anchor,
            fromReal: from,
            toReal: r,
            count: 1,
            rows: row ? [row] : [],
          };
          break;
        }
        atNode(tr, "fail", processDwell(r - from), from, r, {
          caption: nodeCaption(tr, `attempt ${s.attempt ?? tr.fails} failed`, r - from),
          tone: "warn",
          rowKey: rowOf.get(i),
        });
        // In-place retries start again at once.
        tr.startReal = r;
        flushReplies(tr, tr.ready, tr.real);
        break;
      }
      case "retry":
        break;
      case "send": {
        if (s.via === "reply") {
          tr.replies.push(s);
          break;
        }
        if (s.via === "retry") {
          if (tr.collapse) {
            tr.collapse.lastRetry = s;
            tr.collapse.toReal = r;
            const edge = s.edge ? edges.get(s.edge) : undefined;
            if (edge) {
              tr.node = edge.from;
              tr.anchor = { edge: edge.id, end: 0 };
            }
            tr.arrivedReal = (s.until ?? s.t) - t0;
            break;
          }
          travel([{ tr, step: s }], "retry");
          break;
        }
        if (tr.collapse) {
          const c = tr.collapse;
          // Redelivered to the same consumer: still part of the folded retries.
          if (s.via === "message" && c.lastRetry && s.edge === c.lastRetry.edge) {
            c.lastRetry = undefined;
            c.toReal = r;
            break;
          }
          flushCollapse(tr);
        }
        // Everything leaving this node at this moment goes together.
        const group: { tr: Track; step: TraceStep }[] = [];
        for (let j = i; j < steps.length && steps[j].t === s.t; j++) {
          const x = steps[j];
          if (consumed.has(j) || x.kind !== "send" || x.via === "reply" || x.via === "retry") continue;
          if (x.node !== s.node || (x.via ?? "message") !== (s.via ?? "message")) continue;
          const t = tracks.get(x.id);
          if (!t || hidden.has(x.id) || t.collapse) continue;
          consumed.add(j);
          group.push({ tr: t, step: x });
        }
        if (group.length > PACING.maxLanes) {
          for (const m of group.slice(PACING.maxLanes)) {
            hidden.add(m.tr.id);
            m.tr.shown = false;
          }
          hiddenCopies += group.length - PACING.maxLanes;
        }
        const lanes = group.slice(0, PACING.maxLanes);
        // A broker's lag (or a node's queue) before it leaves.
        for (const m of lanes) {
          const waited = r - m.tr.real;
          if (waited > PACING.waitThreshold && m.tr.node !== trace.origin)
            atNode(m.tr, "wait", waitDwell(waited), m.tr.real, r, {
              caption: `${name(m.tr.node)} · waited ${formatDuration(waited)}`,
            });
        }
        let depart: number | undefined;
        if (group.length > 1) {
          const lead = lanes[0].tr;
          const start = Math.max(...lanes.map((m) => m.tr.ready));
          const split = push({
            kind: "split",
            msg: lead.id,
            type: lead.type,
            node: s.node,
            anchor: lead.anchor,
            start,
            duration: reduced ? 0 : PACING.split,
            realFrom: r,
            realTo: r,
            lanes: lanes.map((m) => m.step.edge!).filter(Boolean),
            copies: group.length,
          });
          depart = split.start + split.duration;
        }
        travel(lanes, s.via === "dlq" ? "dlq" : "travel", depart, group.length);
        break;
      }
      case "deadletter": {
        flushCollapse(tr);
        tr.deadletterAttempt = s.attempt;
        tr.node = s.node ?? tr.node;
        break;
      }
      case "drop": {
        flushCollapse(tr);
        atNode(tr, "drop", PACING.drop, r, r, {
          caption: `Dropped · ${s.reason ?? "lost"}`,
          tone: "danger",
          rowKey: rowOf.get(i),
        });
        flushReplies(tr, tr.ready, tr.real);
        tr.ended = true;
        break;
      }
      case "block": {
        flushCollapse(tr);
        atNode(tr, "block", PACING.drop, r, r, {
          caption: "Blocked by a deny rule",
          tone: "plain",
          rowKey: rowOf.get(i),
        });
        flushReplies(tr, tr.ready, tr.real);
        tr.ended = true;
        break;
      }
      case "park":
      case "end": {
        flushCollapse(tr);
        flushReplies(tr, tr.ready, tr.real);
        tr.ended = true;
        break;
      }
    }
  }

  // Anything still open (a cut-off trace) settles where it is.
  const open_ = [...tracks.values()].filter((t) => t.shown && !hidden.has(t.id));
  for (const t of open_) {
    flushCollapse(t);
    flushReplies(t, t.ready, t.real);
  }
  const waitingAt = open_.find((t) => !t.ended);

  // Deadletter rows tell the same moment as the dead-letter hop that follows them.
  const rowStart = new Map<string, number>();
  for (const b of beats) if (b.rowKey !== undefined && !rowStart.has(b.rowKey)) rowStart.set(b.rowKey, b.start);
  for (const [key, at] of rowAlias) if (!rowStart.has(key)) rowStart.set(key, at);
  steps.forEach((s, i) => {
    const row = rowOf.get(i);
    if (s.kind !== "deadletter" || !row || rowStart.has(row)) return;
    const next = beats.find((b) => b.kind === "dlq" && b.msg === s.id && b.realFrom >= s.t - t0);
    if (next) rowStart.set(row, next.start);
  });

  const lastEnd = beats.reduce((m, b) => Math.max(m, b.kind === "reply" ? 0 : b.start + b.duration), 0);
  const replyEnd = beats.reduce((m, b) => Math.max(m, b.start + b.duration), 0);
  const realTotal = Math.max(0, (trace.done ? (trace.endedAt ?? t0) : (steps.at(-1)?.t ?? t0)) - t0);
  const copies = new Set(steps.map((s) => s.id)).size - 1;
  const writes = steps.filter((s) => s.kind === "arrive" && s.node && roleOf(s.node) === "store").length;
  const deadLettered = steps.some((s) => s.kind === "deadletter");
  const dropped = steps.some((s) => s.kind === "drop");
  const blocked = steps.some((s) => s.kind === "block");
  const keptAt = steps.find((s) => s.kind === "park" && s.node && roleOf(s.node) !== "queue")?.node;
  const facts = [
    formatDuration(realTotal),
    copies > 0 ? `${copies} ${copies === 1 ? "copy" : "copies"}` : "",
    writes > 0 ? `${writes} ${writes === 1 ? "write" : "writes"}` : "",
  ].filter(Boolean);
  let summary: string;
  const unfinished = !trace.done;
  if (unfinished) {
    const where = waitingAt?.node ?? steps.at(-1)?.node ?? trace.origin;
    const lag = input.waiting?.lag(where);
    // Lag belongs to a topic's consumer groups; a queue's messages are queued, a service's are waiting.
    const role = roleOf(where);
    const n = lag?.toLocaleString("en-US");
    const held = role === "topic" || role === "stream" ? `lag ${n}` : `${n} ${role === "queue" ? "queued" : "waiting"}`;
    summary = `Still waiting at ${name(where)}${lag !== undefined && lag > 0 ? ` · ${held}` : ""}`;
  } else
    summary = [
      deadLettered
        ? "Dead-lettered"
        : dropped
          ? "Dropped"
          : blocked
            ? "Blocked by a deny rule"
            : keptAt
              ? `Kept in ${name(keptAt)}, unread`
              : "Done",
      ...facts,
    ].join(" · ");
  const lastNode =
    [...beats].reverse().find((b) => b.kind !== "reply" && b.start + b.duration >= lastEnd - 1 && b.node)?.node ??
    trace.origin;
  const endBeat = push({
    kind: "end",
    msg: trace.rootId,
    type: trace.type,
    node: waitingAt?.node ?? lastNode,
    start: Math.max(lastEnd, Math.min(replyEnd, lastEnd + 400)),
    duration: len(PACING.end),
    realFrom: realTotal,
    realTo: realTotal,
    caption: summary,
    tone:
      unfinished || deadLettered || dropped
        ? deadLettered || dropped
          ? "danger"
          : "warn"
        : blocked
          ? "plain"
          : "done",
  });
  const duration = endBeat.start + endBeat.duration;
  const stops = [...new Set(beats.filter((b) => HOPS.has(b.kind)).map((b) => Math.round(b.start)))].sort(
    (a, b) => a - b,
  );
  return {
    rootId: trace.rootId,
    type: trace.type,
    origin: trace.origin,
    beats,
    duration,
    realTotal,
    stops,
    rowStart,
    nodes: visitedNodes,
    edges: usedEdges,
    hiddenCopies,
    unfinished,
    summary,
    reduced,
  };
}

// ---------------------------------------------------------------- frames

export interface SlowDot {
  key: string;
  msg: number;
  kind: "message" | "reply" | "retry" | "dlq";
  color: string;
  /** On an edge: eased progress from the edge's source (already reversed for retries and replies). */
  edge?: string;
  progress?: number;
  /** At a node: where it sits. */
  anchor?: Anchor;
  /** 0..1 size (lift-off grows it, a write shrinks it) and opacity. */
  scale: number;
  alpha: number;
  trail: boolean;
}

export interface SlowRing {
  node: string;
  /** 0..1: how much of the work is done (fills linearly). */
  progress: number;
  color: string;
  tone: Tone;
  /** 0..1 strength (fades in and out). */
  alpha: number;
}

export interface SlowFlash {
  node: string;
  color: string;
  /** 0..1 through the flash. */
  age: number;
  kind: "write" | "drop" | "fail";
}

export interface SlowCaption {
  key: string;
  text: string;
  /** A shorter version (without the node's name) for a crowded spot. */
  short?: string;
  tone: Tone;
  priority: number;
  /** Compact badge for a folded retry beat. */
  chip?: boolean;
  /** Beside a moving dot, or at a node's dot. */
  edge?: string;
  progress?: number;
  anchor?: Anchor;
  node?: string;
  color: string;
}

export interface SlowFrame {
  t: number;
  /** Journey time in real ms at this moment. */
  real: number;
  dots: SlowDot[];
  rings: SlowRing[];
  flashes: SlowFlash[];
  /** Ghost dots queued ahead of a waiting one. */
  queues: { anchor: Anchor; color: string; alpha: number }[];
  /** Edges a dot is travelling on (they brighten). */
  lit: { edge: string; color: string; alpha: number }[];
  landings: { edge: string; end: 0 | 1; color: string; age: number }[];
  captions: SlowCaption[];
  /** Nodes reached so far with their real offset (ms). */
  visited: { node: string; real: number }[];
  /** The trace card row being told (the latest started), and every row in progress. */
  currentRow?: string;
  activeRows: string[];
  /** Dots moving along edges (replies aside). */
  moving: number;
  /** A hop is under way (the camera never pans then). */
  travelling: boolean;
  /** Nodes in play now and where moving dots are going: what a following camera frames. */
  frontier: string[];
  /** The latest beat that has started. */
  beat: number;
  done: boolean;
}

const PRIORITY: Record<BeatKind, number> = {
  end: 6,
  dlq: 5,
  drop: 5,
  block: 5,
  fail: 4,
  collapse: 4,
  retry: 3,
  process: 3,
  write: 3,
  wait: 3,
  append: 3,
  establish: 3,
  split: 2,
  travel: 2,
  reply: 0,
};

/** What to draw at script time `t`. */
export function frameAt(script: SlowScript, t: number, diagram?: DiagramLike): SlowFrame {
  const time = clamp(t, 0, script.duration);
  const reduced = script.reduced;
  const edges = diagram ? new Map(diagram.edges.map((e) => [e.id, e])) : undefined;
  const frame: SlowFrame = {
    t: time,
    real: 0,
    dots: [],
    rings: [],
    flashes: [],
    queues: [],
    lit: [],
    landings: [],
    captions: [],
    visited: [],
    activeRows: [],
    moving: 0,
    travelling: false,
    frontier: [],
    beat: -1,
    done: time >= script.duration,
  };
  const frontier = new Set<string>();
  const visited = new Map<string, number>();
  let currentStart = -Infinity;
  let rowAt = -Infinity;
  for (const b of script.beats) {
    if (b.start > time) continue;
    const end = b.start + b.duration;
    const local = time - b.start;
    const f = b.duration > 0 ? clamp(local / b.duration, 0, 1) : 1;
    const active = time < end || (b.kind === "end" && time <= end);
    if (b.kind !== "reply") {
      frame.real = Math.max(frame.real, b.realFrom + (b.realTo - b.realFrom) * f);
      if (b.start >= currentStart) {
        currentStart = b.start;
        frame.beat = b.i;
      }
    }
    if (b.rowKey !== undefined) {
      if (b.start >= rowAt) {
        rowAt = b.start;
        frame.currentRow = b.rowKey;
      }
      if (active) frame.activeRows.push(b.rowKey);
    }
    if (b.node && b.kind !== "end" && !TRAVELS.has(b.kind) && !visited.has(b.node)) visited.set(b.node, b.realFrom);
    if (TRAVELS.has(b.kind) && b.edge && edges && time >= end && b.kind !== "reply") {
      const e = edges.get(b.edge);
      const target = b.reverse ? e?.from : e?.to;
      if (target && !visited.has(target)) visited.set(target, b.realTo);
    }
    // Arrival rings just after a hop lands.
    if (TRAVELS.has(b.kind) && b.edge && b.kind !== "reply" && !reduced) {
      const since = time - end;
      if (since >= -PACING.landing && since < PACING.landing + 150)
        frame.landings.push({
          edge: b.edge,
          end: b.reverse ? 0 : 1,
          color: b.color,
          age: clamp((since + PACING.landing) / (PACING.landing * 2 + 150), 0, 1),
        });
    }
    if (!active) {
      // A finished write keeps its flash a moment; a failure flashes as it ends.
      const after = time - end;
      if (b.kind === "fail" && b.node && after < 450 && !reduced)
        frame.flashes.push({ node: b.node, color: b.color, age: after / 450, kind: "fail" });
      continue;
    }
    if (b.node) frontier.add(b.node);
    switch (b.kind) {
      case "travel":
      case "retry":
      case "dlq":
      case "reply": {
        if (!b.edge) break;
        const e = edges?.get(b.edge);
        if (e) frontier.add(b.reverse ? e.from : e.to);
        const kind = b.kind === "travel" ? "message" : b.kind;
        const toward = (p: number) => (b.reverse ? 1 - p : p);
        if (reduced) {
          // A still state: cross-fade from where it was to where it's going.
          const fade = clamp(local / PACING.reducedFade, 0, 1);
          if (fade < 1)
            frame.dots.push({
              key: `${b.i}:from`,
              msg: b.msg,
              kind,
              color: b.color,
              edge: b.edge,
              progress: toward(0),
              scale: 1,
              alpha: 1 - fade,
              trail: false,
            });
          frame.dots.push({
            key: `${b.i}`,
            msg: b.msg,
            kind,
            color: b.color,
            edge: b.edge,
            progress: toward(1),
            scale: 1,
            alpha: fade,
            trail: false,
          });
        } else {
          const p = easeInOutCubic(f);
          const grow = b.kind === "reply" ? 1 : clamp(local / PACING.liftOff, 0, 1);
          frame.dots.push({
            key: `${b.i}`,
            msg: b.msg,
            kind,
            color: b.color,
            edge: b.edge,
            progress: toward(p),
            scale: (b.kind === "reply" ? 0.6 : 1) * (0.25 + 0.75 * grow),
            alpha: b.kind === "reply" ? 0.55 : 1,
            trail: b.kind !== "reply",
          });
        }
        if (b.kind !== "reply") {
          frame.moving++;
          frame.travelling = true;
          const fadeIn = clamp(local / PACING.liftOff, 0, 1);
          const fadeOut = clamp((end - time) / PACING.landing, 0, 1);
          frame.lit.push({ edge: b.edge, color: b.color, alpha: Math.min(fadeIn, fadeOut) });
          if (b.caption)
            frame.captions.push({
              key: `b${b.i}`,
              text: b.caption,
              tone: b.tone,
              priority: PRIORITY[b.kind],
              edge: b.edge,
              progress: toward(reduced ? 1 : easeInOutCubic(f)),
              color: b.color,
            });
        }
        break;
      }
      case "split": {
        (b.lanes ?? []).forEach((lane, n) =>
          frame.dots.push({
            key: `${b.i}:${n}`,
            msg: b.msg,
            kind: "message",
            color: b.color,
            anchor: { edge: lane, end: 0 },
            scale: 0.4 + 0.6 * f,
            alpha: 0.5 + 0.5 * f,
            trail: false,
          }),
        );
        if (b.copies && b.copies > PACING.maxLanes)
          frame.captions.push({
            key: `b${b.i}`,
            text: `×${b.copies} ${b.type}`,
            tone: "plain",
            priority: PRIORITY.split,
            anchor: b.anchor,
            node: b.node,
            color: b.color,
          });
        break;
      }
      case "end":
        if (b.caption)
          frame.captions.push({
            key: `b${b.i}`,
            text: b.caption,
            tone: b.tone,
            priority: PRIORITY.end,
            node: b.node,
            color: b.color,
          });
        break;
      default: {
        if (b.kind === "collapse")
          frame.captions.push({
            key: `retry:${b.i}`,
            text: `↻ ×${b.retries}`,
            tone: "warn",
            priority: PRIORITY.collapse + 1,
            chip: true,
            node: b.node,
            anchor: b.anchor,
            color: b.color,
          });
        // The dot sits at the node while it works, waits, appends, splits or fails.
        const sinkFrom = b.sink ? b.duration - b.sink : Infinity;
        const sinking = local >= sinkFrom ? clamp((local - sinkFrom) / (b.sink ?? 1), 0, 1) : 0;
        const fading =
          b.kind === "drop" || b.kind === "block" ? (reduced ? clamp(local / PACING.reducedFade, 0, 1) : f) : sinking;
        if (b.anchor)
          frame.dots.push({
            key: `${b.i}`,
            msg: b.msg,
            kind: b.tone === "warn" ? "retry" : b.tone === "danger" ? "dlq" : "message",
            color: b.color,
            anchor: b.anchor,
            // Reduced motion: a still dot that only fades (no growing in, no shrinking into a store).
            scale: reduced ? 1 : b.kind === "establish" ? 0.4 + 0.6 * clamp(local / 300, 0, 1) : 1 - 0.7 * sinking,
            alpha: 1 - fading,
            trail: false,
          });
        if (b.node && b.kind !== "wait" && b.kind !== "drop" && b.kind !== "block") {
          const work =
            b.kind === "establish"
              ? 1
              : clamp(local / Math.max(1, sinkFrom === Infinity ? b.duration : sinkFrom), 0, 1);
          // Reduced motion: a whole, steady ring (it doesn't fill or pulse).
          frame.rings.push({
            node: b.node,
            progress: reduced ? 1 : work,
            color: b.color,
            tone: b.tone,
            alpha: b.kind === "establish" ? (reduced ? 1 : 0.6 + 0.4 * Math.sin(Math.PI * f)) : 1 - sinking * 0.6,
          });
        }
        if (b.kind === "wait" && b.anchor) frame.queues.push({ anchor: b.anchor, color: b.color, alpha: 1 });
        if (b.kind === "write" && b.node && sinking > 0)
          frame.flashes.push({ node: b.node, color: b.color, age: sinking, kind: "write" });
        if (b.kind === "drop" && b.node)
          frame.flashes.push({ node: b.node, color: b.color, age: reduced ? 0 : f, kind: "drop" });
        if (b.caption)
          frame.captions.push({
            key: `b${b.i}`,
            text: b.caption,
            short: b.short,
            tone: b.tone,
            priority: PRIORITY[b.kind],
            anchor: b.anchor,
            node: b.node,
            color: b.color,
          });
      }
    }
  }
  frame.frontier = [...frontier];
  frame.visited = [...visited].map(([node, real]) => ({ node, real }));
  if (frame.done) frame.real = Math.max(frame.real, script.realTotal);
  return frame;
}

/** The next (+1) or previous (-1) hop from `t`: where ← and → land. */
export function stepStop(script: SlowScript, t: number, dir: 1 | -1): number {
  const stops = script.stops;
  if (dir > 0) return stops.find((s) => s > t + 1) ?? script.duration;
  // Just past a hop's start, ← goes to the one before it (like a media player's previous track).
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < t - 250) return stops[i];
  return 0;
}
