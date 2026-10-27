/** "0.45 s", "120 ms", "2.4 s", "1 min 5 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  const v = Math.max(0, Math.round(ms));
  if (v < 1000) return `${v} ms`;
  if (v < 10_000) return `${(v / 1000).toFixed(2)} s`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)} s`;
  const min = Math.floor(v / 60_000);
  const s = Math.round((v % 60_000) / 1000);
  return s ? `${min} min ${s} s` : `${min} min`;
}

/** "+0.45 s" relative timestamps for the trace card and the sequence gutter. */
export function formatOffset(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(2)} s`;
}
