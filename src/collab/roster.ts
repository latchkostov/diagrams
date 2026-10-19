import { bytesToBase64Url, base64UrlToBytes } from "../interop/codec";
import { publicKeyBytes, sign, signedBytes, verify, type Identity } from "./signing";

// A signed room's roster (meeting hosts design §2, P4): who hosts, who co-hosts, who may edit, who drives Live, and
// whether new people can only view. Nobody holds it as a value: it's a set of signed entries, each made by a member's
// identity (./signing.ts), replicated to everyone and served to newcomers, from which every peer derives the same
// roles. Its root is the host key in the room's link (the creator's identity): nothing counts that can't be traced
// back to it.
//
// - Entries are ordered by a Lamport counter, ties broken by the signer's key, then the signature: every peer that
//   holds the same entries folds them in the same order, whatever order they came in, so a partition merges into one
//   roster, not two.
// - An entry counts only if its signer had the authority for it at its place in that order (below). One that didn't
//   is kept (an entry that sorts earlier may still arrive) but changes nothing.
// - Editors are only ever added: no entry makes an editor a viewer, so an edit an honest peer accepted is one every
//   honest peer accepts (./session.ts). Making an editor a viewer again needs a new epoch (P5).
// - Bounded: MAX_ROSTER_ENTRIES in all, MAX_ENTRIES_PER_SIGNER from any one key, and only entries from someone who
//   can edit are kept at all, so a viewer can't fill the roster with entries that change nothing.
//
//   admit     `who` can edit. By the host or a co-host any time ("Can edit"); by any editor while new people may
//             edit (honest editors admit newcomers then).
//   cohost    the host or a co-host makes `who` a co-host (who can edit, too)
//   uncohost  the host or a co-host takes `who`'s co-hosting back (`who` still edits)
//   drive     the host or a co-host lets `who` drive Live (the host's own key: the host drives)
//   host      the host hands the room to `who`; the old host becomes the first co-host, and Live stays as it was
//   policy    the host or a co-host says whether new people can only view (`viewOnly`)

export type RosterOp = "admit" | "cohost" | "uncohost" | "drive" | "host" | "policy";
const OPS = new Set<RosterOp>(["admit", "cohost", "uncohost", "drive", "host", "policy"]);
const FIELDS = new Set(["n", "by", "op", "who", "viewOnly", "sig"]);

export interface RosterEntry {
  /** Lamport counter: one more than the highest the signer knew. */
  n: number;
  /** The signer's key. */
  by: string;
  op: RosterOp;
  who?: string;
  viewOnly?: boolean;
  /** Ed25519 over the room id, the epoch and the fields above (base64url, 86 characters). */
  sig: string;
}

export interface RosterState {
  host: string;
  /** Co-hosts, the earliest made first. */
  cohosts: string[];
  /** Everyone who can edit (the host and co-hosts included). */
  editors: ReadonlySet<string>;
  /** Who drives Live; absent, the host. */
  driver?: string;
  /** New people can only view until someone lets them edit. */
  viewOnly: boolean;
}

/** Entries a roster holds at most, and from one signer: an honest room's grants and handovers come nowhere near. */
export const MAX_ROSTER_ENTRIES = 1024;
export const MAX_ENTRIES_PER_SIGNER = 256;
const MAX_COUNTER = 2 ** 31;
const SIG = /^[A-Za-z0-9_-]{86}$/;

const entryBytes = (roomId: string, epoch: number, e: Omit<RosterEntry, "sig">) =>
  signedBytes(
    "livediagrams/roster/v1",
    roomId,
    epoch,
    e.n,
    e.by,
    e.op,
    e.who ?? "",
    e.viewOnly === undefined ? "" : e.viewOnly ? "1" : "0",
  );

/** An entry signed by `identity` for this room and epoch (whatever its authority: the fold decides what it does). */
export async function signEntry(
  identity: Identity,
  roomId: string,
  epoch: number,
  body: Omit<RosterEntry, "sig" | "by">,
): Promise<RosterEntry> {
  const unsigned = { ...body, by: identity.key };
  const sig = bytesToBase64Url(await sign(identity.privateKey, entryBytes(roomId, epoch, unsigned)));
  return { ...unsigned, sig };
}

