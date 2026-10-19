import { bytesToBase64Url, base64UrlToBytes } from "../interop/codec";
import { publicKeyBytes, sign, signedBytes, verify, type Identity } from "./signing";

// A signed room's roster (meeting hosts design §2, P4): who hosts, who co-hosts, who can edit, who drives Live, and
// whether new people can only view. Nobody holds it as a value: it's a set of signed entries, each made by a member's
// identity (./signing.ts), replicated to everyone and served to newcomers, from which every peer derives the same
// roles. Its root is the host key in the room's link (the creator's identity): nothing counts that can't be traced
// back to it. Every entry is bound to the room id and the key epoch: none carries over to another room or epoch, and
// a new epoch (P5) starts its roster afresh.
//
// Causal authority. Each entry names the entries its signer had seen (`deps`: the heads of the roster it held), and
// its Lamport counter is exactly one more than theirs. Whether an entry counts depends only on its own causal past:
// its signer must have had the authority for it there. That past never changes once the entry exists, so an entry
// that counts always counts, whatever arrives later: a concurrent "Not a co-host" or "New people can view only"
// can't undo an admission that was already valid.
//
// - Who can edit is permanent: the host, and everyone a valid admit, co-host or host entry names. Nothing removes an
//   editor (that takes a new epoch: P5), so an edit one honest peer accepted is one every honest peer accepts.
// - Only the host and co-hosts admit. A plain editor's admission never counts, so the "view only" switch can't be
//   got round by an editor signing an admission that claims to predate it: admitting always takes fresh host or
//   co-host authority.
// - The rest (who hosts, co-hosts, who drives, the switch) is a projection: the entries that count, folded in their
//   order (Lamport counter, then signer key, then signature: every peer holding the same entries gets the same roles,
//   so a partition merges into one roster), each applied only if its signer still had the authority at its place in
//   that fold.
// - Kept only once its past is here and it counts; bounded (MAX_ROSTER_ENTRIES in all, MAX_ENTRIES_PER_SIGNER from
//   one key, MAX_PENDING waiting for their past); signatures in their one canonical spelling, so one signature is
//   one entry.
//
//   admit     the host or a co-host lets `who` edit ("Can edit"; their pages admit newcomers while new people may edit)
//   cohost    the host or a co-host makes `who` a co-host (who can edit, too)
//   uncohost  the host or a co-host takes `who`'s co-hosting back (`who` still edits)
//   drive     the host or a co-host lets `who` drive Live (the host's own key: the host drives)
//   host      the host hands the room to `who`; the old host becomes the first co-host, and Live stays as it was
//   policy    the host or a co-host says whether new people can only view (`viewOnly`)

export type RosterOp = "admit" | "cohost" | "uncohost" | "drive" | "host" | "policy";
const OPS = new Set<RosterOp>(["admit", "cohost", "uncohost", "drive", "host", "policy"]);
const FIELDS = new Set(["n", "by", "op", "who", "viewOnly", "deps", "sig"]);

export interface RosterEntry {
  /** Lamport counter: one more than the highest of its deps (1 with none). */
  n: number;
  /** The signer's key. */
  by: string;
  op: RosterOp;
  who?: string;
  viewOnly?: boolean;
  /** The entries its signer had seen (the heads of its roster): signatures, sorted. */
  deps: string[];
  /** Ed25519 over the room id, the epoch and the fields above (base64url, canonical, 86 characters). */
  sig: string;
}

export interface RosterState {
  host: string;
  /** Co-hosts, the earliest made first. */
  cohosts: string[];
  /** Everyone who can edit (the host and co-hosts included): only ever grows. */
  editors: ReadonlySet<string>;
  /** Who drives Live; absent, the host. */
  driver?: string;
  /** New people can only view until someone lets them edit. */
  viewOnly: boolean;
}

/** Entries a roster holds at most, from one signer, and waiting for their past: an honest room comes nowhere near. */
export const MAX_ROSTER_ENTRIES = 1024;
export const MAX_ENTRIES_PER_SIGNER = 256;
export const MAX_PENDING = 256;
/** Heads an entry names at most (its signer's roster rarely has more than a few). */
export const MAX_DEPS = 32;
const MAX_COUNTER = 2 ** 31;
const SIG = /^[A-Za-z0-9_-]{86}$/;

/** A signature in its one canonical spelling (64 bytes; 86 characters carry 516 bits, the last 4 zero). */
const canonicalSig = (s: unknown): s is string => {
  if (typeof s !== "string" || !SIG.test(s)) return false;
  try {
    const bytes = base64UrlToBytes(s);
    return bytes.length === 64 && bytesToBase64Url(bytes) === s;
  } catch {
    return false;
  }
};

