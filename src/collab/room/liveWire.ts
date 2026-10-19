import { bytesToText, textToBytes } from "../../interop/codec";
import { simulationProblem } from "../../interop/native";
import { faultProblem } from "../../model/faults";
import type { Simulation } from "../../model/types";
import type { LiveOp } from "../../live/controlLog";
import type { LiveInputs } from "../../live/capacityModel";
import type { LiveMessage, RunStart, WireEntry } from "./liveShare";

// Watch together's wire format (shared Live P2): JSON, checked in full before anything uses it, and split into
// parts when it's larger than one frame. Every message is the host's (or a follower's request): untrusted, since
// anyone in the room holds the key, so a malformed one is dropped without touching any state, and every number that
// sets an amount of work is bounded.

/** The largest JSON one frame carries (the frame's limit less the envelope and the message type byte). */
export const PART_BYTES = 15 * 1024;
/** One message, whole: a run's start (its simulation) or one op. Past this it isn't sent. */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
/** How long a half-received message's parts are kept. */
const PART_TTL_MS = 30_000;

/** Bounds on what an op may ask for. */
export const LIMITS = {
  /** A single step (the live bar's is 250 ms). */
  stepMs: 1_000,
  /** A seek's target: no saved simulation is longer (docs/SIMULATION.md: 600 s), with room for free play. */
  seekMs: 24 * 3600 * 1000,
  injectCount: 100_000,
  nodes: 5_000,
  keys: 100,
  depth: 6,
  entriesPerMessage: 500,
  id: 256,
};

// ---------------------------------------------------------------- encoding

/** A part's header: a zero byte (no JSON message starts with one), the message's id, the part's index and count. */
const PART_HEADER = 9;

/**
 * A message as frame payloads: its JSON in one, or in parts of at most PART_BYTES each (binary, so nothing is
 * escaped twice). Undefined when it's too large to send at all.
 */
export function encodeMessage(message: LiveMessage, id: number): Uint8Array[] | undefined {
  const bytes = textToBytes(JSON.stringify(message));
  if (bytes.length > MAX_MESSAGE_BYTES) return undefined;
  if (bytes.length <= PART_BYTES) return [bytes];
  const n = Math.ceil(bytes.length / PART_BYTES);
  return Array.from({ length: n }, (_, i) => {
    const data = bytes.subarray(i * PART_BYTES, (i + 1) * PART_BYTES);
    const part = new Uint8Array(PART_HEADER + data.length);
    const view = new DataView(part.buffer);
    view.setUint8(0, 0);
    view.setUint32(1, id >>> 0);
    view.setUint16(5, i);
    view.setUint16(7, n);
    part.set(data, PART_HEADER);
    return part;
  });
}

const MAX_PARTS = Math.ceil(MAX_MESSAGE_BYTES / PART_BYTES);

/** Reassembles parts per sender, bounded in bytes and time; every message, whole or reassembled, is checked. */
export class LiveDecoder {
  private pending = new Map<
    string,
    { id: number; n: number; parts: Uint8Array[]; got: number; bytes: number; at: number }
  >();

  constructor(private readonly now: () => number = () => Date.now()) {}

  push(sender: string, payload: Uint8Array): LiveMessage | undefined {
    if (payload.length && payload[0] === 0) return this.part(sender, payload);
    return decode(payload);
  }

