import { popDue, pushDue, removeDue, type Due } from "./dueHeap";
import type { CpuPart } from "./sampledResources";

export type ReservationScope = "thread" | "request" | "pool";
export interface Reservation {
  id: number;
  owner: string;
  scope: ReservationScope;
  edge?: string;
  keys?: string[];
  weight: number;
  represented: number;
  phase: "work" | "wait";
  readonly startActive: number;
  /** Pool replies retain R1's wall-time deadlines, including time while the caller is paused. */
  readonly startTime?: number;
  heldMs: number;
  releaseAt?: number;
  cpuTail?: CpuPart[];
}
export interface LedgerOwner {
  reservations: Set<number>;
  heap: Due[];
  indices: Map<number, number>;
}
/** Flat, cloneable state. No logical events, random draws or wall-clock timers. */
export interface LedgerState {
  reservations: Map<number, Reservation>;
  owners: Map<string, LedgerOwner>;
  nextReservation: number;
}
export type LedgerSums = Record<ReservationScope, number>;

export class SampledLedger {
  state: LedgerState = { reservations: new Map(), owners: new Map(), nextReservation: 1 };

  constructor(private readonly onRelease: (reservation: Reservation) => void = () => {}) {}

  reserve(
    scope: Pick<Reservation, "owner" | "scope" | "startActive"> &
      Partial<Pick<Reservation, "edge" | "keys" | "phase" | "startTime">>,
    represented: number,
    room: number,
    cap = Infinity,
  ): Reservation | undefined {
    const weight = Math.min(represented, room, cap);
    // Decimal scales leave usable fractions of a connection. Ignore only floating
    // point residue, which would otherwise create a near-zero, effectively immortal lease.
    if (!Number.isFinite(represented) || !Number.isFinite(weight) || !(weight > 1e-9)) return;
    const reservation: Reservation = {
      ...scope,
      id: this.state.nextReservation++,
      represented,
      weight,
      phase: scope.phase ?? "work",
      heldMs: 0,
    };
    let owner = this.state.owners.get(scope.owner);
    if (!owner) {
      owner = { reservations: new Set(), heap: [], indices: new Map() };
      this.state.owners.set(scope.owner, owner);
    }
    owner.reservations.add(reservation.id);
    this.state.reservations.set(reservation.id, reservation);
    return reservation;
  }

  retire(reservation: Reservation, clock: { activeMs: number; time?: number; sampledDelayMs?: number }): number {
    if (this.state.reservations.get(reservation.id) !== reservation || reservation.releaseAt !== undefined) return 0;
    const elapsed =
      reservation.startTime === undefined
        ? clock.activeMs - reservation.startActive
        : clock.time! - reservation.startTime;
    reservation.heldMs = Math.max(0, elapsed - (clock.sampledDelayMs ?? 0));
    // Translate the remaining residence into the owner's clock at retirement.
    // Never add a child's elapsed delay to the owner's immutable admission clock:
    // the child can run while that clock is frozen. Pool callers supply wall-time
    // elapsed/delay together to preserve the pre-ledger reply deadline in R1.
    const remaining = reservation.heldMs * (1 / (reservation.weight / reservation.represented) - 1);
    reservation.releaseAt = clock.activeMs + remaining;
    if (reservation.weight === reservation.represented || remaining <= 1e-9) {
      this.release(reservation);
      return 0;
    }
    const owner = this.state.owners.get(reservation.owner)!;
    pushDue(owner.heap, { id: reservation.id, end: reservation.releaseAt }, owner.indices);
    return remaining;
  }

  release(reservation: Reservation): void {
    if (this.state.reservations.get(reservation.id) !== reservation) return;
    const owner = this.state.owners.get(reservation.owner)!;
    removeDue(owner.heap, reservation.id, owner.indices);
    owner.reservations.delete(reservation.id);
    this.state.reservations.delete(reservation.id);
    if (!owner.reservations.size) this.state.owners.delete(reservation.owner);
    this.onRelease(reservation);
  }

  releaseDue(ownerId: string, activeMs: number): void {
    const owner = this.state.owners.get(ownerId);
    if (!owner) return;
    while (owner.heap.length && owner.heap[0].end <= activeMs + 1e-9) {
      const due = popDue(owner.heap, owner.indices);
      this.release(this.state.reservations.get(due.id)!);
    }
  }

  releaseOwner(ownerId: string): void {
    const owner = this.state.owners.get(ownerId);
    if (!owner) return;
    for (const id of [...owner.reservations]) this.release(this.state.reservations.get(id)!);
  }

  audit(): LedgerSums {
    const sums: LedgerSums = { thread: 0, request: 0, pool: 0 };
    for (const reservation of this.state.reservations.values()) sums[reservation.scope] += reservation.weight;
    return sums;
  }
}
