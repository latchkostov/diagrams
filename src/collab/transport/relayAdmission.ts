import type { Clock } from "../clock";
import type { ChainData } from "../epochs";
import type { RelayAdmission } from "./types";

// A knock-to-join room's admission on a relay that enforces it (shared Live P6), from the page's side: it says which
// member it is until the relay acknowledges the proof, and keeps the relay's copy of the room's chain up to its own,
// pushing until a push is acknowledged as held in full, whether or not this socket is admitted (a removal must reach
// the relay however its budgets went). Every change to the chain (a removal included) sets a new target; what's
// pushed is what changed since the last acknowledged one, in pieces a relay message holds.

/** A chain control's JSON at most: well inside the relay's smallest payload limit. */
export const RELAY_PIECE_BYTES = 512 * 1024;
/** How long to wait for an answer before asking again, and the most a retry waits. */
export const RELAY_ANSWER_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

/** Waits between retries: 1 s, doubling, at most 30 s. */
const backoff = (attempt: number) => Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt);

/**
 * A chain in pieces of at most `maxBytes` of JSON each: whole epochs in order where they fit, an epoch whose roster is
 * larger split across pieces (its start in each, so each stands alone).
 */
export function relayPieces(data: ChainData, maxBytes = RELAY_PIECE_BYTES): ChainData[] {
  const pieces: ChainData[] = [];
  let piece: ChainData = { starts: [], logs: [] };
  let size = 0;
  const flush = () => {
    if (piece.starts.length || piece.logs.length) pieces.push(piece);
    piece = { starts: [], logs: [] };
    size = 0;
  };
  data.starts.forEach((start, i) => {
    const log = data.logs[i];
    const startBytes = JSON.stringify(start).length + 16;
    const entries = log?.entries ?? [];
    const whole = startBytes + JSON.stringify(entries).length + 64;
    if (whole <= maxBytes) {
      if (size + whole > maxBytes) flush();
      piece.starts.push(start);
      if (log) piece.logs.push(log);
      size += whole;
      return;
    }
    // One epoch's roster larger than a piece: its entries across as many as it takes.
    flush();
    const scope = log?.scope ?? "";
    let chunk: unknown[] = [];
    let chunkBytes = startBytes + 64;
    const emit = () => {
      pieces.push({ starts: [start], logs: [{ scope, entries: chunk }] });
      chunk = [];
      chunkBytes = startBytes + 64;
    };
    for (const entry of entries) {
      const n = JSON.stringify(entry).length + 1;
      if (chunk.length && chunkBytes + n > maxBytes) emit();
      chunk.push(entry);
      chunkBytes += n;
    }
    emit();
  });
  flush();
  return pieces;
}

type Tip = { epoch: number; entries: number };
const same = (a: Tip | undefined, b: Tip | undefined) => !!a && !!b && a.epoch === b.epoch && a.entries === b.entries;

export class RelayAdmissionController {
  private live = false;
  private challenge = "";
  private peer = "";
  private proved = false;
  private proofTries = 0;
  private cancelProof?: () => void;
  /** The last target the relay acknowledged holding in full (none: it holds nothing of this page's yet). */
  private acked?: Tip;
  /** A round of pushes in flight: their ids, whether any wasn't held in full, and the target they carry. */
  private round?: { ids: Set<number>; failed: boolean; target: Tip };
  private pushTries = 0;
  private cancelPush?: () => void;
  private nextId = 0;

  constructor(
    private readonly admission: RelayAdmission,
    private readonly send: (text: string) => void,
    private readonly clock: Clock,
  ) {}

  /** A socket welcomed with a challenge: prove, and push everything (the relay holds nothing of this page's). */
  start(challenge: string, peer: string): void {
    this.stop();
    this.live = true;
    this.challenge = challenge;
    this.peer = peer;
    this.proved = false;
    this.proofTries = 0;
    this.acked = undefined;
    this.pushTries = 0;
    // The proof first (its check is the socket's first), then the chain.
    void this.prove().finally(() => this.sync());
  }

  /** The socket's gone: nothing more is sent. */
  stop(): void {
    this.live = false;
    this.cancelProof?.();
    this.cancelProof = undefined;
    this.cancelPush?.();
    this.cancelPush = undefined;
    this.round = undefined;
  }

  /** The page's chain changed (a new member, a removal, a new epoch): a new target. */
  changed(): void {
    if (this.live) this.sync();
  }

  onProofAck(ok: boolean): void {
    if (!this.live || this.proved) return;
    this.cancelProof?.();
    this.cancelProof = undefined;
    if (ok) {
      this.proved = true;
      return;
    }
    this.retryProof();
  }

  onChainAck(ack: { id: number; complete: boolean }): void {
    const round = this.round;
    if (!this.live || !round || !round.ids.delete(ack.id)) return;
    if (!ack.complete) round.failed = true;
    if (round.ids.size) return;
    this.cancelPush?.();
    this.cancelPush = undefined;
    this.round = undefined;
    if (round.failed) return this.retryPush();
    this.acked = round.target;
    this.pushTries = 0;
    this.sync();
  }

  private async prove(): Promise<void> {
    const asked = this.challenge;
    let proof: { key: string; sig: string };
    try {
      proof = await this.admission.prove(asked, this.peer);
    } catch {
      return;
    }
    if (!this.live || this.proved || this.challenge !== asked) return;
    this.send(JSON.stringify({ t: "prove", ...proof }));
    // No answer at all (lost, or the relay busy): asked again.
    this.cancelProof?.();
    this.cancelProof = this.clock.after(RELAY_ANSWER_MS, () => {
      this.cancelProof = undefined;
      this.retryProof();
    });
  }

  private retryProof(): void {
    if (!this.live || this.proved) return;
    this.cancelProof?.();
    this.cancelProof = this.clock.after(backoff(this.proofTries++), () => {
      this.cancelProof = undefined;
      void this.prove();
    });
  }

  /**
   * Pushes what the relay lacks, up to the page's newest, at once (a removal mustn't wait behind an earlier push): a
   * round in flight is superseded, its answers no longer counted.
   */
  private sync(): void {
    if (!this.live) return;
    const target = this.admission.tip();
    if (!target || same(this.acked, target)) return;
    const data = this.admission.chain(this.acked?.epoch);
    const pieces = data ? relayPieces(data) : [];
    if (!pieces.length) return;
    const round = { ids: new Set<number>(), failed: false, target };
    this.round = round;
    for (const chain of pieces) {
      const id = this.nextId++;
      round.ids.add(id);
      this.send(JSON.stringify({ t: "chain", id, chain }));
    }
    // Answers that never come (lost, or a socket that went quiet): the round is pushed again.
    this.cancelPush?.();
    this.cancelPush = this.clock.after(RELAY_ANSWER_MS * 2, () => {
      this.cancelPush = undefined;
      if (this.round !== round) return;
      this.round = undefined;
      this.retryPush();
    });
  }

  private retryPush(): void {
    if (!this.live) return;
    this.cancelPush?.();
    this.cancelPush = this.clock.after(backoff(this.pushTries++), () => {
      this.cancelPush = undefined;
      this.sync();
    });
  }
}
