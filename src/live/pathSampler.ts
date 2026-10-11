// Particle placement along the real edge paths. getPointAtLength is too slow to call ~1,500 times a
// frame, so each path is sampled once into a flat polyline (x0, y0, x1, y1, ...) at a fixed pixel
// spacing, and particles interpolate between samples. Samples are cached per edge and rebuilt only
// when the path's `d` attribute changes (a node moved, the edge style changed...).

export interface PathSamples {
  /** Total path length in flow units. */
  length: number;
  /** Interleaved x, y pairs, evenly spaced along the path, first point = start, last = end. */
  points: Float32Array;
}

export type PointAt = (distance: number) => { x: number; y: number };

/** Distance between samples, in flow px. Smooth enough for bezier curves and rounded corners. */
export const SAMPLE_SPACING = 6;

/** Samples a path of `length` with at least two points (start and end). */
export function samplePath(length: number, pointAt: PointAt, spacing = SAMPLE_SPACING): PathSamples {
  const safe = Number.isFinite(length) && length > 0 ? length : 0;
  const segments = Math.max(1, Math.ceil(safe / Math.max(0.5, spacing)));
  const points = new Float32Array((segments + 1) * 2);
  for (let i = 0; i <= segments; i++) {
    const p = pointAt((safe * i) / segments);
    points[i * 2] = p.x;
    points[i * 2 + 1] = p.y;
  }
  return { length: safe, points };
}

/** Writes the point at fraction `t` (0..1) of the path into `out` (no allocation). */
export function pointOnSamples(s: PathSamples, t: number, out: { x: number; y: number }): { x: number; y: number } {
  const n = s.points.length / 2 - 1;
  const f = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  const a = i * 2;
  out.x = s.points[a] + (s.points[a + 2] - s.points[a]) * k;
  out.y = s.points[a + 1] + (s.points[a + 3] - s.points[a + 1]) * k;
  return out;
}

/** Index of the sample at or before fraction `t`. Trails walk samples from here back to their tail. */
export function sampleIndex(s: PathSamples, t: number): number {
  const n = s.points.length / 2 - 1;
  return Math.min(n, Math.max(0, Math.floor(Math.min(1, Math.max(0, t)) * n)));
}

/** The minimal slice of an SVG path element the cache needs (easy to fake in unit tests). */
export interface PathLike {
  getAttribute(name: "d"): string | null;
  getTotalLength(): number;
  getPointAtLength(distance: number): { x: number; y: number };
  readonly isConnected: boolean;
}

interface Entry {
  el: PathLike;
  d: string;
  samples: PathSamples;
}

/**
 * Edge id → samples. `resolve` finds the live DOM path for an edge (React Flow may remount it).
 * Call `get` every frame: it re-reads `d` (cheap) and re-samples only when it changed.
 */
export class PathCache {
  private entries = new Map<string, Entry>();
  private missing = new Map<string, number>();
  constructor(
    private resolve: (edgeId: string) => PathLike | null,
    private spacing = SAMPLE_SPACING,
  ) {}

  get(edgeId: string, frame = 0): PathSamples | null {
    let entry = this.entries.get(edgeId);
    if (entry && !entry.el.isConnected) {
      this.entries.delete(edgeId);
      entry = undefined;
    }
    if (!entry) {
      // Don't query the DOM for a missing edge more than once per frame.
      if (this.missing.get(edgeId) === frame) return null;
      const el = this.resolve(edgeId);
      if (!el) {
        this.missing.set(edgeId, frame);
        return null;
      }
      this.missing.delete(edgeId);
      entry = { el, d: "", samples: { length: 0, points: new Float32Array(4) } };
      this.entries.set(edgeId, entry);
    }
    const d = entry.el.getAttribute("d") ?? "";
    if (d !== entry.d) {
      entry.d = d;
      entry.samples = d ? samplePath(entry.el.getTotalLength(), (l) => entry.el.getPointAtLength(l), this.spacing) : { length: 0, points: new Float32Array(4) };
    }
    return entry.samples;
  }

  /** Forget everything (diagram reloaded, renderer detached). */
  clear(): void {
    this.entries.clear();
    this.missing.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
