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
}

export interface PeerPresence extends PresenceState {
  /** Sender session id (hex). Changes on every join: not a stable identity. */
  sender: string;
  /** Room-clock time of the last refresh. */
  seen: number;
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
  if (keys.length !== 3 || !["alias", "colour", "status"].every((k) => keys.includes(k))) return undefined;
  if (typeof o.alias !== "string") return undefined;
  // Control and bidirectional-override characters could disguise one alias as another.
  const alias = o.alias.replace(CONTROL, "").trim().slice(0, COLLAB_LIMITS.maxAliasChars);
  if (!alias) return undefined;
  if (!Number.isInteger(o.colour) || (o.colour as number) < 0 || (o.colour as number) >= PRESENCE_COLOURS.length)
    return undefined;
  if (!PRESENCE_STATUSES.includes(o.status as PresenceStatus)) return undefined;
  return { alias, colour: o.colour as number, status: o.status as PresenceStatus };
}

export const encodePresence = (s: PresenceState) =>
  textToBytes(JSON.stringify({ alias: s.alias, colour: s.colour, status: s.status }));

/** Peers' presence, keyed by sender; bounded and expiring. */
export class PresenceTable {
  private peers = new Map<string, PeerPresence & { counter: number }>();

  constructor(private readonly clock: Clock) {}

  /** A state from `sender`'s frame number `counter`; an older frame (reordered) never overwrites a newer one. */
  receive(sender: string, counter: number, state: PresenceState): boolean {
    const prev = this.peers.get(sender);
    if (prev && prev.counter >= counter) return false;
    if (!prev && this.peers.size >= COLLAB_LIMITS.maxSenders) return false;
    this.peers.set(sender, { ...state, sender, seen: this.clock.now(), counter });
    return true;
  }

  remove(sender: string): boolean {
    return this.peers.delete(sender);
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
    return changed;
  }

  list(): PeerPresence[] {
    this.expire();
    return [...this.peers.values()]
      .map(({ counter: _counter, ...p }) => p)
      .sort((a, b) => a.alias.localeCompare(b.alias) || a.sender.localeCompare(b.sender));
  }
}
