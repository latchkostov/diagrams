import { bytesToText, textToBytes } from "../interop/codec";
import type { Clock } from "./clock";
import { COLLAB_LIMITS } from "./limits";

// Presence: who else is in the room, as each person describes themselves. Ephemeral (no history, no undo, no
// export), sent only on the encrypted presence channel, keyed by the sender's session id, and labelled unverified
// in any UI: an alias is a name someone typed, not an identity. Entries expire on the room clock when their sender
// stops refreshing them (a closed laptop sends no goodbye).

export const PRESENCE_STATUSES = ["active", "idle", "away"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** Eight colours that read on both themes; people are told apart by alias too, never by colour alone. */
export const PRESENCE_COLOURS = [
  "#2563eb",
  "#db2777",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#4d7c0f",
] as const;

export interface PresenceState {
  alias: string;
  /** Index into PRESENCE_COLOURS. */
  colour: number;
  status: PresenceStatus;
  /** What this person has selected (flow ids of nodes, connections and boundaries): bounded (MAX_SELECTION). */
  selection?: string[];
  /** Where their pointer is over the canvas, in flow coordinates (absent: not over it). */
  cursor?: { x: number; y: number };
}

/** Ids a presence frame carries at most: the rest of a big selection isn't drawn for others. */
export const MAX_SELECTION = 32;
/** Cursor coordinates beyond this are nonsense (no diagram is that large): refused. */
const MAX_COORD = 1e7;

export interface PeerPresence extends PresenceState {
  /** Sender session id (hex). Changes on every join: not a stable identity. */
  sender: string;
  /** Room-clock time of the last refresh. */
  seen: number;
  /** Room-clock time their cursor last moved (a cursor still for a while is hidden). */
  cursorAt?: number;
}

const ANIMALS = [
  "Heron",
  "Otter",
  "Lynx",
  "Wren",
  "Ibex",
  "Marten",
  "Puffin",
  "Gecko",
  "Bison",
  "Kestrel",
  "Newt",
  "Orca",
];

/** A room-specific alias: not reused across rooms, so it can't link one person's rooms together. */
export function randomAlias(random: () => number): PresenceState {
  return {
    alias: `Anonymous ${ANIMALS[Math.floor(random() * ANIMALS.length)]}`,
    colour: Math.floor(random() * PRESENCE_COLOURS.length),
    status: "active",
  };
}

// eslint-disable-next-line no-control-regex -- stripping control and bidi-override characters is the point.
const CONTROL = new RegExp("[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]", "g");

/** Parses a peer's presence payload; undefined when it isn't exactly a valid state. */
export function parsePresence(bytes: Uint8Array): PresenceState | undefined {
  if (bytes.length > COLLAB_LIMITS.maxPresenceFrameBytes) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(bytesToText(bytes));
  } catch {
    return undefined;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!["alias", "colour", "status"].every((k) => keys.includes(k))) return undefined;
  if (keys.some((k) => !["alias", "colour", "status", "selection", "cursor"].includes(k))) return undefined;
  if (typeof o.alias !== "string") return undefined;
  // Control and bidirectional-override characters could disguise one alias as another.
  const alias = o.alias.replace(CONTROL, "").trim().slice(0, COLLAB_LIMITS.maxAliasChars);
  if (!alias) return undefined;
  if (!Number.isInteger(o.colour) || (o.colour as number) < 0 || (o.colour as number) >= PRESENCE_COLOURS.length)
    return undefined;
  if (!PRESENCE_STATUSES.includes(o.status as PresenceStatus)) return undefined;
  const state: PresenceState = { alias, colour: o.colour as number, status: o.status as PresenceStatus };
  if (o.selection !== undefined) {
    const ids = o.selection;
    if (
      !Array.isArray(ids) ||
      ids.length > MAX_SELECTION ||
      !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= COLLAB_LIMITS.maxKeyChars)
    )
      return undefined;
    state.selection = [...new Set(ids as string[])];
  }
  if (o.cursor !== undefined) {
    const c = o.cursor as Record<string, unknown> | null;
    if (typeof c !== "object" || c === null || Array.isArray(c)) return undefined;
    const ck = Object.keys(c);
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_COORD;
    if (ck.length !== 2 || !ok(c.x) || !ok(c.y)) return undefined;
    state.cursor = { x: c.x as number, y: c.y as number };
  }
  return state;
}

/**
 * A presence payload, within its frame's bound: a selection that wouldn't fit is cut short (its first ids are the
 * ones others see named).
 */
export function encodePresence(s: PresenceState): Uint8Array {
  const base = { alias: s.alias, colour: s.colour, status: s.status };
  const cursor = s.cursor && { x: Math.round(s.cursor.x * 10) / 10, y: Math.round(s.cursor.y * 10) / 10 };
  let ids = (s.selection ?? []).slice(0, MAX_SELECTION);
  for (;;) {
    const bytes = textToBytes(
      JSON.stringify({ ...base, ...(ids.length ? { selection: ids } : {}), ...(cursor ? { cursor } : {}) }),
    );
    // Room for the frame's own header and the envelope around it.
    if (bytes.length <= COLLAB_LIMITS.maxPresenceFrameBytes - 256 || !ids.length) return bytes;
    ids = ids.slice(0, Math.floor(ids.length / 2));
  }
}

/** Peers' presence, keyed by sender; bounded and expiring. */
export class PresenceTable {
  private peers = new Map<string, PeerPresence & { counter: number }>();
  /** Counts changes to what the table says (who, their names, selections, cursors): subscribers compare it. */
  revision = 0;

  constructor(private readonly clock: Clock) {}

  /** A state from `sender`'s frame number `counter`; an older frame (reordered) never overwrites a newer one. */
  receive(sender: string, counter: number, state: PresenceState): boolean {
    const prev = this.peers.get(sender);
    if (prev && prev.counter >= counter) return false;
    if (!prev && this.peers.size >= COLLAB_LIMITS.maxSenders) return false;
    const now = this.clock.now();
    const moved = !!state.cursor && (prev?.cursor?.x !== state.cursor.x || prev?.cursor?.y !== state.cursor.y);
    const cursorAt = state.cursor ? (moved ? now : prev?.cursorAt) : undefined;
    this.peers.set(sender, { ...state, sender, seen: now, counter, ...(cursorAt !== undefined ? { cursorAt } : {}) });
    this.revision++;
    return true;
  }

  remove(sender: string): boolean {
    if (!this.peers.delete(sender)) return false;
    this.revision++;
    return true;
  }

  /** Drops entries not refreshed within the TTL; returns whether any went. */
  expire(): boolean {
    const now = this.clock.now();
    let changed = false;
    for (const [sender, p] of this.peers)
      if (now - p.seen > COLLAB_LIMITS.presenceTtlMs) {
        this.peers.delete(sender);
        changed = true;
      }
    if (changed) this.revision++;
    return changed;
  }

  list(): PeerPresence[] {
    this.expire();
    return [...this.peers.values()]
      .map(({ counter: _counter, ...p }) => p)
      .sort((a, b) => a.alias.localeCompare(b.alias) || a.sender.localeCompare(b.sender));
  }
}
