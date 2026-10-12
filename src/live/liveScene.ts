// What the particle renderer needs from the page, read on the main thread: edge paths sampled in flow
// coordinates, node boxes, label obstacles and the view. Both render paths read it (the fallback
// directly, the worker through messages, see liveRenderer.ts), and it reads the DOM only when
// something changed: a MutationObserver marks the paths dirty when an edge's `d` changes or edges
// mount, so a frame with nothing new costs a flag check.
//
// Sampling is lazy and bounded. A scan only reads each edge's `d`; an edge is sampled the first time
// the renderer needs it (a particle rides it, or slow motion replays along it), so dependency edges
// and edges with no traffic never are. Each path gets at most MAX_SEGMENTS samples (longer paths are
// sampled more coarsely), and a frame spends at most SAMPLE_BUDGET point queries: what doesn't fit
// waits for the next frame, so an imported diagram with huge edges can't freeze the tab.

import { OVERLAY_SELECTOR } from "../canvas/useOverlayFit";
import { parseDash, type MarchEdge } from "./marchRenderer";
import { SAMPLE_SPACING, samplePath, type PathLike, type PathSamples } from "./pathSampler";
import type { Obstacles, Rect } from "./particleRenderer";

/** The slice of React Flow's store the scene reads. */
export interface FlowStoreLike {
  getState(): {
    transform: [number, number, number];
    width: number;
    height: number;
    nodes: unknown;
    nodeLookup: ReadonlyMap<
      string,
      { internals: { positionAbsolute: { x: number; y: number } }; measured: { width?: number; height?: number } }
    >;
  };
}

interface PathEntry {
  el: PathLike;
  d: string;
  /** Sampled from `sampledD` (null: never sampled); stale while it differs from `d`. */
  samples: PathSamples | null;
  sampledD: string | null;
}

const EMPTY: PathSamples = { length: 0, points: new Float32Array(4) };

/** At most this many segments per path: longer paths are sampled more coarsely than SAMPLE_SPACING. */
export const MAX_SEGMENTS = 2048;
/** Point queries (getPointAtLength) per frame; the rest of the sampling waits for the next frame. */
export const SAMPLE_BUDGET = 20_000;

/** Pending changes since the last `takeChanges` (the worker path posts them). */
export interface SceneChanges {
  paths?: { set: [id: string, samples: PathSamples][]; remove: string[] };
  nodes?: [id: string, rect: Rect][];
  /** The marching edges and how they look (a full replacement). */
  march?: MarchEdge[];
}

/** Edges that march while live (live.css, `lv-march`): async edges carrying messages. */
const MARCHING = '.react-flow__edge[data-live-edge="active"] .fe-async path.fe-path';

export class LiveScene {
  /** Bumps whenever a sampled edge's path changes (the renderer redraws, and re-samples it). */
  pathsVersion = 0;
  private paths = new Map<string, PathEntry>();
  private dirty = true;
  private observer: MutationObserver | null = null;
  /** Point queries left this frame. */
  private budget = SAMPLE_BUDGET;
  /** A sample was put off for the budget: redraw next frame, when there's budget again. */
  private deferred = false;
  /** Edges the worker needs (they carry or carried particles, or a replay rides them). */
  private wanted = new Set<string>();
  /** Wanted edges whose current samples the worker hasn't got; and sent ones that went away. */
  private pending = new Set<string>();
  private sent = new Set<string>();
  private removedPaths = new Set<string>();
  private nodes = new Map<string, Rect>();
  private nodesRef: unknown = undefined;
  private nodesChanged = false;
  private obstacleCache: (Obstacles & { at: number; view: string }) | null = null;
  private marchEdges: MarchEdge[] = [];
  private marchIds = new Set<string>();
  private marchKey = "";
  private marchChanged = false;

  constructor(
    private root: HTMLElement,
    private store: FlowStoreLike,
  ) {
    if (typeof MutationObserver === "function") {
      this.observer = new MutationObserver(() => {
        this.dirty = true;
      });
      this.observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["d", "data-id"],
      });
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  transform(): readonly [number, number, number] {
    return this.store.getState().transform;
  }

  size(): { width: number; height: number } {
    const s = this.store.getState();
    return { width: s.width, height: s.height };
  }

  dpr(): number {
    return Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  }

