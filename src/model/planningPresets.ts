import { DEFAULT_FAILOVER_MS, DEFAULT_MESSAGE_KB, deviceSpec, presetOf, sizeOf } from "../stencils/netDevices";

/** Immutable P1 assumptions, kept small enough for node creation without loading the profiles catalogue. */
export const PROCESSOR_VALUES = {
  replicas: 1,
  concurrency: 4,
  latencyMs: 250,
  failureRate: 0,
  jitter: 0.2,
  retry: "requeue" as const,
  retryBackoffMs: 0,
};
export function deviceValues(stencil: string | undefined, requestedSize?: unknown) {
  const spec = deviceSpec(stencil);
  if (!spec) return undefined;
  const size = sizeOf(spec, requestedSize),
    preset = presetOf(spec, size);
  return {
    size,
    gbps: preset.gbps,
    latencyMs: preset.latencyMs,
    messageKB: DEFAULT_MESSAGE_KB,
    ha: "standalone" as const,
    failoverMs: DEFAULT_FAILOVER_MS,
    replicas: 1,
    healthChecks: spec.kind === "adc",
  };
}
