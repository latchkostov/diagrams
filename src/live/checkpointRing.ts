/** One run's checkpoints get 48 MiB of estimated retained data. This leaves room for the
 * running engine and a transient capture/restore on ordinary browser heaps. Shared/COW
 * payloads are charged in full; the cap is on retention, not on transient allocation.
 */
export const CHECKPOINT_BYTES = 48 * 1024 * 1024;

/** Keep dense recent samples and progressively wider old gaps. Under pressure, remove
 * the smallest added replay area relative to squared age plus a one-minute recent window.
 * Equal scores space samples in proportion to that shifted age, thinning history logarithmically.
 * The shift avoids crowding the byte budget into the last few seconds. This thins old history more
 * aggressively than recent samples while preserving coverage across the run.
 * Prefer the origin and newest sample, but neither can override the byte limit. An
 * individually oversized checkpoint is discarded; seeking still rebuilds from the origin.
 */
export function trimCheckpoints<T extends { cp: { time: number }; bytes: number }>(
  entries: T[],
  cap = CHECKPOINT_BYTES,
): T[] {
  entries = entries.filter((entry) => entry.bytes <= cap);
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  while (bytes > cap) {
    const now = entries.at(-1)!.cp.time;
    let remove = 0,
      score = Infinity;
    for (let i = 1; i < entries.length - 1; i++) {
      const time = entries[i].cp.time;
      const candidate =
        ((time - entries[i - 1].cp.time) * (entries[i + 1].cp.time - time)) / (now - time + 60_000) ** 2;
      if (candidate < score) {
        score = candidate;
        remove = i;
      }
    }
    bytes -= entries.splice(remove, 1)[0].bytes;
  }
  return entries;
}
