import * as Y from "yjs";
import { CollabDoc } from "./doc";
import { inspectCheckpoint } from "./guard";
import type { RoomKeys } from "./keys";
import { RECOVERY_LIMITS, type RecoveryChunk } from "./recoveryStore";

export class RecoveryResourceError extends Error {}
const resourceProblems = new Set(["too-large", "too-many-structs", "too-many-clients", "too-many-deletions"]);

/** Decryption is separate so a validated base can serve both merging and corruption fallback. */
export class RecoveryCodec {
  constructor(
    private readonly keys: RoomKeys,
    private readonly aad: Uint8Array,
  ) {}

  async decrypt(chunks: RecoveryChunk[], maxBytes: number): Promise<Uint8Array[]> {
    if (chunks.length > RECOVERY_LIMITS.journalUpdates + 1) throw new RecoveryResourceError();
    let bytes = 0;
    const decoded: Uint8Array[] = [];
    for (const chunk of chunks) {
      if (!(chunk.iv instanceof Uint8Array) || chunk.iv.length !== 12 || !(chunk.ciphertext instanceof Uint8Array))
        throw new Error("corrupt-recovery");
      bytes += chunk.ciphertext.byteLength;
      if (bytes > maxBytes) throw new RecoveryResourceError();
      decoded.push(
        new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: chunk.iv as BufferSource, additionalData: this.aad as BufferSource },
            this.keys.storage,
            chunk.ciphertext as BufferSource,
          ),
        ),
      );
    }
    return decoded;
  }

  validate(decoded: Uint8Array[]): Uint8Array {
    const update = decoded.length === 1 ? decoded[0] : Y.mergeUpdates(decoded);
    const result = inspectCheckpoint(update);
    if (!result.ok) {
      if (resourceProblems.has(result.problem)) throw new RecoveryResourceError();
      throw new Error("corrupt-recovery");
    }
    const scratch = new CollabDoc();
    try {
      if (!scratch.applyCheckpoint(update).ok) throw new Error("corrupt-recovery");
    } finally {
      scratch.destroy();
    }
    return update;
  }
}
