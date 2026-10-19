import type { RoomRole } from "./tabRoom";

// The room's roles as this tab holds them (P3, cooperative), owned by the room's lifecycle and kept in the tab's
// record (./tabRoom.ts), so a reload keeps them: whether this person hosts now (not how they came in: a host can hand
// the room on, and a joiner can be handed it), and the last roster a host said. People are named by member id, which
// each tab keeps across its reloads (a session's sender id changes on every join), so a roster still means the same
// people after any of them reloads.

export interface RosterRecord {
  /** This tab's member id (hex): the same across its reloads. */
  member: string;
  /** This person hosts the room now. */
  hosting: boolean;
  /** The last roster a host said (members): the host, co-hosts (earliest first) and who drives (absent: the host). */
  host?: string;
  cohosts: string[];
  driver?: string;
}

const MEMBER = /^[0-9a-f]{16}$/;

/** A record as stored, or undefined when it isn't exactly one. */
export function parseRoster(v: unknown): RosterRecord | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const member = (x: unknown): x is string => typeof x === "string" && MEMBER.test(x);
  if (!member(r.member) || typeof r.hosting !== "boolean") return undefined;
  if (!Array.isArray(r.cohosts) || r.cohosts.length > 8 || !r.cohosts.every(member)) return undefined;
  if ((r.host !== undefined && !member(r.host)) || (r.driver !== undefined && !member(r.driver))) return undefined;
  return {
    member: r.member,
    hosting: r.hosting,
    cohosts: r.cohosts,
    ...(member(r.host) ? { host: r.host } : {}),
    ...(member(r.driver) ? { driver: r.driver } : {}),
  };
}

/** A new room's roster for this tab: the creator hosts it. */
export function newRoster(role: RoomRole, random: (n: number) => Uint8Array): RosterRecord {
  const member = Array.from(random(8), (b) => b.toString(16).padStart(2, "0")).join("");
  return { member, hosting: role === "creator", cohosts: [] };
}

/** The lifecycle's roster service for the open room: read, changed (and saved with the tab's record), subscribed. */
export class RoomRoster {
  private readonly listeners = new Set<() => void>();

  constructor(
    private record: RosterRecord,
    private readonly save: () => void,
  ) {}

  get(): RosterRecord {
    return this.record;
  }

  update(patch: Partial<Omit<RosterRecord, "member">>): void {
    const next = { ...this.record, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.record)) return;
    this.record = next;
    this.save();
    for (const l of this.listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
