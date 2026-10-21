import { randomBytes } from "node:crypto";
import type { Clock } from "../../../../src/collab/clock";
import { parseChainData } from "../../../../src/collab/chainShape";
import { EpochChain, parseStart, type ChainData } from "../../../../src/collab/epochs";
import { verify } from "../../../../src/collab/signing";
import { RELAY_CLOSE, relayProofBytes } from "../../../../src/collab/transport/relayProtocol";
import { base64UrlToBytes, bytesToBase64Url } from "../../../../src/interop/codec";
import { TokenBucket } from "./bucket";

// A knock-to-join room on the relay (shared Live P6): who's in it, from the room's own signed chain, so the relay
// forwards the room's content only between its members, and closes a member removed at once.
//
// - The room's root is its host key, from the first hello (every later hello must name the same one).
// - Each socket is given a challenge; it signs it (with the room id and its relay peer id) by the member key it speaks
//   for. Until it has, and until that key is a member of the newest epoch the relay holds, it gets and sends only the
//   lobby (envelope channel 4): what someone at the door is allowed.
// - The chain is pushed in plaintext by the room's sockets (starts and roster entries: public keys and signatures,
//   no content, no keys that open any). It's checked as every page checks it (../../../../src/collab/epochs.ts:
//   signatures, the host-only single line), and every socket is looked at again whenever it changes: a key no longer
//   a member (removed, in any epoch since) has its socket closed at once.
// - Every proof and push is answered: a proof `ok` or `retry` (its checks didn't fit the budget now, or the queue was
//   full), a push with how far the chain it holds goes and whether all of that push is held, so a page keeps pushing
//   until it is (whether or not it's admitted: a removal must reach the relay however the budgets went).
// - Checking signatures costs the relay: each socket, and the room in all, has a budget per window, and a check is
//   charged to the socket that sent what's checked. Work waits in a bounded queue: jobs and bytes per socket and per
//   room are reserved before a payload is kept (the excess is answered `retry`), released when done, and a socket's
//   queued work goes when it does.
// - Nothing is kept past the room: when its last socket goes, so does all of this. After a restart, sockets say who
//   they are and push the chain again.
//
// What the relay learns: each socket's member key (a random key per session), the room's roster (its members' keys,
// who hosts, co-hosts, drives, can edit) and its size, and when it changes. Never content: the epochs' secrets, the
// document, presence and Live stay encrypted under keys it never has.

export interface GuardLimits {
  /** Signature checks one socket may cause per window, and a whole room. */
  verifiesPerSocket: number;
  verifiesPerRoom: number;
  windowMs: number;
  /** Proofs and pushes waiting to be checked: per socket, and per room (four sockets' worth). */
  queuedJobs: number;
  queuedBytes: number;
}

export const GUARD_LIMITS: GuardLimits = {
  verifiesPerSocket: 2048,
  verifiesPerRoom: 8192,
  windowMs: 10_000,
  queuedJobs: 8,
  queuedBytes: 4 * 1024 * 1024,
};

/** What a socket is told about its proof and its pushes. */
export type GuardReply =
  { t: "proofAck"; ok: boolean } | { t: "chainAck"; id: number; epoch: number; entries: number; complete: boolean };

interface Seat {
  readonly challenge: string;
  readonly budget: TokenBucket;
  key?: string;
  member: boolean;
  jobs: number;
  bytes: number;
  /** Closes this socket (removed, or a proof that isn't one). */
  close(code: number): void;
  /** Tells this socket whether it's admitted. */
  tell(member: boolean): void;
  /** Answers a proof or a push. */
  reply(message: GuardReply): void;
}

interface Job {
  peer: string;
  bytes: number;
  run(seat: Seat): Promise<void>;
}

