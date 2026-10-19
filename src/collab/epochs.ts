import { base64UrlToBytes, bytesToBase64Url } from "../interop/codec";
import { rootState, SignedRoster, type AddResult } from "./roster";
import { commitSecret, publicKeyBytes, sign, signedBytes, verify, type Identity } from "./signing";

// A knock-to-join room's epochs (meeting hosts design §2, P5). The link opens only the lobby; the room's content is
// under a secret per epoch, which the link doesn't carry.
//
// - Each epoch has a start, signed: epoch 0's by the room's host (the link's key) as it creates the room; each later
//   one by the host who removed someone, naming that removal (`prev`). Only the host removes (owner decision), and an
//   epoch closes with its first removal that counts, so the chain is a single line: each epoch has at most one
//   successor, and there are no sibling epochs to reconcile. A start commits to its epoch's secret (`kc`), so a
//   member handed the secret by anyone can check it's the epoch's own, and names its signer's key-agreement key
//   (epoch 0: the host's, so members can hand the host the next epoch's secret).
// - Each epoch has its own roster (./roster.ts), its entries bound to its start (`<epoch>:<start signature>`): nothing
//   signed in one epoch counts in another. Epoch 0's starts from the host alone; a later one's from its parent's state
//   at the removal it names (that removal's causal past), without whom it removed.
// - A start counts only with its authority: epoch 0's signed by the link's host key; a later one's signed by the host
//   who made the removal that closes its parent epoch, naming it (anyone else's, a co-host's or a former one's, never
//   counts, whenever it arrives). A start is checked before it's kept: one whose
//   parent or removal isn't here yet waits in a small pool (evicted oldest first), so someone with only the link
//   can't fill the chain with starts of their own. Resolution walks from the starts already placed, so its work is
//   bounded by the pool and the chain, never by what a peer sends.
// - Which epoch a member is in is its session's to decide (./session.ts), and only ever forward, along the line. This
//   chain only says which starts count, and each one's path back to epoch 0.
//
// A removed person's page holds the old epochs' secrets only: the new epoch's content, sealed under its own secret,
// is unreadable to them, and their frames, sealed under an old one, are refused by the epoch in their header.

export interface EpochStart {
  epoch: number;
  /** Its signer: the room's host (epoch 0), or the remover (later epochs). */
  by: string;
  /** Commitment to the epoch's secret (SHA-256, base64url). */
  kc: string;
  /** The removal it follows (its signature), for epochs after 0. */
  prev?: string;
  /** Epoch 0: the host's key-agreement key. */
  x?: string;
  sig: string;
}

/** Epochs a room goes through at most (each a removal): past this, start a new room. */
export const MAX_EPOCHS = 32;
/** Starts a chain keeps (each backed by a removal that counts), and starts waiting for their parent or removal. */
const MAX_STARTS = 64;
const MAX_WAITING_STARTS = 16;
const B64_43 = /^[A-Za-z0-9_-]{43}$/;
const B64_86 = /^[A-Za-z0-9_-]{86}$/;

/** An epoch's scope: what its roster's entries are bound to. */
export const scopeOf = (s: EpochStart) => `${s.epoch}:${s.sig}`;

const startBytes = (roomId: string, s: Omit<EpochStart, "sig">) =>
  signedBytes("livediagrams/epoch/v1", roomId, s.epoch, s.by, s.kc, s.prev ?? "", s.x ?? "");

/** What a commitment to an epoch's secret covers: the room, the epoch and the secret. */
export const commitEpoch = (secret: Uint8Array, roomId: string, epoch: number) => commitSecret(secret, roomId, epoch);

export async function signStart(
  identity: Identity,
  roomId: string,
  body: Omit<EpochStart, "sig" | "by">,
): Promise<EpochStart> {
  const unsigned = { ...body, by: identity.key };
  return { ...unsigned, sig: bytesToBase64Url(await sign(identity.privateKey, startBytes(roomId, unsigned))) };
}

