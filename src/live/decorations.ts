// Live decorations on the real canvas DOM, applied imperatively at the UI clock (~8 Hz): status,
// heat and dimming on node wrappers, active / idle on edges. Only `data-live-*` attributes are
// written, which React Flow never touches, so a node or edge re-render doesn't wipe them. Styling
// lives in live.css.

import type { SimSnapshot } from "../sim/types";
import { heatOf } from "./format";
import { snapshotContinuity } from "./snapshotContinuity";

export interface DecorationInput {
  snapshot: SimSnapshot;
  /** When set, everything outside these nodes / edges is dimmed (narration focus, path trace). */
  spotlight: { nodes: ReadonlySet<string>; edges: ReadonlySet<string>; kind: "focus" | "trace" } | null;
  /** The simulation isn't moving (paused, a note waiting, slow motion): the marching edges stop too. */
  still?: boolean;
}

const RISE_WINDOW = 8; // samples (~1 s at 8 Hz)

/**
 * Publishes an edge stays marked active after its last message: three at 8 Hz, about 0.4 s. A busy edge between two
 * messages then reads as busy instead of flickering idle and back on every publish, and at high traffic far fewer
 * edges change class per publish (each change restyles the edge). Presentation only: the snapshot, the engine and
 * everything the checks read still say whether a message is on the edge right now.
 */
export const EDGE_HOLD = 3;

/**
 * Above this many decorated nodes and edges, the canvas gets `data-live-large` and live.css drops the per-element
 * fades (opacity and filter on nodes, edges and labels; the heat glow's box-shadow). Every running fade is animated
 * on its own, and at high traffic hundreds of edges change at once: among thousands of nodes that multiplied the
 * compositor's layers and its per-frame cost (docs/BENCHMARKS.md § Live view on large diagrams). Diagrams drawn by
 * hand stay far below it and look as they did.
 */
export const LARGE_LIVE_ELEMENTS = 1_000;

/** What the decorator did: cheap counters, read by the benchmarks. */
export interface DecorationStats {
  /** apply() calls. */
  applies: number;
  /** apply() calls on a simulation clock that moved: what an edge's hold counts in. */
  publishes: number;
  /** Edges that changed between active and idle. */
  edgeFlips: number;
  /** Nodes and edges decorated by the last apply(). */
  elements: number;
  /** More than LARGE_LIVE_ELEMENTS: the fades are dropped (data-live-large). */
  large: boolean;
}

export class Decorator {
  private applied = new Map<Element, string>();
  private history = new Map<string, number[]>();
  /** Edge id → the publish it last carried a message in (dropped once its hold ends). */
  private lastActive = new Map<string, number>();
  private lastTime = NaN;
  private continuity: object | undefined;
  readonly stats: DecorationStats = { applies: 0, publishes: 0, edgeFlips: 0, elements: 0, large: false };

  constructor(private root: HTMLElement) {}

