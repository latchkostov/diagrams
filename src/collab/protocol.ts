// What a room's decrypted frames say: one type byte, then its payload. Document channel:
//
//   1 sync-request   <Yjs state vector>   "this is what I have": the receiver replies with what it lacks
//   2 sync-reply     <Yjs update>         the difference, to the requester only
//   3 update         <Yjs update>         one local step, to everyone
//   4 bye                                 leaving (presence goes at once rather than on expiry)
//
// Presence channel:
//
//   1 state          <JSON {alias, colour, status}>
//
// Peers never forward each other's updates (no loops); anti-entropy (a periodic sync-request) heals drops and
// partitions instead, since a CRDT state vector names exactly what is missing.

export const DOC = { syncRequest: 1, syncReply: 2, update: 3, bye: 4 } as const;
export const PRESENCE = { state: 1 } as const;

export function frame(type: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + (payload?.length ?? 0));
  out[0] = type;
  if (payload) out.set(payload, 1);
  return out;
}

export function unframe(bytes: Uint8Array): { type: number; payload: Uint8Array } | undefined {
  if (!bytes.length) return undefined;
  return { type: bytes[0], payload: bytes.subarray(1) };
}

/** An empty Yjs update (no structs, no deletions): nothing to send. */
export const isEmptyUpdate = (u: Uint8Array) => u.length <= 2 && u.every((b) => b === 0);
