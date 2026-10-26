import type { EdgeInk } from "./liveScene";
// The messages between the live view (main thread) and the particle worker (particleWorker.ts).
//
// One message each way per frame, at most one frame in flight:
//  - main → worker `frame`: the view (transform, size, dpr), the clock, and only what changed: the
//    particles packed into a transferable ArrayBuffer (when the snapshot changed), new dictionary
//    strings, re-sampled paths, node boxes, label pills, obstacles, options, slow motion's frame.
//  - worker → main `ack`: the buffer back for reuse, the hit targets for click-to-trace, the counts
//    and labels the test hooks read, and whether pulses are still fading (so main keeps posting).
//
// Particles are 6 int32 slots each: id, message id, root id, edge index, kind | style index << 2,
// and the progress as float32 bits. Edge ids, node ids and (type, colour) styles are strings sent
// once, the first time they appear, and referenced by index after that.

import type { Particle, ParticleKind } from "../sim/types";
import type { MarchEdge } from "./marchRenderer";
import type { PathSamples } from "./pathSampler";
import type { Obstacles, Rect, RenderOptions, RenderSnapshot } from "./particleRenderer";
import type { PlacedLabel } from "./traceLabels";
import type { PaintedLabel } from "./slowmo/overlay";
import type { SlowFrame } from "./slowmo/script";

export const STRIDE = 6;
const HEADER = 2;
export const KINDS: readonly ParticleKind[] = ["message", "reply", "retry", "dlq"];
const KIND_INDEX: Record<ParticleKind, number> = { message: 0, reply: 1, retry: 2, dlq: 3 };

/** Strings first seen in this frame, appended to the worker's tables in order. */
export interface DictDelta {
  edges?: string[];
  nodes?: string[];
  /** A style: type and colour, plus a request route's marker, id and a refused reply's code when present. */
  styles?: Style[];
}
export type Style = [type: string, color: string, marker?: string, route?: string, code?: number];

export interface PackedSnapshot {
  buf: ArrayBuffer;
  /** Particles, then [node index, failures] pairs. */
  particles: number;
  nodes: number;
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
  dpr: number;
}

export interface SlowState {
  /** Present only when slow motion's frame changed since the last post. */
  frame?: SlowFrame | null;
  textScale: number;
  backgroundAlpha: number;
}

export interface FrameMessage {
  ink?: [string, EdgeInk][];
  type: "frame";
  /** Which attachment this frame belongs to (acks from an older one are ignored). */
  epoch: number;
  /** A new attachment: drop every table, path and box before applying this frame. */
  sync?: true;
  /** A new engine (restart, structural edit): forget per-message history. */
  reset?: true;
  options?: RenderOptions;
  dict?: DictDelta;
  paths?: { set: [id: string, length: number, points: Float32Array][]; remove: string[] };
  /** Every node box (a full replacement). */
  nodes?: [id: string, rect: Rect][];
  labels?: Rect[];
  /** Label obstacles (null: none); absent when unchanged. */
  obstacles?: Obstacles | null;
  /** Absent: the same snapshot as the last frame. */
  snap?: PackedSnapshot;
  /** The marching edges (a full replacement), when they changed. */
  march?: MarchEdge[];
  /** How far into the march (ms of moving simulation; it stands still while the simulation does). */
  marchPhase: number;
  /** The Live toggle's dot colour and the device pixel ratio, when they changed ("" hides the glow). */
  glow?: { color: string; dpr: number };
  view: ViewState;
  now: number;
  speed: number;
  focus?: number;
  /** null: slow motion is off. */
  slow: SlowState | null;
}

/** The canvases: particles, the overlay above the edge label pills, the marching ants. */
export type Layer = "base" | "over" | "march";

export interface ProbeMessage {
  type: "probe";
  id: number;
  layer: Layer;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ToWorker =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      overlay: OffscreenCanvas;
      march?: OffscreenCanvas;
      /** The Live toggle's breathing glow (toggleGlow.ts). */
      glow?: OffscreenCanvas;
    }
  | FrameMessage
  | ProbeMessage;

export interface AckMessage {
  type: "ack";
  epoch: number;
  /** The particle buffer, back for reuse. */
  buf?: ArrayBuffer;
  drawn: number;
  frames: number;
  /** Pulses or flashes are fading, or fonts just loaded: post again next frame. */
  animating: boolean;
  /** x, y (pane CSS px), message id per hit target, when they changed. */
  hits?: Float64Array;
  labels?: PlacedLabel[];
  slowLabels?: PaintedLabel[];
}

/**
 * A repaint the worker did on its own (fonts finished loading): fresh counts, hits and labels, but
 * not an answer to a frame, so it doesn't release the next one.
 */
export interface RepaintMessage extends Omit<AckMessage, "type" | "buf" | "animating"> {
  type: "repaint";
}

export type FromWorker =
  | AckMessage
  | RepaintMessage
  | { type: "probe"; id: number; data: Uint8ClampedArray }
  | { type: "error"; message: string };

/** Interns strings as small integers, reporting the new ones. */
class Table {
  private ids = new Map<string, number>();
  private fresh: string[] = [];
  index(s: string): number {
    let i = this.ids.get(s);
    if (i === undefined) {
      i = this.ids.size;
      this.ids.set(s, i);
      this.fresh.push(s);
    }
    return i;
  }
  take(): string[] | undefined {
    if (!this.fresh.length) return undefined;
    const out = this.fresh;
    this.fresh = [];
    return out;
  }
  clear(): void {
    this.ids.clear();
    this.fresh = [];
  }
}