/** An entry's shape, or undefined (its signature is checked separately). */
export function parseEntry(v: unknown): RosterEntry | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const e = v as Record<string, unknown>;
  if (Object.keys(e).some((k) => !FIELDS.has(k))) return undefined;
  if (!Number.isInteger(e.n) || (e.n as number) < 1 || (e.n as number) > MAX_COUNTER) return undefined;
  if (typeof e.by !== "string" || !publicKeyBytes(e.by)) return undefined;
  if (typeof e.op !== "string" || !OPS.has(e.op as RosterOp)) return undefined;
  const op = e.op as RosterOp;
  if (op === "policy" ? e.who !== undefined : typeof e.who !== "string" || !publicKeyBytes(e.who)) return undefined;
  if (op === "policy" ? typeof e.viewOnly !== "boolean" : e.viewOnly !== undefined) return undefined;
  if (typeof e.sig !== "string" || !SIG.test(e.sig)) return undefined;
  return {
    n: e.n as number,
    by: e.by,
    op,
    ...(op === "policy" ? { viewOnly: e.viewOnly as boolean } : { who: e.who as string }),
    sig: e.sig,
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: RosterEntry, b: RosterEntry) => a.n - b.n || compare(a.by, b.by) || compare(a.sig, b.sig);

interface Folding {
  host: string;
  cohosts: string[];
  editors: Set<string>;
  driver?: string;
  viewOnly: boolean;
}

/** Whether `by` may make an entry of `op` in state `s`. */
function authorised(s: Folding | RosterState, by: string, op: RosterOp): boolean {
  const lead = by === s.host || s.cohosts.includes(by);
  switch (op) {
    case "admit":
      return lead || (s.editors.has(by) && !s.viewOnly);
    case "host":
      return by === s.host;
    default:
      return lead;
  }
}

/** The roles `entries` give, in their order, from the room's host key. */
export function fold(hostKey: string, entries: readonly RosterEntry[]): RosterState {
  const s: Folding = { host: hostKey, cohosts: [], editors: new Set([hostKey]), viewOnly: false };
  for (const e of [...entries].sort(order)) {
    if (!authorised(s, e.by, e.op)) continue;
    const who = e.who ?? "";
    switch (e.op) {
      case "admit":
        s.editors.add(who);
        break;
      case "cohost":
        if (who !== s.host && !s.cohosts.includes(who)) s.cohosts.push(who);
        s.editors.add(who);
        break;
      case "uncohost":
        s.cohosts = s.cohosts.filter((c) => c !== who);
        break;
      case "drive":
        s.driver = who === s.host ? undefined : who;
        break;
      case "host":
        if (who === s.host) break;
        // Live stays as it was: the old host's own driving (no driver) is the old host's key from here.
        s.driver ??= s.host;
        s.cohosts = [s.host, ...s.cohosts.filter((c) => c !== who)];
        s.host = who;
        s.editors.add(who);
        if (s.driver === who) s.driver = undefined;
        break;
      case "policy":
        s.viewOnly = !!e.viewOnly;
        break;
    }
  }
  return { host: s.host, cohosts: s.cohosts, editors: s.editors, driver: s.driver, viewOnly: s.viewOnly };
}

export interface AddResult {
  /** New entries kept. */
  added: number;
  /** Malformed, forged (a signature that doesn't verify), or from someone who can't edit. */
  refused: number;
  /** Not checked: the verification budget ran out (sent again, they're checked then). */
  throttled: number;
}

/** One room's roster: its verified entries (bounded), the roles they give, and new entries made by this member. */
export class SignedRoster {
  private readonly entries = new Map<string, RosterEntry>();
  private cached?: RosterState;
  private readonly listeners = new Set<() => void>();

  constructor(
    /** The room's root: the host key in its link. */
    readonly hostKey: string,
    /** The room id (base64url) and epoch every entry is bound to: one from another room or epoch doesn't verify. */
    readonly roomId: string,
    readonly epoch: number,
  ) {}

  /** The entries, in their order (to keep, or to send a peer). */
  log(): RosterEntry[] {
    return [...this.entries.values()].sort(order);
  }

