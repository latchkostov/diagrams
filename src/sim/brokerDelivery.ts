/**
 * Shares of a sampled dot for the consumers a broker picked, in round-robin order, each capped by `caps[i]` (its
 * share of its consumer's prefetch room, in real requests). Scale 1 hands a burst's members to the consumers with room
 * one at a time, so every consumer that can take a request gets an equal part, and what a capped one can't take goes
 * to the others equally (max-min fair, water-filling): the shares don't depend on route order. At most ⌊total⌋
 * consumers with room for a whole request take part, the earliest in rotation first, so every part keeps at least one
 * real request. `left` is what no cap holds.
 */
export function shareOut(total: number, caps: readonly number[]): { parts: number[]; left: number } {
  const parts = caps.map(() => 0);
  const open: number[] = [];
  const most = Math.floor(total + 1e-9);
  for (let i = 0; i < caps.length && open.length < most; i++) if (caps[i] + 1e-9 >= 1) open.push(i);
  // Smallest cap first: each takes the equal share of what's left or its cap, whichever is less.
  open.sort((a, b) => caps[a] - caps[b]);
  let left = total;
  open.forEach((i, k) => {
    parts[i] = Math.min(caps[i], left / (open.length - k));
    left -= parts[i];
  });
  return { parts, left: left > 1e-9 ? left : 0 };
}
