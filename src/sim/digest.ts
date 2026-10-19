import type { SimSnapshot } from "./types";

// A run's state, digested (shared Live design, P1; LiveController.digestInputs gives the inputs): two engines that ran the same ticks with the same ops agree on
// it, bit for bit, in any JS engine. A follower compares it with the driver's every few simulated seconds and
// rebuilds when they differ; tests compare it across Chromium, Firefox and WebKit (tests/engines).
//
// FNV-1a (32-bit) over the clock, the generator's draw count, the messages alive, and each node's counters in
// diagram order: the integer counts, plus the bits of its smoothed throughput (a float, so a last-bit difference
// in any arithmetic shows up here before it reaches a count). Sampled units, as the engine keeps them.

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

const view = new DataView(new ArrayBuffer(8));

function mix(hash: number, word: number): number {
  for (let shift = 0; shift < 32; shift += 8) hash = Math.imul(hash ^ ((word >>> shift) & 0xff), PRIME);
  return hash;
}

/** A number as two 32-bit words: integers exactly (up to 2^53), anything else by its IEEE bits. */
function mixNumber(hash: number, value: number | undefined): number {
  view.setFloat64(0, value ?? 0);
  return mix(mix(hash, view.getUint32(0)), view.getUint32(4));
}

function mixText(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) hash = mix(hash, text.charCodeAt(i));
  return mix(hash, 0xffffffff);
}

const COUNTERS = [
  "processed",
  "failed",
  "dropped",
  "outageDropped",
  "blocked",
  "rejected",
  "deadLettered",
  "backlog",
  "inFlight",
  "replicas",
  "activeReplicas",
  "idleReplicas",
  "throughput",
] as const;

/** The digest of a snapshot, given how many numbers the generator has drawn by then. Unsigned 32-bit. */
export function snapshotDigest(snapshot: SimSnapshot, draws: number): number {
  let hash = OFFSET;
  hash = mixNumber(hash, snapshot.time);
  hash = mixNumber(hash, draws);
  hash = mixNumber(hash, snapshot.inSystem);
  // Fault overlays (a slowdown, a cut link, a boundary down) before they show in any count.
  hash = mixText(hash, JSON.stringify(snapshot.faults ?? []));
  for (const [id, node] of Object.entries(snapshot.nodes)) {
    hash = mixText(hash, id);
    hash = mixText(hash, node.status);
    for (const key of COUNTERS) hash = mixNumber(hash, node[key]);
    for (const [group, lag] of Object.entries(node.lag)) hash = mixNumber(mixText(hash, group), lag);
  }
  return hash >>> 0;
}
