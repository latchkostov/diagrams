import { mainRateThreshold } from "./overviewInk";
// Live decorations on the real canvas DOM, applied imperatively at the UI clock (~8 Hz): status,
// heat and dimming on node wrappers, active / idle on edges. Only `data-live-*` attributes are
// written, which React Flow never touches, so a node or edge re-render doesn't wipe them. Styling
// lives in live.css.

import type { SimSnapshot } from "../sim/types";
import { currentHealth } from "./healthWindow";
import { heatOf } from "./format";
import { snapshotContinuity } from "./snapshotContinuity";
import { loadOnce } from "../lib/lazyLoad";

/** Faults and the calm view's ink, downloaded with the first decoration (a failed download retries on the next). */
let chipInk: typeof import("./chipInk") | undefined;
export const loadChipInk = loadOnce(async () => (chipInk = await import("./chipInk")));
const DECORATED = ".react-flow__node-diagram[data-id], .grp[data-caption-root], .react-flow__edge[data-id]";

export interface DecorationInput {
  zones?: ReadonlyMap<string, readonly string[]>;
  snapshot: SimSnapshot;
  /** Controller-observed real-unit readings, including the history restored by a seek. */
  health: Pick<SimSnapshot, "nodes">;
  /** When set, everything outside these nodes / edges is dimmed (narration focus, path trace). */
  spotlight: { nodes: ReadonlySet<string>; edges: ReadonlySet<string>; kind: "focus" | "trace" } | null;
  /** The simulation isn't moving (paused, a note waiting, slow motion): the marching edges stop too. */
  still?: boolean;
}

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
  #root: HTMLElement;

  #delivered = new Map<string, number>();
  #rates = new Map<string, number>();
  #applied = new Map<Element, string>();
  /** Edge id → the publish it last carried a message in (dropped once its hold ends). */
  #lastActive = new Map<string, number>();
  #lastTime = NaN;
  #continuity: object | undefined;
  readonly stats: DecorationStats = { applies: 0, publishes: 0, edgeFlips: 0, elements: 0, large: false };

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  apply(input: DecorationInput): void {
    const { snapshot, health, spotlight, still } = input;
    const root = this.#root;
    if (!chipInk) loadChipInk().catch(Boolean);
    // One membership read before any decoration writes; never three whole-canvas selector walks.
    const nodes: HTMLElement[] = [],
      boundaries: HTMLElement[] = [],
      edges: HTMLElement[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(DECORATED)) {
      if (el.dataset.captionRoot) boundaries.push(el);
      else if (el.classList.contains("react-flow__node-diagram")) nodes.push(el);
      else edges.push(el);
    }
    const stats = this.stats;
    stats.applies++;
    // A seek in either direction or a rebuilt/replayed run starts a new presentation interval.
    const continuity = snapshotContinuity.get(snapshot);
    const reset = continuity !== this.#continuity || snapshot.time < this.#lastTime;
    if (reset) {
      this.#lastActive.clear();
      this.#delivered.clear();
      this.#rates.clear();
    }
    const interval = snapshot.time - (reset ? 0 : this.#lastTime || 0);
    if (interval > 0) {
      for (const edge of Object.values(snapshot.edges)) {
        this.#rates.set(edge.id, (Math.max(0, edge.delivered - (this.#delivered.get(edge.id) ?? 0)) * 1000) / interval);
        this.#delivered.set(edge.id, edge.delivered);
      }
    }
    const mainThreshold = mainRateThreshold([...this.#rates.values()]);
    this.#continuity = continuity;
    // Holds count publishes of a moving simulation: while it stands still, every edge keeps its state.
    if (!still && snapshot.time !== this.#lastTime) stats.publishes++;
    this.#lastTime = snapshot.time;
    const publish = stats.publishes;
    setAttr(root, "data-live", "on");
    setAttr(root, "data-live-spotlight", spotlight?.kind ?? null);
    setAttr(root, "data-live-still", still ? "1" : null);
    const seen = new Set<Element>();
    let elements = 0;

    for (const el of nodes) {
      const id = el.dataset.id!;
      const n = snapshot.nodes[id];
      if (!n) continue;
      elements++;
      // Unread retained messages stay neutral; attention needs sustained queue growth.
      const kept = !!n.noConsumer && n.role !== "queue";
      const rising = !kept && currentHealth(health.nodes[id]).growing;
      const heat = rising ? Math.max(1, Math.ceil(heatOf(n.backlog) * 3)) : kept && n.backlog > 0 ? 1 : 0;
      const dim = spotlight ? !spotlight.nodes.has(id) : false;
      const key = `${n.status}|${heat}|${rising}|${dim}`;
      seen.add(el);
      if (this.#applied.get(el) === key) continue;
      this.#applied.set(el, key);
      setAttr(el, "data-live-status", n.status);
      setAttr(el, "data-live-heat", heat ? String(heat) : null);
      setAttr(el, "data-live-rising", rising ? "1" : null);
      setAttr(el, "data-live-dim", dim ? "1" : null);
    }

    chipInk?.decorate(nodes, root, edges, boundaries, input, this.#rates);

    for (const el of edges) {
      const id = el.dataset.id!;
      const e = snapshot.edges[id];
      elements++;
      if (e && e.active > 0) this.#lastActive.set(id, publish);
      const since = this.#lastActive.get(id);
      const active = since !== undefined && publish - since <= EDGE_HOLD;
      if (since !== undefined && !active) this.#lastActive.delete(id);
      const dim = spotlight ? !spotlight.edges.has(id) : false;
      const lit = spotlight?.kind === "trace" && spotlight.edges.has(id);
      const main = (this.#rates.get(id) ?? 0) >= mainThreshold;
      const key = `${active}|${dim}|${lit}|${main}`;
      seen.add(el);
      if (this.#applied.get(el) === key) continue;
      this.#applied.set(el, key);
      const state = active ? "active" : "idle";
      const was = el.getAttribute("data-live-edge");
      if (was !== null && was !== state) stats.edgeFlips++;
      setAttr(el, "data-live-edge", state);
      setAttr(el, "data-live-main", main ? "1" : null);
      setAttr(el, "data-live-dim", dim ? "1" : null);
      setAttr(el, "data-live-trace", lit ? "1" : null);
    }

    stats.elements = elements;
    stats.large = elements > LARGE_LIVE_ELEMENTS;
    setAttr(root, "data-live-large", stats.large ? "1" : null);

    // Elements that went away (deleted, remounted) shouldn't keep a stale cache entry.
    for (const el of this.#applied.keys()) if (!seen.has(el)) this.#applied.delete(el);
  }

  /** Remove every live attribute (leaving live mode). */
  clear(): void {
    const root = this.#root;
    for (const a of ["data-live", "data-live-spotlight", "data-live-still", "data-live-large"]) root.removeAttribute(a);
    for (const el of root.querySelectorAll(DECORATED)) {
      for (const a of [
        "data-live-status",
        "data-live-main",
        "data-live-edge",
        "data-live-dim",
        "data-live-heat",
        "data-live-trace",
        "data-live-rising",
      ])
        el.removeAttribute(a);
    }
    chipInk?.clear(root);
    this.#applied.clear();
    this.#lastActive.clear();
    this.#lastTime = NaN;
    this.#continuity = undefined;
  }
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (el.getAttribute(name) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}
