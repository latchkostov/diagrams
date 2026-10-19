import { popDue, pushDue, removeDue, type Due } from "./dueHeap";
import type { ResourceWork } from "./resourceWork";
import { STEP } from "./timing";

/** Models scale-1 tick-ordering turnaround: admission follows settlement by one tick. */
export const ADMISSION_LAG_MS = STEP;

/** A sampled attempt's admitted occupancy. Quotas/counters charge represented messages;
 * concurrency and residence share this reservation until the attempt is finalized. */
export interface CallerOccupancy {
  weight: number;
  represented: number;
}

export function reserveCallerOccupancy(
  represented: number,
  available: number,
  retained?: CallerOccupancy,
): CallerOccupancy {
  return { weight: Math.min(represented, available, retained?.weight ?? Infinity), represented };
}

export function occupancyFraction(reservation: CallerOccupancy): number {
  return reservation.weight / reservation.represented;
}

export type ReservationScope = "thread" | "request" | "pool";
export interface Reservation<Group = unknown> extends ResourceWork {
  id: number;
  owner: string;
  scope: ReservationScope;
  edge?: string;
  keys?: string[];
  weight: number;
  represented: number;
  phase: "work" | "wait";
  readonly startActive: number;
  /** Logical dispatch time for pool holds; independent of the owner's paused clock. */
  readonly startedAt?: number;
  heldMs: number;
  /** Start of the current in-place attempt; heldMs accumulates earlier attempts. */
  segmentActive?: number;
  releaseAt?: number;
  /** Explicit delivery-group ownership survives logical acknowledgement. */
  group?: Group;
  retiredActive?: number;
  /** Admission evidence for the diagnostic gate oracle (immutable across live edits). */
  room: number;
  cap: number;
  requestWeight?: number;
  admissionLagMs?: number;
}
export interface ReleaseCredit {
  weight: number;
  freeAt: number;
}
export interface LedgerOwner {
  reservations: Set<number>;
  heap: Due[];
  indices: Map<number, number>;
  credits: Map<string, ReleaseCredit[]>;
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

  reserve<Group = unknown>(
    scope: Pick<Reservation, "owner" | "scope" | "startActive"> &
      Partial<Pick<Reservation, "edge" | "keys" | "phase" | "startedAt">>,
    represented: number,
    room: number,
    cap = Infinity,
    admissibleActive = scope.startActive,
  ): Reservation<Group> | undefined {
    const weight = Math.min(represented, room, cap);
    // A partial dot needs at least one real request's room. Tiny fractional
    // leftovers must not create leases whose residence is effectively permanent.
    if (!Number.isFinite(represented) || !Number.isFinite(weight) || weight < Math.min(1, represented) || !(weight > 0))
      return;
    let owner = this.state.owners.get(scope.owner);
    const credits = owner?.credits.get(creditKey(scope));
    let remaining = weight;
    let startActive = admissibleActive;
    while (credits?.length && remaining > 1e-9) {
      const credit = credits[0];
      startActive = Math.max(startActive, credit.freeAt);
      const take = Math.min(remaining, credit.weight);
      remaining -= take;
      credit.weight -= take;
      if (credit.weight <= 1e-9) credits.shift();
    }
    if (remaining > 1e-9) startActive = scope.startActive;
    const reservation: Reservation<Group> = {
      ...scope,
      startActive: Math.min(scope.startActive, startActive),
      segmentActive: scope.startActive,
      id: this.state.nextReservation++,
      represented,
      weight,
      phase: scope.phase ?? "work",
      heldMs: 0,
      room,
      cap,
    };
    if (!owner) {
      owner = { reservations: new Set(), heap: [], indices: new Map(), credits: new Map() };
      this.state.owners.set(scope.owner, owner);
    }
    owner.reservations.add(reservation.id);
    this.state.reservations.set(reservation.id, reservation);
    return reservation;
  }

