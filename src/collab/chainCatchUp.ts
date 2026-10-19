import { MAX_EPOCHS } from "./epochs";

// A knock-to-join page catching up on the room's chain (./session.ts): peers send it in pieces, each naming the epoch
// the whole chain reaches (its tip). Until the chain this page has validated reaches every tip a peer has advertised,
// it decides nothing irreversible from it: leaving as removed, knocking again, or taking a no (whose authority is read
// from the newest epoch it knows, which may be about to change).
//
// - A tip is noted per sender, and only ever raised: a later, shorter or empty bundle from anyone (a peer behind, or
//   someone who isn't a member) never lowers or clears what another piece promised.
// - An entry goes once the validated chain reaches its tip (settle).
// - Bounded: a few senders (the oldest goes), and a tip that can't be an epoch (MAX_EPOCHS or past) is ignored.
// - One deadline for the whole wait: CATCH_UP_MS from the first promise since the validated chain last grew. Adding,
//   recreating or raising a sender's promise never moves it (several peers taking turns lying can't renew it); only
//   the chain growing (a start placed: real progress, which a liar can't fake) does, so an honest catch-up checked at
//   a page's signature budget (a full chain takes minutes) isn't cut short while it's moving. Past it, every promise
//   lapses, and decisions are made from what's validated.

/**
 * How long a promised chain may make no progress before decisions go ahead without it: two of a sender's verification
 * windows (each lets a page check a few thousand signatures, about one full epoch's roster) and four anti-entropy
 * rounds (a resend of a lost piece), with room to spare.
 */
export const CATCH_UP_MS = 20_000;
/** Senders whose tips are kept at once (a chain comes from one or two members; the rest is someone misbehaving). */
export const MAX_CATCH_UP_SENDERS = 8;

const epochOf = (tip: string): number | undefined => {
  const n = Number(tip.slice(0, tip.indexOf(":")));
  return tip.includes(":") && Number.isInteger(n) && n >= 0 && n < MAX_EPOCHS ? n : undefined;
};

export class ChainCatchUp {
  /** Per sender: the highest epoch it said its chain reaches, and since when this page has waited for it. */
  private readonly entries = new Map<string, number>();
  private known = -1;
  /** When the current wait began: the first promise since the chain last grew (none: no wait since). */
  private since?: number;

  /** A piece from `sender` naming `tip` (`<epoch>:<start signature>`): its tip, raised (never lowered). */
  note(sender: string, tip: string | undefined, now: number): void {
    const epoch = tip === undefined ? undefined : epochOf(tip);
    if (epoch === undefined || epoch <= this.known) return;
    const held = this.entries.get(sender);
    if (held !== undefined && held >= epoch) return;
    this.since ??= now;
    this.entries.delete(sender);
    this.entries.set(sender, epoch);
    for (const old of this.entries.keys()) {
      if (this.entries.size <= MAX_CATCH_UP_SENDERS) break;
      this.entries.delete(old);
    }
  }

  /** The validated chain now reaches `deepest` (an epoch; -1: none): tips it reaches go; if it grew, the wait restarts. */
  settle(deepest: number, now: number): void {
    if (deepest <= this.known) return;
    this.known = deepest;
    for (const [sender, epoch] of this.entries) if (epoch <= this.known) this.entries.delete(sender);
    this.since = this.entries.size ? now : undefined;
  }

  /** Whether a promised chain is still to arrive (within the wait's deadline). */
  pending(now: number): boolean {
    if (this.since !== undefined && now - this.since >= CATCH_UP_MS) this.entries.clear();
    return this.entries.size > 0;
  }

  /** Senders waited for (diagnostics, tests). */
  get size(): number {
    return this.entries.size;
  }
}