/** A start's shape, or undefined (its signature is checked separately). */
export function parseStart(v: unknown): EpochStart | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const s = v as Record<string, unknown>;
  if (Object.keys(s).some((k) => !["epoch", "by", "kc", "prev", "x", "sig"].includes(k))) return undefined;
  if (!Number.isInteger(s.epoch) || (s.epoch as number) < 0 || (s.epoch as number) >= MAX_EPOCHS) return undefined;
  if (typeof s.by !== "string" || !publicKeyBytes(s.by)) return undefined;
  if (typeof s.kc !== "string" || !B64_43.test(s.kc)) return undefined;
  const first = s.epoch === 0;
  if (first ? s.prev !== undefined : typeof s.prev !== "string" || !B64_86.test(s.prev)) return undefined;
  if (first ? typeof s.x !== "string" || !B64_43.test(s.x) : s.x !== undefined) return undefined;
  if (typeof s.sig !== "string" || !B64_86.test(s.sig)) return undefined;
  try {
    const sig = base64UrlToBytes(s.sig);
    if (sig.length !== 64 || bytesToBase64Url(sig) !== s.sig) return undefined;
  } catch {
    return undefined;
  }
  return {
    epoch: s.epoch as number,
    by: s.by,
    kc: s.kc,
    ...(first ? { x: s.x as string } : { prev: s.prev as string }),
    sig: s.sig,
  };
}

/** What a chain sends (and a tab keeps): its starts, and each epoch's roster entries. */
export interface ChainData {
  starts: EpochStart[];
  logs: { scope: string; entries: unknown[] }[];
}

export class EpochChain {
  /** Starts that count (their authority checked), and each one's parent (epoch 0: none). */
  private readonly starts = new Map<string, EpochStart>();
  private readonly parents = new Map<string, string>();
  /** Starts that have their successor (one at most: the line doesn't fork). */
  private readonly children = new Set<string>();
  /** Starts whose signature checked, waiting for their parent or the removal they name. Oldest first. */
  private readonly waiting = new Map<string, EpochStart>();
  private readonly rosters = new Map<string, SignedRoster>();
  private readonly secrets = new Map<string, Uint8Array>();
  private readonly listeners = new Set<() => void>();
  /** Resolution's work so far: each placed start looked at for a waiting one (bounded by the pool and the chain). */
  readonly work = { lookups: 0 };

  constructor(
    /** The room's root: the host key in its link. */
    readonly hostKey: string,
    readonly roomId: string,
  ) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Inside add(): changes are told once, at its end, and only if there were any. */
  private batching = 0;
  private dirty = false;

  private changed(): void {
    if (this.batching) {
      this.dirty = true;
      return;
    }
    for (const l of this.listeners) l();
  }

  /** Every start that counts. */
  validated(): EpochStart[] {
    return [...this.starts.values()];
  }

  /** A start that counts, by its scope. */
  byScope(scope: string): EpochStart | undefined {
    return [...this.starts.values()].find((s) => scopeOf(s) === scope);
  }

  parentOf(start: EpochStart): EpochStart | undefined {
    const parent = this.parents.get(start.sig);
    return parent ? this.starts.get(parent) : undefined;
  }

  /** A start's path: epoch 0's start, each one after, to it. */
  path(start: EpochStart): EpochStart[] {
    const out: EpochStart[] = [];
    for (let s: EpochStart | undefined = start; s && out.length <= MAX_EPOCHS; s = this.parentOf(s)) out.unshift(s);
    return out;
  }

  /** The deepest start that counts (of two, the lower signature): where someone new to the chain starts looking. */
  deepest(): EpochStart | undefined {
    return [...this.starts.values()].sort((a, b) => b.epoch - a.epoch || (a.sig < b.sig ? -1 : 1))[0];
  }

  /** A start's roster (once it counts). */
  rosterOf(start: EpochStart): SignedRoster | undefined {
    return this.rosters.get(start.sig);
  }

  /**
   * Places waiting starts whose authority is here: epoch 0's (the host's), or the one successor of a placed start: it
   * names a removal in that epoch's roster (only the host's are ever kept: authority checked in the removal's causal
   * past) and is signed by its signer. A placed start keeps its place whatever arrives later, and a start's parent
   * takes one successor only. Each pass places at least one or stops: bounded by the waiting pool and the chain.
   */
  private resolve(): boolean {
    let placed = false;
    for (let progress = true; progress;) {
      progress = false;
      for (const s of [...this.waiting.values()]) {
        if (this.starts.size >= MAX_STARTS) return placed;
        this.work.lookups++;
        let base;
        let parent: EpochStart | undefined;
        if (s.epoch === 0) base = s.by === this.hostKey && !this.starts.size ? rootState(this.hostKey, s.x) : undefined;
        else
          for (const p of this.starts.values()) {
            this.work.lookups++;
            if (p.epoch !== s.epoch - 1 || this.children.has(p.sig)) continue;
            // The removal it names, as checked when it arrived (a fork arriving later doesn't unname it).
            const roster = this.rosters.get(p.sig)!;
            const removal = roster.named(s.prev!);
            if (removal?.op !== "remove" || removal.by !== s.by) continue;
            base = roster.next(removal);
            parent = p;
            break;
          }
        if (!base) continue;
        this.waiting.delete(s.sig);
        this.starts.set(s.sig, s);
        if (parent) {
          this.parents.set(s.sig, parent.sig);
          this.children.add(parent.sig);
        }
        const roster = new SignedRoster(this.hostKey, this.roomId, scopeOf(s), { base, knock: true });
        roster.subscribe(() => this.changed());
        this.rosters.set(s.sig, roster);
        placed = progress = true;
      }
    }
    return placed;
  }

