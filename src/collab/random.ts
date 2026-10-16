// Randomness the room uses: secrets and session ids from WebCrypto in the app; a seeded generator in tests and in
// the in-memory network's fault injection, so a failing schedule replays from its seed.

export type RandomBytes = (n: number) => Uint8Array;

export const secureRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Mulberry32: a small deterministic generator. Never for secrets. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic bytes for tests (session ids), from a seed. Never for secrets. */
export function seededBytes(seed: number): RandomBytes {
  const next = seededRandom(seed);
  return (n) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256));
}