  /**
   * An edge's samples, sampled now if they're missing or stale and the frame's budget allows (else the
   * stale ones, or null, until a later frame). Called per particle: a hit is one Map lookup.
   */
  samples(edgeId: string): PathSamples | null {
    const entry = this.paths.get(edgeId);
    if (!entry) return null;
    if (entry.samples && entry.sampledD === entry.d) return entry.samples;
    return this.sample(entry);
  }

  private sample(entry: PathEntry): PathSamples | null {
    if (!entry.d) {
      entry.samples = EMPTY;
      entry.sampledD = entry.d;
      return EMPTY;
    }
    if (this.budget <= 0) {
      this.deferred = true;
      return entry.samples;
    }
    const length = entry.el.getTotalLength();
    const spacing = Math.max(SAMPLE_SPACING, (Number.isFinite(length) ? length : 0) / MAX_SEGMENTS);
    entry.samples = samplePath(length, (l) => entry.el.getPointAtLength(l), spacing);
    entry.sampledD = entry.d;
    this.budget -= entry.samples.points.length / 2;
    return entry.samples;
  }

  /** The worker needs this edge's samples (and their updates from now on). */
  want(edgeId: string): void {
    if (this.wanted.has(edgeId)) return;
    this.wanted.add(edgeId);
    this.pending.add(edgeId);
  }

  /** Sampling still waits on the budget: post again next frame. */
  get backlog(): boolean {
    return this.pending.size > 0 || this.deferred;
  }

  nodeRect(nodeId: string): Rect | null {
    return this.nodes.get(nodeId) ?? null;
  }

  /**
   * Once per frame: re-sample edges whose path changed (only after a DOM change) and re-read node
   * boxes when React Flow's nodes changed. `force` re-reads both (the UI clock does, as a backstop).
   */
  refresh(force = false): void {
    this.budget = SAMPLE_BUDGET;
    if (this.deferred) {
      // Last frame ran out of budget: draw again, which samples what's left.
      this.deferred = false;
      this.pathsVersion++;
    }
    if (this.dirty || force || !this.observer) this.scanPaths();
    this.refreshNodes(force);
  }

  /** The marching edges as last read (see readMarch). */
  get march(): readonly MarchEdge[] {
    return this.marchEdges;
  }

  /**
   * Re-reads which edges march and how they look: path data, computed stroke colour, width, dash and
   * the opacity of the path and its groups (up to the edge layer, which the march canvas shares). The
   * UI clock calls it right after the decorator marks active edges; a path that moves in between
   * (a node dragged) is picked up by the path scan.
   */
  readMarch(): void {
    const layer = this.root.querySelector(".react-flow__edges");
    const out: MarchEdge[] = [];
    for (const path of this.root.querySelectorAll<SVGPathElement>(MARCHING)) {
      const id = path.closest(".react-flow__edge")?.getAttribute("data-id");
      if (!id) continue;
      const cs = getComputedStyle(path);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      let opacity = parseFloat(cs.opacity);
      for (let n = path.parentElement; n && n !== layer && n !== this.root; n = n.parentElement)
        opacity *= parseFloat(getComputedStyle(n).opacity);
      out.push({
        id,
        d: path.getAttribute("d") ?? "",
        color: cs.stroke,
        width: parseFloat(cs.strokeWidth) || 0,
        dash: parseDash(cs.strokeDasharray),
        opacity: Number.isFinite(opacity) ? Math.round(opacity * 1000) / 1000 : 1,
      });
    }
    this.setMarch(out);
  }

  private setMarch(edges: MarchEdge[], key = JSON.stringify(edges)): void {
    if (key === this.marchKey) return;
    this.marchKey = key;
    this.marchEdges = edges;
    this.marchIds = new Set(edges.map((e) => e.id));
    this.marchChanged = true;
  }

