import { popDue, pushDue, removeDue, type Due } from "./dueHeap";
import type { AdmissionLease } from "./admission";
import type { ResourceWork } from "./resourceWork";
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
/** Capacity-only ownership after a non-blocking dispatch. Never a second resident request. */
export interface ThreadTail<Group> extends ResourceWork {
  reservation: Reservation;
  group?: Group;
  threadLease?: AdmissionLease;
  /** Managed admission has its own fractional clock and cannot earn shared slot credit. */
  admissionClock: boolean;
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
    // A partial dot needs at least one real request's room. Tiny fractional
    // leftovers must not create leases whose residence is effectively permanent.
    if (!Number.isFinite(represented) || !Number.isFinite(weight) || weight < Math.min(1, represented) || !(weight > 0))
      return;
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

  retire(
    reservation: Reservation,
    clock: {
      activeMs: number;
      time?: number;
      sampledDelayMs?: number;
      /** Local thread work can carry fractional service credit from the preceding reservation. */
      logicalHoldMs?: number;
    },
  ): number {
    if (this.state.reservations.get(reservation.id) !== reservation || reservation.releaseAt !== undefined) return 0;
    if (reservation.startTime !== undefined && !Number.isFinite(clock.time))
      throw new Error("A wall-time reservation requires the wall clock");
    const elapsed =
      reservation.startTime === undefined
        ? clock.activeMs - reservation.startActive
        : clock.time! - reservation.startTime;
    reservation.heldMs = Math.max(0, clock.logicalHoldMs ?? elapsed - (clock.sampledDelayMs ?? 0));
    // Translate the remaining residence into the owner's clock at retirement.
    // Never add a child's elapsed delay to the owner's immutable admission clock:
    // the child can run while that clock is frozen. Pool callers supply wall-time
    // elapsed/delay together to preserve the pre-ledger reply deadline in R1.
    const fraction = reservation.weight / reservation.represented;
    const remaining =
      clock.logicalHoldMs === undefined
        ? reservation.heldMs * (1 / fraction - 1)
        : Math.max(0, reservation.startActive + reservation.heldMs / fraction - clock.activeMs);
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
