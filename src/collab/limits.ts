// Collaboration C0: every bound a room enforces on what arrives from other people, in one place
// (docs/research/collaboration-threat-model.md, "Bounds"). Frames are checked before they are decrypted, decoded
// updates before they are applied, and the projected diagram through the same validator as an imported file.

export const COLLAB_LIMITS = {
  connectionWaitMs: 10_000,
  /**
   * A document message (an update, a sync reply) larger than this travels as fragments of this size, each sealed in
   * a frame of its own (./protocol.ts), so no frame is ever large and a room isn't bounded by a frame.
   */
  maxFragmentBytes: 1024 * 1024,
  /** A document frame: one fragment plus headers, ciphertext bytes, checked before decrypting. */
  maxDocFrameBytes: 1024 * 1024 + 1024,
  /**
   * A whole document message once reassembled: one update or one sync reply. A full 5,000-node diagram is about
   * 2 MB (src/collab/scale.test.ts); a sync reply larger than this is split by Yjs client.
   */
  maxMessageBytes: 32 * 1024 * 1024,
  /** Messages one sender may have half-delivered at once, and how long a half-delivered one is kept (room clock). */
  maxPartialMessages: 4,
  partialTtlMs: 30_000,
  /** A local step's encoded size, bounded from above before it's applied (./guard.ts). */
  maxStepBytes: 4 * 1024 * 1024,
  /**
   * A soft bound on the room's encoded state: a local step that would take it past this is refused (measured
   * exactly when the estimate gets close). Concurrent steps can overshoot it; half the message bound leaves room for
   * several at once, and a sync reply larger than a message is split anyway.
   */
  maxRoomBytes: 16 * 1024 * 1024,
  /** Undo history a session keeps (estimated bytes of its steps, and steps): older steps are dropped and what they
   *  replaced is garbage collected, so one person's history can't grow the room without bound. */
  maxHistoryBytes: 8 * 1024 * 1024,
  maxHistorySteps: 500,
  /** Bytes of half-delivered messages kept: from one sender, and in total. */
  maxPartialBytesPerSender: 32 * 1024 * 1024,
  maxPartialBytes: 64 * 1024 * 1024,
  /** A presence frame (alias, colour, status). */
  maxPresenceFrameBytes: 4 * 1024,
  /** A shared Live frame: one start, op, beacon or digest, or a slice of a run's log. */
  maxLiveFrameBytes: 16 * 1024,
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
  /** Accumulated local checkpoints span many accepted updates; still bounded before Yjs application. */
  maxCheckpointStructs: 4_000_000,
  maxCheckpointClients: 1_000_000,
  maxCheckpointDeletions: 4_000_000,
  /** Small proof frames must not buy unbounded whole-document hashing work. */
  syncProofsPerWindow: 128,
  maxClock: 2 ** 30,
  /** Delete-set ranges in one update. */
  maxDeleteRanges: 1_000_000,
  /** Nesting depth of one JSON value stored atomically (a node's props value, a simulation's traffic). */
  maxValueDepth: 32,
  /** Bytes a single sender may deliver per window (a token bucket on the room clock), document frames. */
  senderBytesPerWindow: 64 * 1024 * 1024,
  senderWindowMs: 10_000,
  /** Bytes of sync replies a session sends one requester per window (the same window): two whole messages, so
   *  any reply part fits once the bucket refills. */
  replyBytesPerWindow: 64 * 1024 * 1024,
  /** Sync requests a session answers per requester per window: anti-entropy needs about two. */
  syncRequestsPerWindow: 12,
  /** Bytes of received frames waiting to be handled, in total and from one transport peer. */
  maxQueuedBytes: 48 * 1024 * 1024,
  maxQueuedBytesPerPeer: 24 * 1024 * 1024,
  /** Presence: what a peer's entry may say. */
  maxAliasChars: 40,
  /** Co-hosts a room's roster names at most (src/collab/room/roomRoster.ts): one fewer than a full room. */
  maxCohosts: 7,
  /** Presence entries expire when their sender hasn't refreshed them for this long (room clock). */
  presenceTtlMs: 30_000,
  /** How often a session refreshes its own presence. */
  presenceHeartbeatMs: 10_000,
  /**
   * Presence frames one sender may deliver per window (senderWindowMs): cursors at their 15 Hz cap plus heartbeats
   * and selections, with room to spare. Past it they are dropped (and counted), unlike document frames' byte bucket.
   */
  presenceFramesPerWindow: 200,
  /**
   * Shared Live frames one sender may deliver per window: beacons at 2 Hz, digests, a slider's ops at up to 10 Hz
   * and a late joiner's log slices, with room to spare. Past it they are dropped (and counted).
   */
  liveFramesPerWindow: 600,
  /**
   * Signed rooms (P4): signature verifications one sender may cost per window (frames and roster entries: a full
   * roster is at most 1,024), and how often a session sends its whole roster back to one peer whose summary differs.
   */
  verifiesPerWindow: 2048,
  rosterRepliesPerWindow: 4,
  /** A roster message's JSON: a full roster of 1,024 entries is about 300 KB. */
  maxRosterMessageBytes: 1024 * 1024,
  /**
   * A signed room's document frames that don't count yet (a grant or a binding still on its way): held this long, and
   * this many bytes per sender (a whole diagram's sync reply fits), then dropped and the sender quarantined.
   */
  heldMs: 30_000,
  maxHeldBytesPerSender: 4 * 1024 * 1024,
  /** A session sends its cursor at most this often (15 times a second). */
  cursorIntervalMs: 67,
  /** A peer's cursor that hasn't moved for this long is hidden (and while they're away). */
  cursorIdleMs: 5_000,
  /** A joiner with no document and no failure for this long hears "No one else is in this room" (each attempt). */
  noAnswerMs: 30_000,
  /** How often a session asks its peers for what it's missing (heals drops and partitions). */
  antiEntropyMs: 5_000,
  /** Envelope counter ceiling per sender session: well inside the IV's 64 bits and a double's exact range. */
  maxCounter: 2 ** 48,
} as const;

export type CollabLimits = typeof COLLAB_LIMITS;