  private part(sender: string, payload: Uint8Array): LiveMessage | undefined {
    if (payload.length <= PART_HEADER || payload.length > PART_HEADER + PART_BYTES) return undefined;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const id = view.getUint32(1);
    const i = view.getUint16(5);
    const n = view.getUint16(7);
    if (n < 2 || n > MAX_PARTS || i >= n) return undefined;
    const now = this.now();
    for (const [s, q] of this.pending) if (now - q.at > PART_TTL_MS) this.pending.delete(s);
    let q = this.pending.get(sender);
    // One message at a time per sender (they're sent in order): another one's part abandons the last.
    if (!q || q.id !== id || q.n !== n) {
      q = { id, n, parts: [], got: 0, bytes: 0, at: now };
      this.pending.set(sender, q);
    }
    if (q.parts[i] !== undefined) return undefined;
    const data = payload.slice(PART_HEADER);
    if (q.bytes + data.length > MAX_MESSAGE_BYTES) {
      this.pending.delete(sender);
      return undefined;
    }
    q.parts[i] = data;
    q.got++;
    q.bytes += data.length;
    if (q.got < q.n) return undefined;
    this.pending.delete(sender);
    const whole = new Uint8Array(q.bytes);
    let at = 0;
    for (const p of q.parts) {
      whole.set(p, at);
      at += p.length;
    }
    return decode(whole);
  }
}

