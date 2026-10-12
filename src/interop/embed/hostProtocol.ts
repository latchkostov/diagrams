// The host-supplied embed's message protocol (docs/EMBEDDING.md). A page embeds
// `?embed=1&host=1&hostOrigin=<its origin>` and hands the diagram over with postMessage, so the diagram stays
// behind the page's own login: it's never in a URL, never in this site's storage and never on a server.
//
// This module is pure (no DOM, no React): the envelope, the field checks, the origin rule and the rate limits.
// Everything here is unit-tested in hostProtocol.test.ts; the view (HostEmbedView.tsx) only wires it up.

import { LIMITS } from "../native";

/** Every message, both ways, carries this. A later, incompatible protocol gets a new name. */
export const PROTOCOL = "livediagrams.embed.v1";

/** The largest diagram a `load` may carry, as JSON text: the same limit as opening a file in the app. */
export const MAX_DIAGRAM_CHARS = LIMITS.maxTextChars;
/** Request ids, simulation ids and node ids are short strings. */
export const MAX_ID_CHARS = 200;
/** `highlight` takes at most this many node ids (the most a diagram may have). */
export const MAX_HIGHLIGHT = LIMITS.maxNodes;

/** Rate limits per session: a token bucket for every message, and a stricter one for `load`. */
export const RATE = {
  messages: { capacity: 60, perSecond: 30 },
  loads: { capacity: 5, perSecond: 0.5 },
} as const;

/** The live view's speeds (src/live/controller.ts SPEEDS; a unit test keeps the two the same). */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
export type EmbedTheme = "light" | "dark";

export interface LoadOptions {
  /** Light or dark. Default: the viewer's system setting. */
  theme?: EmbedTheme;
  /** A saved simulation's id to show in live view (null or absent: none). */
  simulation?: string | null;
  /** Start playing at once: the simulation, or free-play traffic when there's none. Default false. */
  autoplay?: boolean;
  /** Playback speed. Default 1. */
  speed?: Speed;
  /** Refit the whole diagram whenever the frame is resized. Default true. */
  fit?: boolean;
}

// ---------------------------------------------------------------- host -> frame

interface Base {
  /** Optional request id, echoed in the reply (`loaded` or `error`). */
  id?: string;
}

export type HostMessage =
  | (Base & { type: "load"; diagram: unknown; options: LoadOptions })
  | (Base & { type: "play" })
  | (Base & { type: "pause" })
  | (Base & { type: "setSpeed"; speed: Speed })
  | (Base & { type: "selectSimulation"; simulation: string | null })
  | (Base & { type: "fit" })
  | (Base & { type: "setTheme"; theme: EmbedTheme })
  | (Base & { type: "highlight"; nodeIds: string[] });

export type HostMessageType = HostMessage["type"];

export const HOST_MESSAGE_TYPES: readonly HostMessageType[] = [
  "load",
  "play",
  "pause",
  "setSpeed",
  "selectSimulation",
  "fit",
  "setTheme",
  "highlight",
];

// ---------------------------------------------------------------- frame -> host

export type ErrorCode =
  "invalid_message" | "too_large" | "invalid_diagram" | "not_loaded" | "unknown_simulation" | "rate_limited";

export type FrameMessage =
  | { type: "ready"; version: 1 }
  | {
      type: "loaded";
      id?: string;
      title: string;
      nodes: number;
      simulations: { id: string; title: string }[];
    }
  | { type: "error"; id?: string; code: ErrorCode; message: string }
  | { type: "nodeClick"; nodeId: string; label: string }
  | { type: "simulationChanged"; simulation: string | null }
  | { type: "playState"; playing: boolean; speed: number }
  | { type: "resize"; height: number };

/** What actually goes over the wire: the message plus the protocol name. */
export type Envelope<M> = M & { protocol: typeof PROTOCOL };

export const envelope = <M extends FrameMessage>(m: M): Envelope<M> => ({ protocol: PROTOCOL, ...m });

// ---------------------------------------------------------------- the host's origin

export type OriginResult = { ok: true; origin: string } | { ok: false; error: string };

/**
 * The origin that may drive this frame, from its URL's `hostOrigin` parameter. It must be a plain http(s)
 * origin (scheme, host, optional port; no path, query, credentials or wildcard), so it can be both the only
 * origin whose messages are read and the exact `targetOrigin` of every reply.
 */
export function hostOriginFromSearch(search: string): OriginResult {
  const raw = new URLSearchParams(search).get("hostOrigin");
  if (!raw)
    return {
      ok: false,
      error:
        "This embed doesn't say which page may send it the diagram. Add hostOrigin=<your page's origin> to its URL, or use the live-diagram web component, which adds it for you.",
    };
  return parseOrigin(raw);
}

export function parseOrigin(raw: string): OriginResult {
  const bad: OriginResult = {
    ok: false,
    error: `hostOrigin must be an origin like https://app.example.com, not “${raw.slice(0, 80)}”.`,
  };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return bad;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return bad;
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return bad;
  // Only what the browser would report as event.origin: "https://a.example/" and "https://a.example" are the
  // same, anything else (a path, "*", "null") isn't an origin.
  if (raw.replace(/\/$/, "") !== u.origin) return bad;
  return { ok: true, origin: u.origin };
}

/**
 * The one gate for every incoming message: from the window that framed this one (not a sibling, a pop-up
 * or this window itself) and from the locked origin. Anything else is dropped without a reply.
 */
export function isFromHost(
  event: { source: unknown; origin: string },
  ctx: { parent: unknown; self: unknown; origin: string },
): boolean {
  return ctx.parent !== ctx.self && event.source === ctx.parent && event.origin === ctx.origin;
}

// ---------------------------------------------------------------- parsing

