/**
 * The file format's bounds on simulation settings, which every place that edits them uses too (the inspector, the
 * Inputs panel, fixes): a rate up to 10 million messages a second (the live view samples big rates, so they cost
 * nothing to play), counts (replicas, partitions, concurrency, deliveries) up to 10,000, times up to 10 minutes.
 */
export const SIM_LIMITS = { ratePerSec: 10_000_000, count: 10_000, timeMs: 600_000 } as const;