  /** Reads every edge's `d` (no sampling: that waits until an edge is needed). */
  private scanPaths(): void {
    this.dirty = false;
    const seen = new Set<string>();
    const moved = new Set<string>();
    let version = false;
    for (const g of this.root.querySelectorAll(".react-flow__edge[data-id]")) {
      const id = g.getAttribute("data-id");
      if (!id || seen.has(id)) continue;
      const el = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
      if (!el) continue;
      seen.add(id);
      const d = el.getAttribute("d") ?? "";
      const prev = this.paths.get(id);
      if (prev) prev.el = el;
      if (prev && prev.d === d) continue;
      if (prev) prev.d = d;
      else this.paths.set(id, { el, d, samples: null, sampledD: null });
      moved.add(id);
      if (prev?.samples) version = true;
      if (this.wanted.has(id)) this.pending.add(id);
      this.removedPaths.delete(id);
    }
    for (const id of [...this.paths.keys()]) {
      if (seen.has(id)) continue;
      if (this.paths.get(id)?.samples) version = true;
      this.paths.delete(id);
      this.pending.delete(id);
      if (this.sent.delete(id)) this.removedPaths.add(id);
    }
    if (version) this.pathsVersion++;
    // Marching edges that moved (a node dragged) follow now, not at the next UI tick: one rebuild
    // for all of them.
    let marchMoved = false;
    for (const id of moved) if (this.marchIds.has(id)) marchMoved = true;
    if (marchMoved)
      this.setMarch(
        this.marchEdges.map((e) => (moved.has(e.id) ? { ...e, d: this.paths.get(e.id)?.d ?? e.d } : e)),
        "",
      );
  }

  private refreshNodes(force: boolean): void {
    const s = this.store.getState();
    if (!force && s.nodes === this.nodesRef) return;
    this.nodesRef = s.nodes;
    const next = new Map<string, Rect>();
    let changed = s.nodeLookup.size !== this.nodes.size;
    for (const [id, n] of s.nodeLookup) {
      const r = {
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        width: n.measured.width ?? 0,
        height: n.measured.height ?? 0,
      };
      next.set(id, r);
      const was = this.nodes.get(id);
      if (!was || was.x !== r.x || was.y !== r.y || was.width !== r.width || was.height !== r.height) changed = true;
    }
    if (!changed) return;
    this.nodes = next;
    this.nodesChanged = true;
  }

  /** Every wanted path, node box and the march, as if all were new (a worker that just attached). */
  everything(): SceneChanges {
    this.pending = new Set(this.wanted);
    this.sent.clear();
    this.removedPaths.clear();
    this.nodesChanged = true;
    this.marchChanged = true;
    return this.takeChanges() ?? {};
  }

  /** What changed since the last call (wanted paths sampled within the budget), or undefined. */
  takeChanges(): SceneChanges | undefined {
    const out: SceneChanges = {};
    const set: [string, PathSamples][] = [];
    for (const id of this.pending) {
      const entry = this.paths.get(id);
      if (!entry) {
        this.pending.delete(id);
        continue;
      }
      const s = this.samples(id);
      if (!s || entry.sampledD !== entry.d) break; // out of budget: the rest next frame
      set.push([id, s]);
      this.sent.add(id);
      this.pending.delete(id);
    }
    if (set.length || this.removedPaths.size) {
      out.paths = { set, remove: [...this.removedPaths] };
      this.removedPaths.clear();
    }
    if (this.nodesChanged) {
      out.nodes = [...this.nodes];
      this.nodesChanged = false;
    }
    if (this.marchChanged) {
      out.march = this.marchEdges;
      this.marchChanged = false;
    }
    return out.paths || out.nodes || out.march ? out : undefined;
  }

  /**
   * What a traced message's labels keep clear of: read from the DOM a few times a second, and at
   * once when the view moves (a refit animates): node cards, their badges, the floating chrome and,
   * softly, edge labels and annotations. The same object comes back while the cache holds.
   */
  obstacles(): Obstacles {
    const now = performance.now();
    const [vx, vy, vz] = this.store.getState().transform;
    const view = `${vx}|${vy}|${vz}`;
    const cached = this.obstacleCache;
    if (cached && cached.view === view && now - cached.at < 200) return cached;
    const root = this.root;
    const base = root.getBoundingClientRect();
    const rects = (selector: string) => {
      const out: Rect[] = [];
      for (const el of root.querySelectorAll<HTMLElement>(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height)
          out.push({ x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height });
      }
      return out;
    };
    this.obstacleCache = {
      at: now,
      view,
      hard: rects(`.react-flow__node-diagram, .lv-strip, .lv-hud > *, .lv-panel, ${OVERLAY_SELECTOR}`),
      soft: rects(".fe-label, .react-flow__node-annotation"),
    };
    return this.obstacleCache;
  }
}