export type Parsed =
  /** Not for us (another protocol, not an object, an unknown type): dropped silently. */
  { kind: "ignore" } | { kind: "invalid"; id?: string; message: string } | { kind: "ok"; message: HostMessage };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_CHARS;
const isSpeed = (v: unknown): v is Speed => typeof v === "number" && (SPEEDS as readonly number[]).includes(v);
const isTheme = (v: unknown): v is EmbedTheme => v === "light" || v === "dark";
const SPEED_LIST = SPEEDS.join(", ");

function parseOptions(raw: unknown): { ok: true; options: LoadOptions } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, options: {} };
  if (!isObj(raw)) return { ok: false, message: "options must be an object." };
  const o: LoadOptions = {};
  if (raw.theme !== undefined) {
    if (!isTheme(raw.theme)) return { ok: false, message: `options.theme must be "light" or "dark".` };
    o.theme = raw.theme;
  }
  if (raw.simulation !== undefined && raw.simulation !== null) {
    if (!isId(raw.simulation)) return { ok: false, message: "options.simulation must be a simulation id." };
    o.simulation = raw.simulation;
  }
  for (const key of ["autoplay", "fit"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") return { ok: false, message: `options.${key} must be true or false.` };
    o[key] = raw[key];
  }
  if (raw.speed !== undefined) {
    if (!isSpeed(raw.speed)) return { ok: false, message: `options.speed must be one of ${SPEED_LIST}.` };
    o.speed = raw.speed;
  }
  return { ok: true, options: o };
}

/**
 * Reads one message's data. Never evaluates anything: only plain fields are read, each checked for type and
 * size. Unknown types and other protocols are ignored (a newer host talking to an older frame keeps working).
 */
export function parseHostMessage(data: unknown): Parsed {
  if (!isObj(data) || data.protocol !== PROTOCOL || typeof data.type !== "string") return { kind: "ignore" };
  const type = data.type as HostMessageType;
  if (!HOST_MESSAGE_TYPES.includes(type)) return { kind: "ignore" };
  if (data.id !== undefined && !isId(data.id))
    return { kind: "invalid", message: `id must be a string of 1 to ${MAX_ID_CHARS} characters.` };
  const id = data.id as string | undefined;
  const base = id === undefined ? {} : { id };
  const invalid = (message: string): Parsed => ({ kind: "invalid", ...base, message: `${type}: ${message}` });
  switch (type) {
    case "load": {
      if (data.diagram === undefined || data.diagram === null) return invalid("diagram is missing.");
      if (typeof data.diagram !== "string" && !isObj(data.diagram))
        return invalid("diagram must be the diagram object or its JSON text.");
      const options = parseOptions(data.options);
      if (!options.ok) return invalid(options.message);
      return { kind: "ok", message: { type, ...base, diagram: data.diagram, options: options.options } };
    }
    case "play":
    case "pause":
    case "fit":
      return { kind: "ok", message: { type, ...base } };
    case "setSpeed":
      if (!isSpeed(data.speed)) return invalid(`speed must be one of ${SPEED_LIST}.`);
      return { kind: "ok", message: { type, ...base, speed: data.speed } };
    case "selectSimulation":
      if (data.simulation !== null && !isId(data.simulation))
        return invalid("simulation must be a simulation id, or null for free play.");
      return { kind: "ok", message: { type, ...base, simulation: data.simulation as string | null } };
    case "setTheme":
      if (!isTheme(data.theme)) return invalid(`theme must be "light" or "dark".`);
      return { kind: "ok", message: { type, ...base, theme: data.theme } };
    case "highlight": {
      const ids = data.nodeIds;
      if (!Array.isArray(ids) || ids.length > MAX_HIGHLIGHT || !ids.every(isId))
        return invalid(`nodeIds must be a list of at most ${MAX_HIGHLIGHT} node ids ([] clears).`);
      return { kind: "ok", message: { type, ...base, nodeIds: [...new Set(ids as string[])] } };
    }
  }
}

/**
 * The diagram's JSON text, or why it's refused: checked for size before anything parses it. A string is
 * measured as it is; an object (structured-cloned by postMessage) by its JSON form.
 */
export function diagramText(diagram: unknown): { ok: true; text: string } | { ok: false; tooLarge: boolean } {
  if (typeof diagram === "string")
    return diagram.length > MAX_DIAGRAM_CHARS ? { ok: false, tooLarge: true } : { ok: true, text: diagram };
  let text: string | undefined;
  try {
    text = JSON.stringify(diagram);
  } catch {
    // A cycle can't be cloned by postMessage, but a very deep object can overflow JSON.stringify.
    return { ok: false, tooLarge: false };
  }
  if (typeof text !== "string") return { ok: false, tooLarge: false };
  return text.length > MAX_DIAGRAM_CHARS ? { ok: false, tooLarge: true } : { ok: true, text };
}

// ---------------------------------------------------------------- rate limits

/** A token bucket: `take()` is false once the burst is spent, until enough time has passed. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** The session's limits: every message spends one token; a `load` also spends one of its own. */
export class HostRateLimiter {
  private messages: TokenBucket;
  private loads: TokenBucket;
  private lastRefusal = -Infinity;
  constructor(now: number) {
    this.messages = new TokenBucket(RATE.messages.capacity, RATE.messages.perSecond, now);
    this.loads = new TokenBucket(RATE.loads.capacity, RATE.loads.perSecond, now);
  }
  /** "ok", or "drop" (over the limit), or "refuse" (over the limit, and say so: at most once a second). */
  admit(type: string, now: number): "ok" | "drop" | "refuse" {
    const ok = this.messages.take(now) && (type !== "load" || this.loads.take(now));
    if (ok) return "ok";
    if (now - this.lastRefusal < 1000) return "drop";
    this.lastRefusal = now;
    return "refuse";
  }
}