/** Main thread: packs snapshots into transferable buffers. */
export class SnapshotPacker {
  private edges = new Table();
  private nodes = new Table();
  /** type → colour → style index (no string building per particle). */
  private styles = new Map<string, Map<string, number>>();
  private styleCount = 0;
  private freshStyles: Style[] = [];
  /** Routed styles by their full key (unrouted ones use the nested map above). */
  private routed = new Map<string, number>();
  private pool: ArrayBuffer[] = [];

  /** Start over (the worker dropped its tables). */
  clear(): void {
    this.edges.clear();
    this.nodes.clear();
    this.styles.clear();
    this.routed.clear();
    this.styleCount = 0;
    this.freshStyles = [];
  }

  /** A buffer the worker handed back. */
  recycle(buf: ArrayBuffer): void {
    if (this.pool.length < 4) this.pool.push(buf);
  }

  private style(type: string, color: string, p?: Particle): number {
    if (p && (p.marker || p.route || p.code)) {
      const key = `${type}\u0000${color}\u0000${p.marker ?? ""}\u0000${p.route ?? ""}\u0000${p.code ?? ""}`;
      let i = this.routed.get(key);
      if (i === undefined) {
        i = this.styleCount++;
        this.routed.set(key, i);
        this.freshStyles.push([type, color, p.marker ?? "", p.route ?? "", p.code ?? 0]);
      }
      return i;
    }
    let byColor = this.styles.get(type);
    if (!byColor) this.styles.set(type, (byColor = new Map()));
    let i = byColor.get(color);
    if (i === undefined) {
      i = this.styleCount++;
      byColor.set(color, i);
      this.freshStyles.push([type, color]);
    }
    return i;
  }

  private buffer(bytes: number): ArrayBuffer {
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i].byteLength >= bytes) return this.pool.splice(i, 1)[0];
    let size = 4096;
    while (size < bytes) size *= 2;
    return new ArrayBuffer(size);
  }

  pack(snap: RenderSnapshot): PackedSnapshot {
    const particles = snap.particles;
    let nodeCount = 0;
    for (const _ in snap.nodes) nodeCount++;
    const buf = this.buffer((HEADER + particles.length * STRIDE + nodeCount * 2) * 4);
    const ints = new Int32Array(buf);
    const floats = new Float32Array(buf);
    ints[0] = particles.length;
    ints[1] = nodeCount;
    let o = HEADER;
    for (const p of particles) {
      ints[o] = p.id;
      ints[o + 1] = p.messageId;
      ints[o + 2] = p.rootId;
      ints[o + 3] = this.edges.index(p.edgeId);
      ints[o + 4] = KIND_INDEX[p.kind] | (this.style(p.type, p.color, p) << 2);
      floats[o + 5] = p.progress;
      o += STRIDE;
    }
    for (const id in snap.nodes) {
      const n = snap.nodes[id];
      ints[o] = this.nodes.index(id);
      ints[o + 1] = n.failed + n.deadLettered + n.dropped;
      o += 2;
    }
    return { buf, particles: particles.length, nodes: nodeCount };
  }

  /** Strings first used since the last call (send them with the frame that packed them). */
  takeDict(): DictDelta | undefined {
    const edges = this.edges.take();
    const nodes = this.nodes.take();
    const styles = this.freshStyles.length ? this.freshStyles : undefined;
    this.freshStyles = [];
    if (!edges && !nodes && !styles) return undefined;
    return { ...(edges && { edges }), ...(nodes && { nodes }), ...(styles && { styles }) };
  }
}

/** Worker: turns packed buffers back into what the renderer reads, reusing particle objects. */
export class SnapshotUnpacker {
  private edges: string[] = [];
  private nodes: string[] = [];
  private styles: Style[] = [];
  private pool: Particle[] = [];

  clear(): void {
    this.edges = [];
    this.nodes = [];
    this.styles = [];
  }

  apply(dict: DictDelta | undefined): void {
    if (!dict) return;
    if (dict.edges) this.edges.push(...dict.edges);
    if (dict.nodes) this.nodes.push(...dict.nodes);
    if (dict.styles) this.styles.push(...dict.styles);
  }

  /** A fresh snapshot object (the renderer compares identity) over pooled particles. */
  unpack(packed: PackedSnapshot): RenderSnapshot {
    const ints = new Int32Array(packed.buf);
    const floats = new Float32Array(packed.buf);
    const n = packed.particles;
    const pool = this.pool;
    while (pool.length < n)
      pool.push({ id: 0, edgeId: "", messageId: 0, rootId: 0, kind: "message", progress: 0, type: "", color: "" });
    const particles = pool.slice(0, n);
    let o = HEADER;
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      const packedKind = ints[o + 4];
      const style = this.styles[packedKind >> 2] ?? ["", ""];
      p.id = ints[o];
      p.messageId = ints[o + 1];
      p.rootId = ints[o + 2];
      p.edgeId = this.edges[ints[o + 3]] ?? "";
      p.kind = KINDS[packedKind & 3];
      p.type = style[0];
      p.color = style[1];
      p.marker = (style[2] || undefined) as Particle["marker"];
      p.route = style[3] || undefined;
      p.code = style[4] || undefined;
      p.progress = floats[o + 5];
      o += STRIDE;
    }
    const nodes: Record<string, { failed: number; deadLettered: number; dropped: number }> = {};
    for (let i = 0; i < packed.nodes; i++) {
      const id = this.nodes[ints[o]];
      if (id !== undefined) nodes[id] = { failed: ints[o + 1], deadLettered: 0, dropped: 0 };
      o += 2;
    }
    return { particles, nodes };
  }
}

/** Path samples as posted: [id, length, points] (the points are copied, the main thread keeps its own). */
export function postablePaths(set: [string, PathSamples][]): [string, number, Float32Array][] {
  return set.map(([id, s]) => [id, s.length, s.points.slice()]);
}
