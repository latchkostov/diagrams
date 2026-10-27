import type { TimelineMarker } from "../sim/types";
import type { RunSample } from "./runHistory";
import { placeMarkers, timeToFraction } from "./timelineMath";

export const chartWindow = (time: number, total: number) =>
  Math.min(total, Math.ceil(Math.max(12000, time + 2500) / 1000) * 1000);
export function niceMaximum(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value) ?? 10) * magnitude;
}
export interface FlagGroup {
  kind: "note" | "fault";
  x: number;
  markers: { index: number; marker: TimelineMarker }[];
}
/** Pointer merges within a lane; coarse pointers merge across both lanes to avoid overlapping 44px targets. */
export function groupRunFlags(
  markers: readonly TimelineMarker[],
  total: number,
  width: number,
  gap: number,
  coarse = false,
): FlagGroup[] {
  const groups: FlagGroup[] = [];
  const lastByLane: Partial<Record<FlagGroup["kind"], FlagGroup>> = {};
  for (const [index, marker] of placeMarkers(markers, total).entries()) {
    const kind = marker.kind === "note" ? "note" : "fault";
    const x = timeToFraction(marker.atMs, total) * width;
    const previous = coarse ? groups.at(-1) : lastByLane[kind];
    const last = previous?.markers.at(-1)?.marker;
    if (previous && last && x - timeToFraction(last.atMs, total) * width < gap)
      previous.markers.push({ index, marker });
    else {
      const group: FlagGroup = { kind, x, markers: [{ index, marker }] };
      groups.push(group);
      lastByLane[kind] = group;
    }
  }
  return groups;
}
/** Keep each series' extrema in each display bin, bounding SVG work without losing short spikes. */
export function plotSamples(samples: readonly RunSample[], bins = 150): RunSample[] {
  if (samples.length <= bins * 4) return [...samples];
  const size = Math.ceil(samples.length / bins);
  const kept = new Set([0, samples.length - 1]);
  for (let start = 0; start < samples.length; start += size) {
    for (const key of ["rate", "queue"] as const) {
      let low = start,
        high = start;
      for (let i = start + 1; i < Math.min(samples.length, start + size); i++) {
        if (samples[i][key] < samples[low][key]) low = i;
        if (samples[i][key] > samples[high][key]) high = i;
      }
      kept.add(low);
      kept.add(high);
    }
  }
  return [...kept].sort((a, b) => a - b).map((i) => samples[i]);
}
