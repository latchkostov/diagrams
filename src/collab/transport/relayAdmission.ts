import type { Clock } from "../clock";
import type { ChainData } from "../epochs";
import type { RelayAdmission } from "./types";

// A knock-to-join room's admission on a relay that enforces it (shared Live P6), from the page's side: it says which
// member it is until the relay acknowledges the proof, and keeps the relay's copy of the room's chain up to its own,
// whether or not this socket is admitted (a removal must reach the relay however its budgets went).
//
// The chain goes in pieces a relay message holds, one at a time: the next only once the relay has answered that it
// holds the last in full; a piece it didn't take (its budget, its queue) or never answered is sent again, after a
// wait, and only that piece. Every change to the chain (a removal included) replaces what's still to send at once,
// from the first epoch the relay hasn't been shown to hold (the newest is always sent again: it's the one that
// changes), so pieces already held aren't sent twice.

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

/** A piece, and the epoch before which the chain is held once it and every piece before it are. */
interface Piece {
  chain: ChainData;
  through: number;
}

/** Pieces in order, each with how far it completes the chain (an epoch split across pieces completes with its last). */
function ordered(pieces: ChainData[]): Piece[] {
  return pieces.map((chain, i) => {
    const epochs = chain.starts.map((s) => (s as { epoch: number }).epoch);
    const last = Math.max(...epochs);
    const next = pieces[i + 1]?.starts.map((s) => (s as { epoch: number }).epoch) ?? [];
    // The next piece carrying the same epoch (its roster continued): this one doesn't complete it.
    return { chain, through: next.includes(last) ? last : last + 1 };
  });
}

export class RelayAdmissionController {
  private live = false;
  private challenge = "";
  private peer = "";
  private proved = false;
  private proofTries = 0;
  private cancelProof?: () => void;
  /** The last target the relay acknowledged holding in full (none: it holds nothing of this page's yet). */
  private acked?: Tip;
  /** Every epoch before this is held by the relay (pieces it answered in full); the newest is never counted. */
  private held = 0;
  /** What's being sent: the target, its pieces, the one in flight (its id), and how often it's been tried. */
  private round?: { target: Tip; pieces: Piece[]; index: number; id: number };
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
    this.held = 0;
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
    if (!this.live || !round || ack.id !== round.id) return;
    this.cancelPush?.();
    this.cancelPush = undefined;
    // Not taken in full (the relay's budget or queue): this piece again, after a wait.
    if (!ack.complete) return this.retryPiece();
    this.pushTries = 0;
    const piece = round.pieces[round.index];
    // Held through this piece: the epochs it completes, never the newest (it may change again).
    this.held = Math.max(this.held, Math.min(piece.through, round.target.epoch));
    round.index++;
    if (round.index < round.pieces.length) return this.sendPiece();
    this.round = undefined;
    this.acked = round.target;
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
   * What the relay lacks, up to the page's newest, from the first epoch it hasn't been shown to hold: replacing at
   * once whatever was still to send (a removal mustn't wait behind an earlier push).
   */
  private sync(): void {
    if (!this.live) return;
    const target = this.admission.tip();
    if (!target || same(this.acked, target)) return;
    const data = this.admission.chain(this.acked ? Math.min(this.held, this.acked.epoch) : this.held || undefined);
    const pieces = data ? ordered(relayPieces(data)) : [];
    if (!pieces.length) return;
    this.cancelPush?.();
    this.cancelPush = undefined;
    this.round = { target, pieces, index: 0, id: -1 };
    this.pushTries = 0;
    this.sendPiece();
  }

  /** The round's next piece, alone in flight; no answer in time: sent again. */
  private sendPiece(): void {
    const round = this.round;
    if (!this.live || !round) return;
    round.id = this.nextId++;
    this.send(JSON.stringify({ t: "chain", id: round.id, chain: round.pieces[round.index].chain }));
    this.cancelPush?.();
    this.cancelPush = this.clock.after(RELAY_ANSWER_MS * 2, () => {
      this.cancelPush = undefined;
      if (this.round === round) this.retryPiece();
    });
  }

  private retryPiece(): void {
    if (!this.live || !this.round) return;
    this.cancelPush?.();
    this.cancelPush = this.clock.after(backoff(this.pushTries++), () => {
      this.cancelPush = undefined;
      this.sendPiece();
    });
  }
}