  get size(): number {
    return this.entries.size;
  }

  state(): RosterState {
    return (this.cached ??= fold(this.hostKey, [...this.entries.values()]));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Entries from a peer or this tab's record. Each new one is checked once: its shape, then its signature under its
   * signer's key for this room and epoch (`budget` says whether another verification may run now). It's kept once its
   * signer can edit, by the entries kept so far or among these: a forged entry, or one from a viewer, never is.
   */
  async add(list: readonly unknown[], budget: () => boolean = () => true): Promise<AddResult> {
    const result: AddResult = { added: 0, refused: 0, throttled: 0 };
    const verified: RosterEntry[] = [];
    const seen = new Set<string>();
    for (const raw of list.slice(0, MAX_ROSTER_ENTRIES)) {
      const e = parseEntry(raw);
      if (!e) {
        result.refused++;
        continue;
      }
      if (this.entries.has(e.sig) || seen.has(e.sig)) continue;
      seen.add(e.sig);
      if (!budget()) {
        result.throttled++;
        continue;
      }
      if (await verify(e.by, base64UrlToBytes(e.sig), entryBytes(this.roomId, this.epoch, e))) verified.push(e);
      else result.refused++;
    }
    result.refused += list.length > MAX_ROSTER_ENTRIES ? list.length - MAX_ROSTER_ENTRIES : 0;
    // Kept in order, once their signer can edit: an editor made among these entries counts for the ones after.
    let pending = verified.sort(order);
    for (let progress = true; progress && pending.length;) {
      progress = false;
      const later: RosterEntry[] = [];
      for (const e of pending) {
        if (this.entries.has(e.sig)) continue;
        if (!this.state().editors.has(e.by)) {
          later.push(e);
          continue;
        }
        if (this.entries.size >= MAX_ROSTER_ENTRIES || this.countBy(e.by) >= MAX_ENTRIES_PER_SIGNER) {
          result.refused++;
          continue;
        }
        this.entries.set(e.sig, e);
        this.cached = undefined;
        result.added++;
        progress = true;
      }
      pending = later;
    }
    result.refused += pending.length;
    if (result.added) for (const l of this.listeners) l();
    return result;
  }

  private countBy(key: string): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.by === key) n++;
    return n;
  }

  /** Whether `key` may make an entry of `op` now. */
  may(key: string, op: RosterOp): boolean {
    return authorised(this.state(), key, op);
  }

  /** Whether there's room for another entry from `key`. */
  roomFor(key: string): boolean {
    return this.entries.size < MAX_ROSTER_ENTRIES && this.countBy(key) < MAX_ENTRIES_PER_SIGNER;
  }

  /**
   * A new entry by `identity`, signed and kept; undefined when it has no authority for it now, it would change
   * nothing, or the roster is full.
   */
  async append(
    identity: Identity,
    op: RosterOp,
    fields: { who?: string; viewOnly?: boolean } = {},
  ): Promise<RosterEntry | undefined> {
    if (!this.may(identity.key, op) || !this.roomFor(identity.key) || !this.changes(op, fields)) return undefined;
    let top = 0;
    for (const e of this.entries.values()) top = Math.max(top, e.n);
    const entry = await signEntry(identity, this.roomId, this.epoch, {
      n: Math.min(MAX_COUNTER, top + 1),
      op,
      ...fields,
    });
    const { added } = await this.add([entry]);
    return added ? entry : undefined;
  }

  /** Whether an entry would change the roles as they stand (else it isn't worth a place in the roster). */
  private changes(op: RosterOp, f: { who?: string; viewOnly?: boolean }): boolean {
    const s = this.state();
    switch (op) {
      case "admit":
        return !!f.who && !s.editors.has(f.who);
      case "cohost":
        return !!f.who && f.who !== s.host && !s.cohosts.includes(f.who);
      case "uncohost":
        return !!f.who && s.cohosts.includes(f.who);
      case "drive":
        return !!f.who && (f.who === s.host ? s.driver !== undefined : s.driver !== f.who);
      case "host":
        return !!f.who && f.who !== s.host;
      case "policy":
        return f.viewOnly !== undefined && f.viewOnly !== s.viewOnly;
    }
  }
}
