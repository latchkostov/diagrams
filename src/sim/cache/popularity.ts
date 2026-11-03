import type { Popularity } from "../../model/caching";

export interface PopularityBand {
  first: number;
  count: number;
  share: number;
  cumulative: number;
}
export interface PopularityTable {
  readonly bands: readonly Readonly<PopularityBand>[];
  readonly hottestShare: number;
  readonly topPercent: number;
}
const memo = new Map<string, PopularityTable>();
/** Exact total mass, bounded representation: 256 singletons then quarter-octave bands. */
export function popularityTable(keys = 1000, popularity: Popularity = "typical"): PopularityTable {
  const key = `${keys}:${popularity}`;
  const known = memo.get(key);
  if (known) return known;
  const bands: PopularityBand[] = [];
  let total = 0,
    top = 0,
    end = 0;
  const growth = Math.sqrt(Math.sqrt(2));
  for (let rank = 1; rank <= keys; rank++) {
    if (rank > end) {
      end = rank <= 256 ? rank : Math.min(keys, Math.max(rank, Math.floor(rank * growth)));
      bands.push({ first: rank - 1, count: end - rank + 1, share: 0, cumulative: 0 });
    }
    const root = Math.sqrt(rank);
    const weight =
      popularity === "even"
        ? 1
        : popularity === "gentle"
          ? 1 / root
          : popularity === "typical"
            ? 1 / (root * Math.sqrt(root))
            : 1 / rank;
    total += weight;
    if (rank <= Math.max(1, Math.floor(keys / 100))) top += weight;
    bands[bands.length - 1].share += weight;
  }
  let cumulative = 0;
  for (const band of bands) {
    band.share /= total;
    band.cumulative = cumulative += band.share;
  }
  bands[bands.length - 1].cumulative = 1;
  const table = { bands, hottestShare: bands[0].share, topPercent: top / total };
  // Compilation memoisation is bounded across long editing sessions, too.
  if (memo.size >= 256) memo.delete(memo.keys().next().value!);
  memo.set(key, table);
  return table;
}