const entryBytes = (roomId: string, epoch: number, e: Omit<RosterEntry, "sig">) =>
  signedBytes(
    "livediagrams/roster/v2",
    roomId,
    epoch,
    e.n,
    e.by,
    e.op,
    e.who ?? "",
    e.viewOnly === undefined ? "" : e.viewOnly ? "1" : "0",
    e.deps.join(","),
  );

/** An entry signed by `identity` for this room and epoch (whatever its authority: its past decides). */
export async function signEntry(
  identity: Identity,
  roomId: string,
  epoch: number,
  body: Omit<RosterEntry, "sig" | "by">,
): Promise<RosterEntry> {
  const unsigned = { ...body, deps: [...body.deps].sort(), by: identity.key };
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
  if (!Array.isArray(e.deps) || e.deps.length > MAX_DEPS || !e.deps.every(canonicalSig)) return undefined;
  const deps = e.deps as string[];
  // Sorted and once each: one spelling per entry.
  if (deps.some((d, i) => i > 0 && deps[i - 1] >= d)) return undefined;
  if (!canonicalSig(e.sig)) return undefined;
  return {
    n: e.n as number,
    by: e.by,
    op,
    ...(op === "policy" ? { viewOnly: e.viewOnly as boolean } : { who: e.who as string }),
    deps,
    sig: e.sig,
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const order = (a: RosterEntry, b: RosterEntry) => a.n - b.n || compare(a.by, b.by) || compare(a.sig, b.sig);

/** Whether `by` may make an entry of `op` in state `s`: the host hands the room on; the host and co-hosts the rest. */
function authorised(s: RosterState, by: string, op: RosterOp): boolean {
  if (op === "host") return by === s.host;
  return by === s.host || s.cohosts.includes(by);
}

/**
 * The roles that `entries` (each one that counts) give, from the room's host key: editors from every grant, the rest
 * folded in order, each change applied only if its signer still had the authority at its place.
 */
export function fold(hostKey: string, entries: readonly RosterEntry[]): RosterState {
  let host = hostKey;
  let cohosts: string[] = [];
  const editors = new Set([hostKey]);
  let driver: string | undefined;
  let viewOnly = false;
  for (const e of [...entries].sort(order)) {
    const who = e.who ?? "";
    if (e.op === "admit" || e.op === "cohost" || e.op === "host") editors.add(who);
    if (!authorised({ host, cohosts, editors, driver, viewOnly }, e.by, e.op)) continue;
    switch (e.op) {
      case "cohost":
        if (who !== host && !cohosts.includes(who)) cohosts.push(who);
        break;
      case "uncohost":
        cohosts = cohosts.filter((c) => c !== who);
        break;
      case "drive":
        driver = who === host ? undefined : who;
        break;
      case "host":
        if (who === host) break;
        // Live stays as it was: the old host's own driving (no driver) is the old host's key from here.
        driver ??= host;
        cohosts = [host, ...cohosts.filter((c) => c !== who)];
        host = who;
        if (driver === who) driver = undefined;
        break;
      case "policy":
        viewOnly = !!e.viewOnly;
        break;
    }
  }
  return { host, cohosts, editors, driver, viewOnly };
}

export interface AddResult {
  /** New entries kept. */
  added: number;
  /** Malformed, forged (a signature that doesn't verify), a counter that isn't its past's, or without authority. */
  refused: number;
  /** Not checked: the verification budget ran out (sent again, they're checked then). */
  throttled: number;
  /** Verified, waiting for entries of their past. */
  waiting: number;
}

/** One room's roster: its entries that count (bounded), the roles they give, and new ones made by this member. */
export class SignedRoster {
  private readonly entries = new Map<string, RosterEntry>();
  /** Verified entries whose past isn't all here yet, oldest first. */
  private readonly pending = new Map<string, RosterEntry>();
  private cached?: RosterState;
  private readonly listeners = new Set<() => void>();

  constructor(
    /** The room's root: the host key in its link. */
    readonly hostKey: string,
    /** The room id (base64url) and epoch every entry is bound to: one from another room or epoch doesn't verify. */
    readonly roomId: string,
    readonly epoch: number,
  ) {}

  /** The entries, in their order (a past before what follows it: to keep, or to send a peer). */
  log(): RosterEntry[] {
    return [...this.entries.values()].sort(order);
  }

  get size(): number {
    return this.entries.size;
  }

  has(sig: string): boolean {
    return this.entries.has(sig);
  }

  state(): RosterState {
    return (this.cached ??= fold(this.hostKey, [...this.entries.values()]));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The entries this roster holds that nothing it holds names: what a new entry's deps are. */
  heads(): string[] {
    const named = new Set<string>();
    for (const e of this.entries.values()) for (const d of e.deps) named.add(d);
    return this.log()
      .filter((e) => !named.has(e.sig))
      .slice(-MAX_DEPS)
      .map((e) => e.sig)
      .sort();
  }

  /** An entry's causal past (every entry its deps name, transitively), all here. */
  private past(e: RosterEntry): RosterEntry[] {
    const seen = new Set<string>();
    const out: RosterEntry[] = [];
    const stack = [...e.deps];
    while (stack.length) {
      const sig = stack.pop()!;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const d = this.entries.get(sig)!;
      out.push(d);
      stack.push(...d.deps);
    }
    return out;
  }

  /** Whether an entry whose past is all here counts: its counter is its past's, and its signer had the authority there. */
  private counts(e: RosterEntry): boolean {
    let top = 0;
    for (const d of e.deps) top = Math.max(top, this.entries.get(d)!.n);
    if (e.n !== top + 1) return false;
    const past = this.past(e);
    if (past.filter((p) => p.by === e.by).length >= MAX_ENTRIES_PER_SIGNER) return false;
    return authorised(fold(this.hostKey, past), e.by, e.op);
  }

  /**
   * Entries from a peer or this tab's record. Each new one is checked once: its shape, then its signature under its
   * signer's key for this room and epoch (`budget` says whether another verification may run now). Then, once its
   * past is here, whether it counts: one that does is kept for good; one that doesn't (forged authority, a counter
   * that isn't its past's) never is.
   */
  async add(list: readonly unknown[], budget: () => boolean = () => true): Promise<AddResult> {
    const result: AddResult = { added: 0, refused: 0, throttled: 0, waiting: 0 };
    const seen = new Set<string>();
    for (const raw of list.slice(0, MAX_ROSTER_ENTRIES)) {
      const e = parseEntry(raw);
      if (!e) {
        result.refused++;
        continue;
      }
      if (this.entries.has(e.sig) || this.pending.has(e.sig) || seen.has(e.sig)) continue;
      seen.add(e.sig);
      if (!budget()) {
        result.throttled++;
        continue;
      }
      if (!(await verify(e.by, base64UrlToBytes(e.sig), entryBytes(this.roomId, this.epoch, e)))) {
        result.refused++;
        continue;
      }
      this.pending.set(e.sig, e);
      // Bounded: the oldest waiting entry goes first (sent again, it's checked again).
      for (const old of this.pending.keys()) {
        if (this.pending.size <= MAX_PENDING) break;
        this.pending.delete(old);
      }
    }
    result.refused += Math.max(0, list.length - MAX_ROSTER_ENTRIES);
    // Each entry whose past is all here: kept if it counts, in order (an earlier one may be another's past).
    for (let progress = true; progress;) {
      progress = false;
      for (const e of [...this.pending.values()].sort(order)) {
        if (!e.deps.every((d) => this.entries.has(d))) continue;
        this.pending.delete(e.sig);
        progress = true;
        if (this.entries.size >= MAX_ROSTER_ENTRIES || !this.counts(e)) {
          result.refused++;
          continue;
        }
        this.entries.set(e.sig, e);
        this.cached = undefined;
        result.added++;
      }
    }
    result.waiting = [...seen].filter((s) => this.pending.has(s)).length;
    if (result.added) for (const l of this.listeners) l();
    return result;
  }

  /** Whether `key` may make an entry of `op` now. */
  may(key: string, op: RosterOp): boolean {
    return authorised(this.state(), key, op);
  }

  /** Whether there's room for another entry from `key`. */
  roomFor(key: string): boolean {
    let n = 0;
    for (const e of this.entries.values()) if (e.by === key) n++;
    return this.entries.size < MAX_ROSTER_ENTRIES && n < MAX_ENTRIES_PER_SIGNER;
  }

  /**
   * A new entry by `identity`, on everything this roster holds, signed and kept; undefined when it may not make it
   * now, it would change nothing, or the roster is full.
   */
  async append(
    identity: Identity,
    op: RosterOp,
    fields: { who?: string; viewOnly?: boolean } = {},
  ): Promise<RosterEntry | undefined> {
    if (!this.may(identity.key, op) || !this.roomFor(identity.key) || !this.changes(op, fields)) return undefined;
    const deps = this.heads();
    let top = 0;
    for (const d of deps) top = Math.max(top, this.entries.get(d)!.n);
    const entry = await signEntry(identity, this.roomId, this.epoch, { n: top + 1, op, ...fields, deps });
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
