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
  group: Element;
  march?: MarchEdge;
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
export type EdgeInk = { alpha: number; near: boolean };
export interface SceneChanges {
  ink?: [string, EdgeInk][];
  paths?: { set: [id: string, samples: PathSamples][]; remove: string[] };
  nodes?: [id: string, rect: Rect][];
  /** The marching edges and how they look (a full replacement). */
  march?: MarchEdge[];
}

export class LiveScene {
  /** Bumps whenever a sampled edge's path changes (the renderer redraws, and re-samples it). */
  pathsVersion = 0;
  readonly ink = new Map<string, EdgeInk>();
  private inkChanged = false;
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
  private marchVersion = 0;
  private sentMarchVersion = 0;
  private marchDirty = false;
  private stylesDirty = true;
  private styled = new Set<Element>();
  private styleCache = new Map<string, Omit<MarchEdge, "id" | "d">>();
  private zoom = NaN;

  constructor(
    private root: HTMLElement,
    private store: FlowStoreLike,
    private onGeometryChange?: () => void,
  ) {
    if (typeof MutationObserver === "function") {
      this.observer = new MutationObserver((records) => this.invalidate(records));
      this.observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [
          "d",
          "data-id",
          "class",
          "style",
          "data-detail-expanded",
          "data-detail-wrapped",
          "data-live-edge",
          "data-live-dim",
          "data-live-trace",
          "data-live-cut",
          "data-live-main",
          "data-live-near",
          "data-detail-hidden",
          "data-detail-selected-edge",
          "data-live-spotlight",
        ],
      });
      // Detail and presentation attributes live above React Flow; theme changes live on <html>.
      for (let el = root.parentElement; el; el = el.parentElement)
        this.observer.observe(el, {
          attributes: true,
          attributeOldValue: true,
          attributeFilter: [
            "class",
            "style",
            "data-theme",
            "data-detail-far",
            "data-detail-view",
            "data-detail-overview",
          ],
        });
    }
  }

  private invalidate(records: MutationRecord[]): void {
    for (const record of records) {
      this.obstacleCache = null;
      const el =
        typeof Element !== "undefined" && record.target instanceof Element
          ? record.target
          : record.target?.parentElement;
      if (!el) continue;
      if (
        record.type === "attributes" &&
        record.oldValue !== null &&
        el.getAttribute(record.attributeName!) === record.oldValue
      )
        continue;
      if (record.type === "childList") {
        // Badge numbers and panel teardown do not change edge geometry or styles.
        const edge = el.closest(".react-flow__edge");
        if (edge) this.styled.add(edge);
        if (
          edge ||
          [...record.addedNodes, ...record.removedNodes].some(
            (n) =>
              n instanceof Element &&
              (n.matches(".react-flow__edge, .react-flow__edge-path") ||
                n.querySelector(".react-flow__edge, .react-flow__edge-path")),
          )
        )
          this.dirty = true;
      } else if (record.attributeName === "data-detail-expanded" || record.attributeName === "data-detail-wrapped") {
        this.onGeometryChange?.();
      } else {
        const edge = el.closest(".react-flow__edge");
        if (edge) {
          if (record.attributeName === "d" || record.attributeName === "data-id") this.dirty = true;
          else this.styled.add(edge);
        } else if (el === this.root || el.contains(this.root)) this.stylesDirty = true;
      }
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
   * boxes when React Flow's nodes changed. Timers never invalidate geometry.
   */
  refresh(): void {
    if (this.observer) this.invalidate(this.observer.takeRecords?.() ?? []);
    this.budget = SAMPLE_BUDGET;
    if (this.deferred) {
      // Last frame ran out of budget: draw again, which samples what's left.
      this.deferred = false;
      this.pathsVersion++;
    }
    if (this.dirty || !this.observer) this.scanPaths();
    this.refreshNodes();
    const zoom = this.transform()[2];
    if (zoom !== this.zoom) {
      this.zoom = zoom;
      this.stylesDirty = true;
    }
    this.readMarch();
  }

  /** The marching edges as last read (see readMarch). */
  get march(): readonly MarchEdge[] {
    return this.marchEdges;
  }

  /**
   * Membership follows the decorator's data; styles are read only after an edge-style, theme or
   * zoom change. Geometry-only changes reuse those styles. A revision replaces whole-scene JSON
   * comparisons, and unchanged ticks preserve the march array's identity.
   */
  readMarch(): void {
    if (!this.stylesDirty && !this.styled.size && !this.marchDirty) return;
    if (this.stylesDirty) this.styleCache.clear();
    const spotlight = this.root.hasAttribute("data-live-spotlight");
    const out: MarchEdge[] = [];
    for (const [id, entry] of this.paths) {
      const el = entry.group;
      const near = !spotlight || el.hasAttribute("data-live-near") || !el.hasAttribute("data-live-dim");
      const alpha = el.hasAttribute("data-detail-hidden") ? 0 : spotlight && !near ? 0.28 : 1;
      const ink = this.ink.get(id);
      if (!ink || ink.alpha !== alpha || ink.near !== near) {
        this.ink.set(id, { alpha, near });
        this.inkChanged = true;
        this.pathsVersion++;
      }
      let edge = entry.march;
      if (this.stylesDirty || this.styled.has(el)) {
        // Membership and ancestor visibility come from presentation data. Flow groups have unit
        // opacity; only the path fades. Never walk ancestors asking for their computed styles.
        const path = entry.el as SVGPathElement;
        if (alpha === 0 || el.getAttribute("data-live-edge") !== "active" || !path.matches(".fe-async .fe-path")) {
          edge = undefined;
        } else {
          edge = { id, d: entry.d, ...this.readStyle(path, el) };
        }
      }
      entry.march = edge;
      if (edge) out.push(edge);
    }
    this.stylesDirty = false;
    this.styled.clear();
    this.marchDirty = false;
    this.setMarch(out);
  }

  /** Flow paths with the same presentation data share a style; the path's geometry is independent. */
  private readStyle(path: SVGPathElement, group: Element): Omit<MarchEdge, "id" | "d"> {
    const key = [
      ...[group, path.parentElement, path].flatMap((el) => [el?.getAttribute("class"), el?.getAttribute("style")]),
      ...[
        "data-live-dim",
        "data-live-trace",
        "data-live-cut",
        "data-live-main",
        "data-live-near",
        "data-detail-selected-edge",
      ].map((name) => group.hasAttribute(name)),
    ].join("\0");
    let style = this.styleCache.get(key);
    if (!style) {
      const cs = getComputedStyle(path);
      style = {
        color: cs.stroke,
        width: parseFloat(cs.strokeWidth) || 0,
        dash: parseDash(cs.strokeDasharray),
        // The CSS target is unanimated. Never enumerate the document's animation set per edge.
        opacity:
          cs.display === "none" || cs.visibility === "hidden"
            ? 0
            : parseFloat(cs.getPropertyValue("--live-march-opacity") || "1"),
      };
      this.styleCache.set(key, style);
    }
    return style;
  }

  private setMarch(edges: MarchEdge[]): void {
    this.marchEdges = edges;
    for (const e of edges) this.paths.get(e.id)!.march = e;
    this.marchVersion++;
  }

  /** Reads every edge's `d` (no sampling: that waits until an edge is needed). */
  private scanPaths(): void {
    this.dirty = false;
    const seen = new Set<string>();
    let version = false;
    for (const g of this.root.querySelectorAll(".react-flow__edge[data-id]")) {
      const id = g.getAttribute("data-id");
      if (!id || seen.has(id)) continue;
      const el = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
      if (!el) continue;
      seen.add(id);
      const d = el.getAttribute("d") ?? "";
      const prev = this.paths.get(id);
      if (prev) {
        if (prev.group !== g) this.styled.add(g);
        prev.el = el;
        prev.group = g;
      }
      if (prev && prev.d === d) continue;
      if (prev) prev.d = d;
      else {
        this.paths.set(id, { el, group: g, d, samples: null, sampledD: null });
        this.styled.add(g);
      }
      if (prev?.march) {
        prev.march = { ...prev.march, d };
        this.marchDirty = true;
      }
      if (prev?.samples) version = true;
      if (this.wanted.has(id)) this.pending.add(id);
      this.removedPaths.delete(id);
    }
    for (const id of [...this.paths.keys()]) {
      if (seen.has(id)) continue;
      if (this.paths.get(id)?.samples) version = true;
      this.paths.delete(id);
      this.ink.delete(id);
      this.inkChanged = true;
      this.marchDirty = true;
      this.pending.delete(id);
      if (this.sent.delete(id)) this.removedPaths.add(id);
    }
    if (version) this.pathsVersion++;
  }

  private refreshNodes(): void {
    const s = this.store.getState();
    if (s.nodes === this.nodesRef) return;
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
    this.obstacleCache = null;
    this.onGeometryChange?.();
  }

  /** Every wanted path, node box and the march, as if all were new (a worker that just attached). */
  everything(): SceneChanges {
    this.pending = new Set(this.wanted);
    this.sent.clear();
    this.removedPaths.clear();
    this.nodesChanged = true;
    this.sentMarchVersion = -1;
    this.inkChanged = true;
    return this.takeChanges() ?? {};
  }

  /** What changed since the last call (wanted paths sampled within the budget), or undefined. */
  takeChanges(): SceneChanges | undefined {
    const out: SceneChanges = {};
    if (this.inkChanged) {
      out.ink = [...this.ink];
      this.inkChanged = false;
    }
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
    if (this.sentMarchVersion !== this.marchVersion) {
      out.march = this.marchEdges;
      this.sentMarchVersion = this.marchVersion;
    }
    return out.paths || out.nodes || out.march || out.ink ? out : undefined;
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
    const hard: Rect[] = [],
      soft: Rect[] = [];
    const solid = `.react-flow__node-diagram, .lv-strip, .lv-hud > *, .lv-panel, ${OVERLAY_SELECTOR}`;
    for (const el of root.querySelectorAll<HTMLElement>(`${solid}, .fe-label, .react-flow__node-annotation`)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height)
        (el.matches(solid) ? hard : soft).push({
          x: r.left - base.left,
          y: r.top - base.top,
          width: r.width,
          height: r.height,
        });
    }
    this.obstacleCache = {
      at: now,
      view,
      hard,
      soft,
    };
    return this.obstacleCache;
  }
}