  apply({ snapshot, spotlight, still }: DecorationInput): void {
    const root = this.root;
    const stats = this.stats;
    stats.applies++;
    // A seek in either direction or a rebuilt/replayed run starts a new presentation interval.
    const continuity = snapshotContinuity.get(snapshot);
    if (continuity !== this.continuity || snapshot.time < this.lastTime) this.lastActive.clear();
    this.continuity = continuity;
    // Holds count publishes of a moving simulation: while it stands still, every edge keeps its state.
    if (!still && snapshot.time !== this.lastTime) stats.publishes++;
    this.lastTime = snapshot.time;
    const publish = stats.publishes;
    setAttr(root, "data-live", "on");
    setAttr(root, "data-live-spotlight", spotlight?.kind ?? null);
    setAttr(root, "data-live-still", still ? "1" : null);
    const seen = new Set<Element>();
    let elements = 0;

    for (const el of root.querySelectorAll<HTMLElement>(".react-flow__node-diagram[data-id]")) {
      const id = el.dataset.id!;
      const n = snapshot.nodes[id];
      if (!n) continue;
      elements++;
      const hist = this.history.get(id) ?? [];
      hist.push(n.backlog);
      if (hist.length > RISE_WINDOW) hist.shift();
      this.history.set(id, hist);
      // A topic nobody reads keeps what's published: a faint tint, never the rising glow of a consumer falling behind.
      const kept = !!n.noConsumer && n.role !== "queue";
      const rising = !kept && n.backlog > 0 && hist.length > 1 && n.backlog > hist[0];
      const heat = n.backlog > 0 ? (kept ? 1 : Math.max(1, Math.ceil(heatOf(n.backlog) * 3))) : 0;
      const dim = spotlight ? !spotlight.nodes.has(id) : false;
      const key = `${n.status}|${heat}|${rising}|${dim}`;
      seen.add(el);
      if (this.applied.get(el) === key) continue;
      this.applied.set(el, key);
      setAttr(el, "data-live-status", n.status);
      setAttr(el, "data-live-heat", heat ? String(heat) : null);
      setAttr(el, "data-live-rising", rising ? "1" : null);
      setAttr(el, "data-live-dim", dim ? "1" : null);
    }

    const downBoundaries = new Set((snapshot.faults ?? []).flatMap((f) => (f.kind === "boundary" ? [f.boundary] : [])));
    const cutLinks = new Set((snapshot.faults ?? []).flatMap((f) => (f.kind === "link" ? [f.edge] : [])));
    for (const el of root.querySelectorAll<HTMLElement>(".grp[data-caption-root]")) {
      const down = downBoundaries.has(el.dataset.captionRoot!);
      setAttr(el, "data-live-status", down ? "down" : null);
    }

    for (const el of root.querySelectorAll<SVGElement>(".react-flow__edge[data-id]")) {
      const id = el.getAttribute("data-id")!;
      const e = snapshot.edges[id];
      elements++;
      if (e && e.active > 0) this.lastActive.set(id, publish);
      const since = this.lastActive.get(id);
      const active = since !== undefined && publish - since <= EDGE_HOLD;
      if (since !== undefined && !active) this.lastActive.delete(id);
      const dim = spotlight ? !spotlight.edges.has(id) : false;
      const lit = spotlight?.kind === "trace" && spotlight.edges.has(id);
      const cut = cutLinks.has(id);
      const key = `${active}|${dim}|${lit}|${cut}`;
      seen.add(el);
      if (this.applied.get(el) === key) continue;
      this.applied.set(el, key);
      const state = active ? "active" : "idle";
      const was = el.getAttribute("data-live-edge");
      if (was !== null && was !== state) stats.edgeFlips++;
      setAttr(el, "data-live-cut", cut ? "1" : null);
      setAttr(el, "data-live-edge", state);
      setAttr(el, "data-live-dim", dim ? "1" : null);
      setAttr(el, "data-live-trace", lit ? "1" : null);
    }

    stats.elements = elements;
    stats.large = elements > LARGE_LIVE_ELEMENTS;
    setAttr(root, "data-live-large", stats.large ? "1" : null);

    // Elements that went away (deleted, remounted) shouldn't keep a stale cache entry.
    for (const el of this.applied.keys()) if (!seen.has(el)) this.applied.delete(el);
  }

  /** Remove every live attribute (leaving live mode). */
  clear(): void {
    const root = this.root;
    for (const a of ["data-live", "data-live-spotlight", "data-live-still", "data-live-large"]) root.removeAttribute(a);
    for (const el of root.querySelectorAll(
      "[data-live-cut],[data-live-status],[data-live-edge],[data-live-dim],[data-live-heat],[data-live-trace],[data-live-rising]",
    )) {
      for (const a of [
        "data-live-cut",
        "data-live-status",
        "data-live-edge",
        "data-live-dim",
        "data-live-heat",
        "data-live-trace",
        "data-live-rising",
      ])
        el.removeAttribute(a);
    }
    this.applied.clear();
    this.history.clear();
    this.lastActive.clear();
    this.lastTime = NaN;
    this.continuity = undefined;
  }
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
