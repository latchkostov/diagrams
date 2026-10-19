import { COLLAB_LIMITS } from "../limits";
import { MAX_LOG_ENTRIES, parseEntry, type RosterEntry } from "../roster";
import { publicKeyBytes, type StoredAgreement, type StoredIdentity } from "../signing";
import type { ChainData } from "../epochs";
import type { Wrap } from "../lobby";
import type { RoomRole } from "./tabRoom";

// The room's roles as this tab holds them (P3, cooperative), owned by the room's lifecycle and kept in the tab's
// record (./tabRoom.ts), so a reload keeps them: whether this person hosts now (not how they came in: a host can hand
// the room on, and a joiner can be handed it), and the last roster a host said. People are named by member id, which
// each tab keeps across its reloads (a session's sender id changes on every join), so a roster still means the same
// people after any of them reloads.
//
// A signed room (P4) keeps more: this tab's identity (its signing key: the same class of secret as the room link,
// kept only in this tab's record) and the roster's signed entries (../roster.ts), so a reload keeps the roles it
// had, checked again as it opens. There, the identity's key is the member id, and the roles are the roster's alone.

export interface RosterRecord {
  /** This tab's member id (hex): the same across its reloads. */
  member: string;
  /** This person hosts the room now. */
  hosting: boolean;
  /** The last roster a host said (members): the host, co-hosts (earliest first) and who drives (absent: the host). */
  host?: string;
  cohosts: string[];
  driver?: string;
  /** A signed room's member: this tab's identity, and the roster's entries as last known. */
  signed?: SignedRecord;
}

export interface SignedRecord {
  identity: StoredIdentity;
  log: RosterEntry[];
  /**
   * A knock-to-join room's member (v3): its key-agreement key, the room's epochs, the current epoch's secret
   * (base64url: the same class of secret as the room link, kept only in this tab) and the wraps it holds for others.
   * Everything is checked again as the room opens.
   */
  knock?: KnockRecord;
}

export interface KnockRecord {
  agreement: StoredAgreement;
  chain: ChainData;
  /** Absent: at the door (not let in yet). */
  secret?: string;
  /** The epoch the secret is for (its scope). */
  scope?: string;
  wraps: Wrap[];
}

function parseKnock(v: unknown): KnockRecord | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const k = v as Record<string, unknown>;
  const a = k.agreement as Record<string, unknown> | undefined;
  const jwk = a?.jwk as Record<string, unknown> | undefined;
  if (!a || typeof a.x !== "string" || !publicKeyBytes(a.x) || !jwk || jwk.kty !== "OKP" || jwk.crv !== "X25519")
    return undefined;
  const chain = k.chain as Record<string, unknown> | undefined;
  if (!chain || !Array.isArray(chain.starts) || !Array.isArray(chain.logs)) return undefined;
  if (k.secret !== undefined && (typeof k.secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(k.secret)))
    return undefined;
  if (!Array.isArray(k.wraps) || k.wraps.length > 64) return undefined;
  return {
    agreement: { x: a.x, jwk: jwk as JsonWebKey },
    chain: { starts: chain.starts, logs: chain.logs as ChainData["logs"] },
    ...(typeof k.secret === "string" ? { secret: k.secret } : {}),
    ...(typeof k.scope === "string" && k.scope.length < 120 ? { scope: k.scope } : {}),
    wraps: k.wraps as Wrap[],
  };
}

const MEMBER = /^[0-9a-f]{16}$/;

/** A signed record as stored (each entry's shape; signatures are checked again as the room opens). */
function parseSigned(v: unknown): SignedRecord | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const id = r.identity as Record<string, unknown> | undefined;
  if (!id || typeof id !== "object" || typeof id.key !== "string" || !publicKeyBytes(id.key)) return undefined;
  const jwk = id.jwk as Record<string, unknown> | undefined;
  if (!jwk || typeof jwk !== "object" || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string")
    return undefined;
  if (!Array.isArray(r.log) || r.log.length > MAX_LOG_ENTRIES) return undefined;
  const log = r.log.map(parseEntry);
  if (log.some((e) => !e)) return undefined;
  const knock = r.knock === undefined ? undefined : parseKnock(r.knock);
  if (r.knock !== undefined && !knock) return undefined;
  return { identity: { key: id.key, jwk: jwk as JsonWebKey }, log: log as RosterEntry[], ...(knock ? { knock } : {}) };
}

/** The id other tabs are asked about (a duplicated tab's check): a signed room's key, else the member id. */
export const memberId = (r: RosterRecord) => r.signed?.identity.key ?? r.member;

/** A record as stored, or undefined when it isn't exactly one. */
export function parseRoster(v: unknown): RosterRecord | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const member = (x: unknown): x is string => typeof x === "string" && MEMBER.test(x);
  if (!member(r.member) || typeof r.hosting !== "boolean") return undefined;
  if (!Array.isArray(r.cohosts) || r.cohosts.length > COLLAB_LIMITS.maxCohosts || !r.cohosts.every(member))
    return undefined;
  if ((r.host !== undefined && !member(r.host)) || (r.driver !== undefined && !member(r.driver))) return undefined;
  const signed = r.signed === undefined ? undefined : parseSigned(r.signed);
  if (r.signed !== undefined && !signed) return undefined;
  return {
    member: r.member,
    hosting: r.hosting,
    cohosts: r.cohosts,
    ...(member(r.host) ? { host: r.host } : {}),
    ...(member(r.driver) ? { driver: r.driver } : {}),
    ...(signed ? { signed } : {}),
  };
}

const newMember = (random: (n: number) => Uint8Array) =>
  Array.from(random(8), (b) => b.toString(16).padStart(2, "0")).join("");

/** A new room's roster for this tab: the creator hosts it. */
export function newRoster(role: RoomRole, random: (n: number) => Uint8Array): RosterRecord {
  return { member: newMember(random), hosting: role === "creator", cohosts: [] };
}

/**
 * A duplicated tab's roster (its record was copied with the tab, member id and all): an identity of its own, and no
 * claim to host (the tab it was copied from keeps that). The last roster a host said stays.
 */
export function clonedRoster(
  from: RosterRecord,
  random: (n: number) => Uint8Array,
  identity?: StoredIdentity,
): RosterRecord {
  const copy: RosterRecord = { ...from, member: newMember(random), hosting: false };
  // A signed room's copy gets an identity of its own too (the roster's entries stay: they're the room's).
  if (from.signed) copy.signed = identity ? { identity, log: from.signed.log } : undefined;
  if (!copy.signed) delete copy.signed;
  return copy;
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

  /**
   * A change, kept only as it can be read back: co-hosts once each and never this tab's own member, at most
   * COLLAB_LIMITS.maxCohosts (the earliest go first: a full roster drops its earliest), and a driver that's a member id.
   */
  update(patch: Partial<RosterRecord>): void {
    const merged = { ...this.record, ...patch };
    const cohosts = [...new Set(merged.cohosts)].filter((m) => m !== merged.host);
    const next = parseRoster({ ...merged, cohosts: cohosts.slice(-COLLAB_LIMITS.maxCohosts) });
    if (!next || JSON.stringify(next) === JSON.stringify(this.record)) return;
    this.record = next;
    this.save();
    for (const l of this.listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
