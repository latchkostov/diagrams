/** A DAG stabilizes after its longest path plus one pass. Cycles retain the explicit solver cap.
 * Also stops capped DAG demand from needlessly exhausting every cyclic iteration. */
export function iterationBound(
  ids: Iterable<string>,
  edges: readonly { from: string; to: string }[],
  cap = 256,
): number {
  const pending = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!pending.has(edge.from) || !pending.has(edge.to)) continue;
    pending.set(edge.to, pending.get(edge.to)! + 1);
    const peers = outgoing.get(edge.from) ?? [];
    peers.push(edge.to);
    outgoing.set(edge.from, peers);
  }
  const ready = [...pending].filter(([, count]) => !count).map(([id]) => id);
  const depths = new Map(ready.map((id) => [id, 0]));
  let longest = 0;
  for (let head = 0; head < ready.length; head++) {
    const id = ready[head];
    for (const peer of outgoing.get(id) ?? []) {
      const depth = Math.max(depths.get(peer) ?? 0, depths.get(id)! + 1);
      depths.set(peer, depth);
      longest = Math.max(longest, depth);
      const remaining = pending.get(peer)! - 1;
      pending.set(peer, remaining);
      if (!remaining) ready.push(peer);
    }
  }
  return ready.length === pending.size ? Math.min(cap, longest + 1) : cap;
}
