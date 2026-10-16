// Collaboration C0: every bound a room enforces on what arrives from other people, in one place
// (docs/research/collaboration-threat-model.md, "Bounds"). Frames are checked before they are decrypted, decoded
// updates before they are applied, and the projected diagram through the same validator as an imported file.

export const COLLAB_LIMITS = {
  /** A document frame (an update, a sync reply): ciphertext bytes, checked before decrypting. A full
   *  5,000-node diagram's state is well under this (src/collab/scale.test.ts measures it). */
  maxDocFrameBytes: 8 * 1024 * 1024,
  /** A presence frame (alias, colour, status). */
  maxPresenceFrameBytes: 4 * 1024,
  /** Distinct senders (sessions) a room tracks replay state and presence for. A new sender past this is refused. */
  maxSenders: 64,
  /** Out-of-order counters a sender's replay window accepts. Older ones are refused as stale. */
  replayWindow: 1024,
  /** Structs (Yjs items, deletions, skips) in one decoded update. */
  maxStructsPerUpdate: 1_000_000,
  /** Characters in one string inside an update (a label, a field name). */
  maxStringChars: 100_000,
  /** Characters in a field name (a Yjs map key). */
  maxKeyChars: 256,
  /** Distinct Yjs clients in one update, and the largest clock a client may claim. */
  maxClientsPerUpdate: 100_000,
  maxClock: 2 ** 30,
  /** Delete-set ranges in one update. */
  maxDeleteRanges: 1_000_000,
  /** Nesting depth of one JSON value stored atomically (a node's props value, a simulation's traffic). */
  maxValueDepth: 32,
  /** Bytes a single sender may deliver per window (a token bucket on the room clock), document frames. */
  senderBytesPerWindow: 64 * 1024 * 1024,
  senderWindowMs: 10_000,
  /** Bytes of sync replies a session sends one requester per window (the same window). */
  replyBytesPerWindow: 16 * 1024 * 1024,
  /** Presence: what a peer's entry may say. */
  maxAliasChars: 40,
  /** Presence entries expire when their sender hasn't refreshed them for this long (room clock). */
  presenceTtlMs: 30_000,
  /** How often a session refreshes its own presence. */
  presenceHeartbeatMs: 10_000,
  /** How often a session asks its peers for what it's missing (heals drops and partitions). */
  antiEntropyMs: 5_000,
  /** Envelope counter ceiling per sender session: well inside the IV's 64 bits and a double's exact range. */
  maxCounter: 2 ** 48,
} as const;

export type CollabLimits = typeof COLLAB_LIMITS;