  retire(
    reservation: Reservation,
    logicalHoldMs: number,
    ownerActiveMs: number,
    admissionLagMs = reservation.scope === "thread" && reservation.phase === "wait" ? ADMISSION_LAG_MS : 0,
  ): void {
    if (this.state.reservations.get(reservation.id) !== reservation || reservation.releaseAt !== undefined) return;
    reservation.heldMs += Math.max(0, logicalHoldMs);
    reservation.retiredActive = ownerActiveMs;
    reservation.admissionLagMs = admissionLagMs;
    // Local work and pools can turn over in their own phase. A blocking reply
    // settles after admission, so its scale-1 turnaround includes the next tick.
    const releaseAt =
      reservation.scope === "pool"
        ? ownerActiveMs +
          reservation.heldMs * (reservation.represented / reservation.weight - 1) -
          ((reservation.segmentActive ?? reservation.startActive) - reservation.startActive)
        : reservation.startActive +
          ((reservation.heldMs + admissionLagMs) * reservation.represented) / reservation.weight -
          admissionLagMs;
    reservation.releaseAt = Math.max(ownerActiveMs, releaseAt);
    if (reservation.weight === reservation.represented || reservation.releaseAt <= ownerActiveMs + 1e-9) {
      // Logical completion still bounds releaseAt (I4), but clamping must not
      // discard the exact turnover carried into the next already-eligible dot.
      if (reservation.weight < reservation.represented) this.credit(reservation, releaseAt + admissionLagMs);
      this.release(reservation);
      return;
    }
    const owner = this.state.owners.get(reservation.owner)!;
    // A wait settles after admission; its capacity is usable in the next phase.
    pushDue(owner.heap, { id: reservation.id, end: reservation.releaseAt + admissionLagMs }, owner.indices);
  }

  release(reservation: Reservation): void {
    if (this.state.reservations.get(reservation.id) !== reservation) return;
    const owner = this.state.owners.get(reservation.owner)!;
    removeDue(owner.heap, reservation.id, owner.indices);
    owner.reservations.delete(reservation.id);
    this.state.reservations.delete(reservation.id);
    if (!owner.reservations.size && !owner.credits.size) this.state.owners.delete(reservation.owner);
    this.onRelease(reservation);
  }

  releaseDue(ownerId: string, activeMs: number): void {
    const owner = this.state.owners.get(ownerId);
    if (!owner) return;
    while (owner.heap.length && owner.heap[0].end <= activeMs + 1e-9) {
      const due = popDue(owner.heap, owner.indices);
      const reservation = this.state.reservations.get(due.id)!;
      // Blocking settlement follows admission. Its freed capacity becomes
      // admissible one phase later, including the exact fractional remainder.
      const freeAt = due.end;
      this.credit(reservation, freeAt);
      this.release(reservation);
    }
  }

  private credit(reservation: Reservation, freeAt: number): void {
    if (Math.abs(freeAt / STEP - Math.round(freeAt / STEP)) <= 1e-9) return;
    const owner = this.state.owners.get(reservation.owner)!;
    const key = creditKey(reservation);
    const credits = owner.credits.get(key) ?? [];
    const last = credits.at(-1);
    if (last?.freeAt === freeAt) last.weight += reservation.weight;
    else credits.push({ weight: reservation.weight, freeAt });
    owner.credits.set(key, credits);
  }

  /** Drop unused carry after its admission tick: idle capacity banks no time. */
  expireCredits(ownerId: string, activeMs: number): void {
    const owner = this.state.owners.get(ownerId);
    if (!owner) return;
    for (const [key, credits] of owner.credits) {
      const pending = credits.filter((credit) => credit.freeAt > activeMs);
      if (pending.length) owner.credits.set(key, pending);
      else owner.credits.delete(key);
    }
    if (!owner.reservations.size && !owner.credits.size) this.state.owners.delete(ownerId);
  }

  releaseOwner(ownerId: string): void {
    const owner = this.state.owners.get(ownerId);
    if (!owner) return;
    owner.credits.clear();
    for (const id of [...owner.reservations]) this.release(this.state.reservations.get(id)!);
    this.state.owners.delete(ownerId);
  }

  audit(): LedgerSums {
    const sums: LedgerSums = { thread: 0, request: 0, pool: 0 };
    for (const reservation of this.state.reservations.values()) sums[reservation.scope] += reservation.weight;
    for (const owner of this.state.owners.values())
      for (const [key, credits] of owner.credits)
        for (const credit of credits) sums[key.slice(0, key.indexOf(":")) as ReservationScope] += credit.weight;
    return sums;
  }
}

function creditKey(scope: Pick<Reservation, "scope" | "edge" | "keys">): string {
  return `${scope.scope}:${JSON.stringify([scope.edge, scope.keys])}`;
}