  /**
   * Starts from a peer or a record. Each is checked once: its shape, its signature, and (epoch 0) that the link's host
   * signed it; then it waits until its authority is here, and is placed (./resolve).
   */
  async addStarts(list: readonly unknown[], budget: () => boolean = () => true): Promise<number> {
    const before = this.starts.size;
    for (const raw of list.slice(0, MAX_STARTS)) {
      const s = parseStart(raw);
      if (!s || this.starts.has(s.sig) || this.waiting.has(s.sig)) continue;
      // Epoch 0's start is the link's host's, or nothing.
      if (s.epoch === 0 && s.by !== this.hostKey) continue;
      if (!budget()) continue;
      const { sig, ...body } = s;
      if (!(await verify(s.by, base64UrlToBytes(sig), startBytes(this.roomId, body)))) continue;
      this.waiting.set(s.sig, s);
      for (const old of this.waiting.keys()) {
        if (this.waiting.size <= MAX_WAITING_STARTS) break;
        this.waiting.delete(old);
      }
    }
    if (this.resolve() || this.starts.size !== before) this.changed();
    return this.starts.size - before;
  }

  /** Roster entries for one epoch (its scope); a start not placed takes none. A removal may place a waiting start. */
  async addEntries(scope: string, list: readonly unknown[], budget?: () => boolean): Promise<AddResult | undefined> {
    const start = this.byScope(scope);
    const roster = start && this.rosters.get(start.sig);
    if (!roster) return undefined;
    const result = await roster.add(list, budget);
    if (this.waiting.size && this.resolve()) this.changed();
    return result;
  }

  /**
   * Starts and logs together (a peer's bundle, a record), in ancestor order: each epoch's starts, then its roster (the
   * removals its children name), before the next epoch's starts. Each start is placed as it arrives, so a whole chain
   * (every supported epoch) goes in however long it is; only a start whose parent or removal isn't here waits.
   */
  async add(data: ChainData, budget?: () => boolean): Promise<void> {
    const starts = data.starts.slice(0, MAX_STARTS);
    const epochOf = (v: unknown) => (v && typeof v === "object" ? (v as { epoch?: unknown }).epoch : undefined);
    this.batching++;
    try {
      for (let epoch = 0; epoch < MAX_EPOCHS; epoch++) {
        const these = starts.filter((s) => epochOf(s) === epoch);
        if (these.length) await this.addStarts(these, budget);
        for (const log of data.logs)
          if (typeof log.scope === "string" && parseInt(log.scope, 10) === epoch)
            await this.addEntries(log.scope, log.entries, budget);
      }
    } finally {
      this.batching--;
    }
    // Told once, and only if a start or an entry was taken (a bundle of what's known already changes nothing).
    if (!this.batching && this.dirty) {
      this.dirty = false;
      this.changed();
    }
  }

  /** The path to `start` as sent or kept: its starts, and their rosters' entries. */
  data(start: EpochStart | undefined): ChainData {
    const path = start ? this.path(start) : [];
    return {
      starts: path,
      logs: path.map((s) => ({ scope: scopeOf(s), entries: this.rosters.get(s.sig)?.log() ?? [] })),
    };
  }

  /** An epoch's secret, once checked against its start's commitment. */
  async learn(start: EpochStart, secret: Uint8Array): Promise<boolean> {
    if (secret.length !== 32 || (await commitEpoch(secret, this.roomId, start.epoch)) !== start.kc) return false;
    this.secrets.set(scopeOf(start), secret);
    return true;
  }

  secretOf(start: EpochStart): Uint8Array | undefined {
    return this.secrets.get(scopeOf(start));
  }
}
