export type RetryDisposition = "none" | "broker" | "inplace";

/** Decide from the pre-failure attempt count, before counters or ownership change. */
export function retryDisposition(state: {
  delivery: boolean;
  inplace: boolean;
  attempts: number;
  maxDeliveryCount: number;
  retain: () => boolean;
}): RetryDisposition {
  if (!state.delivery) return "none";
  return state.inplace && state.attempts + 1 < state.maxDeliveryCount && state.retain() ? "inplace" : "broker";
}
