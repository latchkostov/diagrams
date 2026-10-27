/** Positive current delivery rates; ties retain the same emphasis. */
export function mainRateThreshold(rates: readonly number[]): number {
  const positive = rates.filter((rate) => rate > 0).sort((a, b) => a - b);
  return positive[Math.min(positive.length - 1, Math.floor(positive.length * 0.75))] ?? Infinity;
}