export class RoomGuard {
  private readonly chain: EpochChain;
  private readonly seats = new Map<string, Seat>();
  private readonly budget: TokenBucket;
  private readonly queue: Job[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private running = false;
  private jobs = 0;
  private bytes = 0;

  constructor(
    readonly root: string,
    readonly room: string,
    private readonly clock: Clock,
    private readonly limits: GuardLimits = GUARD_LIMITS,
  ) {
    this.chain = new EpochChain(root, room);
    this.budget = new TokenBucket(limits.verifiesPerRoom, limits.verifiesPerRoom / limits.windowMs, clock);
  }

  /** A socket in the room: its challenge (what it signs to say which member it is). */
  seat(
    peer: string,
    close: (code: number) => void,
    tell: (member: boolean) => void,
    reply: (message: GuardReply) => void,
  ): string {
    const challenge = bytesToBase64Url(randomBytes(32));
    const perSocket = this.limits.verifiesPerSocket;
    this.seats.set(peer, {
      challenge,
      budget: new TokenBucket(perSocket, perSocket / this.limits.windowMs, this.clock),
      member: false,
      jobs: 0,
      bytes: 0,
      close,
      tell,
      reply,
    });
    return challenge;
  }

  /** A socket gone: its seat, and its queued work with it. */
  leave(peer: string): void {
    const seat = this.seats.get(peer);
    if (!seat) return;
    this.seats.delete(peer);
    for (let i = this.queue.length - 1; i >= 0; i--)
      if (this.queue[i].peer === peer) this.release(this.queue.splice(i, 1)[0], seat);
  }

  /** Whether a socket is admitted: it proved a key that's a member of the newest epoch held. */
  isMember(peer: string): boolean {
    return !!this.seats.get(peer)?.member;
  }

  /** Members admitted now (metrics: a count, never who). */
  get members(): number {
    let n = 0;
    for (const seat of this.seats.values()) if (seat.member) n++;
    return n;
  }

  /** Work waiting (diagnostics, tests): jobs and bytes, in the room and per socket. */
  load(peer?: string): { jobs: number; bytes: number } {
    if (peer === undefined) return { jobs: this.jobs, bytes: this.bytes };
    const seat = this.seats.get(peer);
    return { jobs: seat?.jobs ?? 0, bytes: seat?.bytes ?? 0 };
  }

  /** Resolves once no queued or in-flight work remains (diagnostics, tests). */
  idle(): Promise<void> {
    if (this.jobs === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  /** A socket says which member it is (until it's been looked at: answered `ok`, or `retry`). */
  prove(peer: string, key: string, sig: string, bytes: number): void {
    this.enqueue(peer, bytes, { t: "proofAck", ok: false }, async (seat) => {
      if (seat.key !== undefined) return seat.reply({ t: "proofAck", ok: seat.key === key });
      if (!this.charge(seat)) return seat.reply({ t: "proofAck", ok: false });
      let signature: Uint8Array;
      try {
        signature = base64UrlToBytes(sig);
      } catch {
        return seat.close(RELAY_CLOSE.badFrame);
      }
      if (!(await verify(key, signature, relayProofBytes(this.room, seat.challenge, peer, key))))
        return seat.close(RELAY_CLOSE.badFrame);
      if (this.seats.get(peer) !== seat) return;
      seat.key = key;
      seat.reply({ t: "proofAck", ok: true });
      seat.member = this.chain.memberNow(key);
      seat.tell(seat.member);
    });
  }

  /** The room's chain, or part of it, from a socket: checked at its expense, answered, then everyone looked at again. */
  push(peer: string, id: number, raw: unknown, bytes: number): void {
    const refused: GuardReply = { t: "chainAck", id, ...this.tip(), complete: false };
    this.enqueue(peer, bytes, refused, async (seat) => {
      const data = parseChainData(raw);
      if (!data) return seat.close(RELAY_CLOSE.badFrame);
      await this.chain.add(data, () => this.charge(seat));
      // Whoever's in is looked at again whatever became of the sender (a removal it pushed counts if it's gone).
      if (this.seats.get(peer) === seat) seat.reply({ t: "chainAck", id, ...this.tip(), complete: this.holds(data) });
      this.review();
    });
  }

  /** How far the chain held goes: its newest epoch, and how many entries that epoch's roster holds. */
  private tip(): { epoch: number; entries: number } {
    const deepest = this.chain.deepest();
    return { epoch: deepest?.epoch ?? -1, entries: deepest ? (this.chain.rosterOf(deepest)?.size ?? 0) : 0 };
  }

  /** Whether everything a push carried is held now: each start placed, each entry in its epoch's roster. */
  private holds(data: ChainData): boolean {
    for (const raw of data.starts) {
      const start = parseStart(raw);
      if (!start || !this.chain.validated().some((s) => s.sig === start.sig)) return false;
    }
    for (const log of data.logs) {
      const start = this.chain.byScope(log.scope);
      const roster = start && this.chain.rosterOf(start);
      if (!roster) return false;
      for (const e of log.entries) {
        const sig = e && typeof e === "object" ? (e as { sig?: unknown }).sig : undefined;
        if (typeof sig !== "string" || !roster.named(sig)) return false;
      }
    }
    return true;
  }

  private charge(seat: Seat): boolean {
    return seat.budget.take(1) && this.budget.take(1);
  }

  /** Everyone, against the newest epoch held: newly in, admitted; no longer in (removed), closed at once. */
  private review(): void {
    for (const seat of [...this.seats.values()]) {
      if (seat.key === undefined) continue;
      const member = this.chain.memberNow(seat.key);
      if (member === seat.member) continue;
      seat.member = member;
      if (member) seat.tell(true);
      else seat.close(RELAY_CLOSE.removed);
    }
  }

  /**
   * Work for later, reserved before its payload is kept: past this socket's or the room's queue (jobs, bytes), it's
   * answered with `refused` (the page tries again) and nothing is kept.
   */
  private enqueue(peer: string, bytes: number, refused: GuardReply, run: (seat: Seat) => Promise<void>): void {
    const seat = this.seats.get(peer);
    if (!seat) return;
    const room = this.limits;
    if (
      seat.jobs + 1 > room.queuedJobs ||
      seat.bytes + bytes > room.queuedBytes ||
      this.jobs + 1 > room.queuedJobs * 4 ||
      this.bytes + bytes > room.queuedBytes * 4
    ) {
      seat.reply(refused);
      return;
    }
    seat.jobs++;
    seat.bytes += bytes;
    this.jobs++;
    this.bytes += bytes;
    this.queue.push({ peer, bytes, run });
    void this.drain();
  }

  private release(job: Job, seat: Seat | undefined): void {
    this.jobs--;
    this.bytes -= job.bytes;
    if (seat) {
      seat.jobs--;
      seat.bytes -= job.bytes;
    }
    if (this.jobs === 0) {
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        const seat = this.seats.get(job.peer);
        try {
          if (seat) await job.run(seat);
        } catch {
          // A job that fails changes nothing; the next one runs.
        } finally {
          this.release(job, this.seats.get(job.peer) === seat ? seat : undefined);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
