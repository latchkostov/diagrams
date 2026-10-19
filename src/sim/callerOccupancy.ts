/** A sampled attempt's admitted occupancy. Quotas/counters charge represented messages;
 * concurrency and residence share this reservation until the attempt is finalized. */
export interface CallerOccupancy {
  weight: number;
  represented: number;
}

export function reserveCallerOccupancy(represented: number, available: number): CallerOccupancy {
  return { weight: Math.min(represented, available), represented };
}

export function occupancyFraction(reservation: CallerOccupancy): number {
  return reservation.weight / reservation.represented;
}
