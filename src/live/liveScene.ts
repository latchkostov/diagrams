// What the particle renderer needs from the page, read on the main thread: every edge's path sampled
// in flow coordinates, node boxes, label obstacles and the view. Both render paths read it (the
// fallback directly, the worker through messages, see liveRenderer.ts), and it reads the DOM only
// when something changed: a MutationObserver marks the paths dirty when an edge's `d` changes or
// edges mount, so a frame with nothing new costs a flag check.

import { OVERLAY_SELECTOR } from "../canvas/useOverlayFit";
import { parseDash, type MarchEdge } from "./marchRenderer";
import { samplePath, type PathSamples } from "./pathSampler";
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
  d: string;
  samples: PathSamples;
}

const EMPTY: PathSamples = { length: 0, points: new Float32Array(4) };

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
  /** Bumps whenever any edge's samples change. */
  pathsVersion = 0;
  private paths = new Map<string, PathEntry>();
  private dirty = true;
  private observer: MutationObserver | null = null;
  private changedPaths = new Set<string>();
  private removedPaths = new Set<string>();
  private nodes = new Map<string, Rect>();
  private nodesRef: unknown = undefined;
  private nodesChanged = false;
  private obstacleCache: (Obstacles & { at: number; view: string }) | null = null;
  private marchEdges: MarchEdge[] = [];
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

  samples(edgeId: string): PathSamples | null {
    return this.paths.get(edgeId)?.samples ?? null;
  }

  nodeRect(nodeId: string): Rect | null {
    return this.nodes.get(nodeId) ?? null;
  }

  /**
   * Once per frame: re-sample edges whose path changed (only after a DOM change) and re-read node
   * boxes when React Flow's nodes changed. `force` re-reads both (the UI clock does, as a backstop).
   */
  refresh(force = false): void {
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

  private setMarch(edges: MarchEdge[]): void {
    const key = JSON.stringify(edges);
    if (key === this.marchKey) return;
    this.marchKey = key;
    this.marchEdges = edges;
    this.marchChanged = true;
  }

  private scanPaths(): void {
    this.dirty = false;
    const seen = new Set<string>();
    let changed = false;
    for (const g of this.root.querySelectorAll(".react-flow__edge[data-id]")) {
      const id = g.getAttribute("data-id");
      if (!id || seen.has(id)) continue;
      const el = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
      if (!el) continue;
      seen.add(id);
      const d = el.getAttribute("d") ?? "";
      const prev = this.paths.get(id);
      if (prev && prev.d === d) continue;
      const samples = d ? samplePath(el.getTotalLength(), (l) => el.getPointAtLength(l)) : EMPTY;
      this.paths.set(id, { d, samples });
      // A marching edge moved (a node dragged): its ants follow now, not at the next UI tick.
      if (this.marchEdges.some((e) => e.id === id && e.d !== d))
        this.setMarch(this.marchEdges.map((e) => (e.id === id ? { ...e, d } : e)));
      this.changedPaths.add(id);
      this.removedPaths.delete(id);
      changed = true;
    }
    for (const id of [...this.paths.keys()]) {
      if (seen.has(id)) continue;
      this.paths.delete(id);
      this.changedPaths.delete(id);
      this.removedPaths.add(id);
      changed = true;
    }
    if (changed) this.pathsVersion++;
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

  /** Every path and node box, as if all were new (a worker that just attached needs them all). */
  everything(): SceneChanges {
    this.changedPaths = new Set(this.paths.keys());
    this.removedPaths.clear();
    this.nodesChanged = true;
    this.marchChanged = true;
    return this.takeChanges() ?? {};
  }

  /** What changed since the last call, or undefined when nothing did. */
  takeChanges(): SceneChanges | undefined {
    const out: SceneChanges = {};
    if (this.changedPaths.size || this.removedPaths.size) {
      out.paths = {
        set: [...this.changedPaths].map((id) => [id, this.paths.get(id)!.samples] as [string, PathSamples]),
        remove: [...this.removedPaths],
      };
      this.changedPaths.clear();
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