function decode(bytes: Uint8Array): LiveMessage | undefined {
  try {
    return parseMessage(JSON.parse(bytesToText(bytes)));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- checks

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const num = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max = LIMITS.id) => typeof v === "string" && v.length > 0 && v.length <= max;
const RUN = /^[\w.:-]{1,64}$/;

/** A JSON value no deeper than `depth`, with no more than `keys` keys or items at any level. */
function plain(v: unknown, depth: number): boolean {
  if (v === null || typeof v === "boolean" || typeof v === "string") return typeof v !== "string" || v.length <= 10_000;
  if (typeof v === "number") return Number.isFinite(v);
  if (depth <= 0) return false;
  if (Array.isArray(v)) return v.length <= LIMITS.keys * 10 && v.every((x) => plain(x, depth - 1));
  if (!isRecord(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= LIMITS.keys && entries.every(([k, x]) => k.length <= LIMITS.id && plain(x, depth - 1));
}

/** A map of node id to a props object (Inputs overrides, a diagram patch). */
function nodeProps(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length <= LIMITS.nodes &&
    entries.every(([id, props]) => id.length <= LIMITS.id && isRecord(props) && plain(props, LIMITS.depth))
  );
}

function inputs(v: unknown): v is LiveInputs {
  if (!isRecord(v) || !nodeProps(v.props) || !isRecord(v.rates)) return false;
  const rates = Object.entries(v.rates);
  if (rates.length > LIMITS.nodes || !rates.every(([id, r]) => id.length <= LIMITS.id && num(r, 0, 1e9))) return false;
  for (const k of ["traffic", "capacity"] as const) if (v[k] !== undefined && !num(v[k], 0, 1000)) return false;
  if (v.scale !== undefined && !num(v.scale, 1, Number.MAX_SAFE_INTEGER)) return false;
  return Object.keys(v).every((k) => ["props", "rates", "traffic", "capacity", "scale"].includes(k));
}

const simulation = (v: unknown): v is Simulation => isRecord(v) && simulationProblem(v) === undefined;
const STATUSES = new Set(["up", "paused", "down"]);

/** One op as the host's control log has it, or undefined when it isn't exactly one (src/live/controlLog.ts). */
export function parseOp(v: unknown): LiveOp | undefined {
  if (!isRecord(v) || typeof v.kind !== "string") return undefined;
  const ok = (() => {
    switch (v.kind) {
      case "play":
      case "traffic":
        return typeof v.on === "boolean";
      case "speed":
        return num(v.speed, 0.25, 8);
      case "step":
        return num(v.simMs, 0, LIMITS.stepMs);
      case "seek":
        return num(v.targetMs, 0, LIMITS.seekMs);
      case "restart":
      case "resume":
      case "commit":
      case "reload":
        return true;
      case "select":
        return v.simulation === null || simulation(v.simulation);
      case "base":
        return simulation(v.simulation);
      case "inputs":
        return inputs(v.inputs);
      case "patch":
        return (
          nodeProps(v.patches) &&
          isRecord(v.statuses) &&
          Object.entries(v.statuses).length <= LIMITS.nodes &&
          Object.values(v.statuses).every((s) => STATUSES.has(s as string))
        );
      case "inject":
        return (
          str(v.node) &&
          int(v.count, 1, LIMITS.injectCount) &&
          (v.opts === undefined ||
            (isRecord(v.opts) &&
              (v.opts.type === undefined || str(v.opts.type)) &&
              (v.opts.spreadMs === undefined || num(v.opts.spreadMs, 0, 600_000)) &&
              (v.opts.routeId === undefined || str(v.opts.routeId)) &&
              Object.keys(v.opts).every((k) => ["type", "spreadMs", "routeId"].includes(k))))
        );
      case "injectSources":
        return int(v.count, 1, LIMITS.injectCount);
      case "sendOne":
        return str(v.node) && (v.type === undefined || str(v.type));
      case "fault":
        return faultProblem(v.fault) === undefined;
      case "status":
        return str(v.node) && STATUSES.has(v.status as string);
      case "props":
        return str(v.node) && isRecord(v.patch) && plain(v.patch, LIMITS.depth);
      default:
        return false;
    }
  })();
  return ok ? (v as unknown as LiveOp) : undefined;
}

function entry(v: unknown): WireEntry | undefined {
  if (!isRecord(v) || !int(v.seq, 1, 1e9) || !int(v.tick, 0, LIMITS.seekMs / 10)) return undefined;
  const op = parseOp(v.op);
  return op ? { seq: v.seq as number, tick: v.tick as number, op } : undefined;
}

function start(v: unknown): RunStart | undefined {
  if (!isRecord(v) || !str(v.engine, 64) || typeof v.traffic !== "boolean" || !num(v.speed, 0.25, 8)) return undefined;
  if (typeof v.title !== "string" || v.title.length > 200) return undefined;
  if (!(v.simulation === null || simulation(v.simulation)) || !inputs(v.inputs)) return undefined;
  return v as unknown as RunStart;
}

const clock = (v: Record<string, unknown>) =>
  int(v.tick, 0, LIMITS.seekMs / 10) && typeof v.playing === "boolean" && num(v.speed, 0.25, 8);

/** A whole message, checked in full (every nested op too), or undefined. */
export function parseMessage(v: unknown): LiveMessage | undefined {
  if (!isRecord(v) || typeof v.t !== "string") return undefined;
  if (v.t === "hello") return { t: "hello" };
  if (typeof v.run !== "string" || !RUN.test(v.run)) return undefined;
  const run = v.run;
  switch (v.t) {
    case "start": {
      const s = start(v.start);
      return s ? { t: "start", run, start: s } : undefined;
    }
    case "log": {
      if (!Array.isArray(v.entries) || v.entries.length > LIMITS.entriesPerMessage || typeof v.done !== "boolean")
        return undefined;
      const entries = v.entries.map(entry);
      if (entries.some((e) => !e)) return undefined;
      if (v.done && !(isRecord(v.clock) && clock(v.clock))) return undefined;
      return {
        t: "log",
        run,
        entries: entries as WireEntry[],
        done: v.done,
        ...(v.done ? { clock: v.clock as { tick: number; playing: boolean; speed: number } } : {}),
      };
    }
    case "op": {
      const e = entry(v.entry);
      return e ? { t: "op", run, entry: e } : undefined;
    }
    case "beacon":
      return clock(v)
        ? { t: "beacon", run, tick: v.tick as number, playing: v.playing as boolean, speed: v.speed as number }
        : undefined;
    case "digest":
      return int(v.tick, 0, LIMITS.seekMs / 10) && int(v.seq, 0, 1e9) && int(v.hash, 0, 2 ** 32 - 1)
        ? { t: "digest", run, tick: v.tick as number, seq: v.seq as number, hash: v.hash as number }
        : undefined;
    case "stop":
      return { t: "stop", run };
    default:
      return undefined;
  }
}
