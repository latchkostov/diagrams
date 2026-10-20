import { randomBytes } from "node:crypto";
import type { Clock } from "../../../../src/collab/clock";
import { parseChainData } from "../../../../src/collab/chainShape";
import { EpochChain } from "../../../../src/collab/epochs";
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
// - Checking signatures costs the relay: each socket, and the room in all, has a budget per window, and a check is
//   charged to the socket that sent what's checked. What a budget refuses is simply not taken (a page pushes again).
// - Nothing is kept past the room: when its last socket goes, so does all of this. After a restart, sockets say who
//   they are and push the chain again.
//
// What the relay learns: each socket's member key (a random key per session), the room's roster (its members' keys,
// who hosts, co-hosts, drives, can edit) and its size, and when it changes. Never content: the epochs' secrets, the
// document, presence and Live stay encrypted under keys it never has.

export const RELAY_VERIFY = {
  /** Signature checks one socket may cause per window, and a whole room (eight sockets' worth, shared). */
  perSocket: 2048,
  perRoom: 8192,
  windowMs: 10_000,
} as const;

interface Seat {
  readonly challenge: string;
  readonly budget: TokenBucket;
  key?: string;
  member: boolean;
  /** Closes this socket (removed). */
  close(code: number): void;
  /** Tells this socket whether it's admitted. */
  tell(member: boolean): void;
}

export class RoomGuard {
  private readonly chain: EpochChain;
  private readonly seats = new Map<string, Seat>();
  private readonly budget: TokenBucket;
  /** Proofs and chain pushes, one at a time (each may change who's in). */
  private work: Promise<void> = Promise.resolve();

  constructor(
    readonly root: string,
    readonly room: string,
    private readonly clock: Clock,
    private readonly limits: { perSocket: number; perRoom: number; windowMs: number } = RELAY_VERIFY,
  ) {
    this.chain = new EpochChain(root, room);
    this.budget = new TokenBucket(limits.perRoom, limits.perRoom / limits.windowMs, clock);
  }

  /** A socket in the room: its challenge (what it signs to say which member it is). */
  seat(peer: string, close: (code: number) => void, tell: (member: boolean) => void): string {
    const challenge = bytesToBase64Url(randomBytes(32));
    this.seats.set(peer, {
      challenge,
      budget: new TokenBucket(this.limits.perSocket, this.limits.perSocket / this.limits.windowMs, this.clock),
      member: false,
      close,
      tell,
    });
    return challenge;
  }

  leave(peer: string): void {
    this.seats.delete(peer);
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

  /** A socket says which member it is (once). Resolves once looked at. */
  prove(peer: string, key: string, sig: string): Promise<void> {
    return this.serially(async () => {
      const seat = this.seats.get(peer);
      if (!seat || seat.key !== undefined || !this.charge(seat)) return;
      let signature: Uint8Array;
      try {
        signature = base64UrlToBytes(sig);
      } catch {
        return;
      }
      if (!(await verify(key, signature, relayProofBytes(this.room, seat.challenge, peer, key)))) return;
      if (this.seats.get(peer) !== seat) return;
      seat.key = key;
      seat.member = this.chain.memberNow(key);
      seat.tell(seat.member);
    });
  }

  /** The room's chain, or part of it, from a socket: checked at its expense, then everyone looked at again. */
  push(peer: string, raw: unknown): Promise<void> {
    return this.serially(async () => {
      const seat = this.seats.get(peer);
      const data = parseChainData(raw);
      if (!seat || !data) return;
      await this.chain.add(data, () => this.charge(seat));
      this.review();
    });
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

  private serially(job: () => Promise<void>): Promise<void> {
    const run = this.work.then(job);
    this.work = run.catch(() => {});
    return this.work;
  }
}
