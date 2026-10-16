import { bytesToBase64Url, textToBytes } from "../interop/codec";
import * as Y from "yjs";
import { CollabDoc } from "./doc";
import type { RoomKeys } from "./keys";
import { secureRandom } from "./random";
import { inspectCheckpoint } from "./guard";
import {
  RECOVERY_LIMITS,
  recoverySummary,
  type RecoveryRecord,
  type RecoveryStore,
  type RecoveryChunk,
  type RecoverySummary,
} from "./recoveryStore";

export type RecoveryProblem = "unavailable" | "corrupt";
class RecoveryResourceError extends Error {}
const resourceProblems = new Set(["too-large", "too-many-structs", "too-many-clients", "too-many-deletions"]);

/** Persists CRDT identity, including tombstones; never rebuild a checkpoint from native JSON. */
export class RoomRecovery {
  saved = false;
  problem?: RecoveryProblem;
  private revision = 0;
  private written = -1;
  private job?: Promise<void>;
  private stop?: () => void;
  private closed = false;
  private knownToken?: string;
  private cursor?: { checkpoint: string; updates: number };
  private pending: { revision: number; update: Uint8Array }[] = [];
  readonly id: string;
  private readonly aad: Uint8Array;

  constructor(
    private readonly store: RecoveryStore,
    private readonly keys: RoomKeys,
    private readonly changed: () => void = () => {},
    private readonly now = Date.now,
  ) {
    this.id = `${keys.roomId}:${keys.epoch}`;
    this.aad = textToBytes(`livediagrams/collab/storage/v1/${this.id}`);
  }

  private async decode(record: RecoveryRecord): Promise<Uint8Array> {
    if (
      record.id !== this.id ||
      !(record.iv instanceof Uint8Array) ||
      record.iv.length !== 12 ||
      !(record.ciphertext instanceof Uint8Array) ||
      record.ciphertext.byteLength > RECOVERY_LIMITS.recordBytes ||
      !Number.isFinite(record.touched) ||
      Math.max(0, this.now() - record.touched) > RECOVERY_LIMITS.ageMs
    )
      throw new Error("corrupt-recovery");
    const chunks = [record, ...(record.updates ?? [])];
    if (
      chunks.length > RECOVERY_LIMITS.journalUpdates + 1 ||
      recoverySummary(record).bytes > RECOVERY_LIMITS.recordBytes
    )
      throw new RecoveryResourceError();
    return this.decodeChunks(chunks);
  }

  private async decodeChunks(chunks: RecoveryChunk[]): Promise<Uint8Array> {
    const decoded: Uint8Array[] = [];
    for (const chunk of chunks) {
      if (!(chunk.iv instanceof Uint8Array) || chunk.iv.length !== 12 || !(chunk.ciphertext instanceof Uint8Array))
        throw new Error("corrupt-recovery");
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
    return decoded.length === 1 ? decoded[0] : Y.mergeUpdates(decoded);
  }

  private async read(): Promise<{ record?: RecoverySummary; update?: Uint8Array }> {
    const head = await this.store.head(this.id);
    if (head?.token === this.knownToken && head) return { record: head };
    // A different tab appended to the same checkpoint. Read/decrypt just the new journal entries,
    // atomically with their head. Compaction changes checkpoint identity and requires a full read.
    if (head && this.cursor && head.checkpoint === this.cursor.checkpoint) {
      const tail = await this.store.tail(this.id, this.cursor.checkpoint, this.cursor.updates);
      if (tail) {
        if (
          tail.updates.length !== (tail.head.updates ?? 0) - this.cursor.updates ||
          tail.updates.length > RECOVERY_LIMITS.journalUpdates ||
          tail.updates.reduce((n, u) => n + u.ciphertext.byteLength, 0) > RECOVERY_LIMITS.journalBytes
        )
          throw new RecoveryResourceError();
        const update = await this.decodeChunks(tail.updates);
        if (!inspectCheckpoint(update).ok) throw new RecoveryResourceError();
        this.knownToken = tail.head.token;
        this.cursor = { checkpoint: tail.head.checkpoint!, updates: tail.head.updates ?? 0 };
        return { record: tail.head, update };
      }
    }
    const record = await this.store.read(this.id);
    if (!record) return {};
    try {
      const update = await this.decode(record);
      const scratch = new CollabDoc();
      try {
        const result = scratch.applyCheckpoint(update);
        if (!result.ok) {
          if (resourceProblems.has(result.problem)) throw new RecoveryResourceError();
          throw new Error("corrupt-recovery");
        }
      } finally {
        scratch.destroy();
      }
      this.knownToken = record.token;
      this.cursor = { checkpoint: record.checkpoint ?? record.token, updates: record.updates?.length ?? 0 };
      return { record: recoverySummary(record), update };
    } catch (error) {
      if (error instanceof RecoveryResourceError) throw error;
      this.problem = "corrupt";
      await this.store.remove(this.id, record.token);
      return {};
    }
  }

  async restore(doc: CollabDoc): Promise<void> {
    try {
      const { update } = await this.read();
      if (update) {
        doc.applyCheckpoint(update);
        this.saved = true;
      }
    } catch {
      this.problem = "unavailable";
    }
  }

  watch(doc: CollabDoc): void {
    const changed = (update: Uint8Array) => {
      this.revision++;
      this.pending.push({ revision: this.revision, update });
      // Storage failure must not leave an unbounded array of keystrokes in memory. Redundant
      // already-in-flight structs may remain in a merged batch; CRDT updates are idempotent.
      if (this.pending.length >= RECOVERY_LIMITS.journalUpdates)
        this.pending = [{ revision: this.revision, update: Y.mergeUpdates(this.pending.map((p) => p.update)) }];
      this.saved = false;
      this.changed();
      void this.flush(doc);
    };
    doc.ydoc.on("update", changed);
    this.stop = () => doc.ydoc.off("update", changed);
    if (!doc.isEmpty()) void this.flush(doc);
  }

  flush(doc: CollabDoc): Promise<void> {
    if (this.closed || doc.isEmpty()) return Promise.resolve();
    return (this.job ??= this.save(doc)
      .catch(() => {
        this.saved = false;
        this.problem = "unavailable";
      })
      .finally(() => {
        this.job = undefined;
        this.changed();
      }));
  }

  private async save(doc: CollabDoc): Promise<void> {
    while (this.written !== this.revision) {
      // Another tab may have saved since we loaded. Merge its CRDT before compare-and-swap;
      // retry contention without losing either writer's updates.
      const { record, update } = await this.read();
      if (update && !doc.applyCheckpoint(update).ok) throw new RecoveryResourceError();
      const revision = this.revision;
      const updates = this.pending.map((p) => p.update);
      const bytes = updates.reduce((n, p) => n + p.byteLength, 0);
      const compact =
        !record ||
        (record.updates ?? 0) >= RECOVERY_LIMITS.journalUpdates ||
        (record.journalBytes ?? 0) + bytes + 16 >= RECOVERY_LIMITS.journalBytes ||
        record.bytes + bytes + 16 > RECOVERY_LIMITS.recordBytes;
      // A full encode/validation only at initialization or compaction. Keystrokes validate/encrypt
      // the changed structs, and IDB appends only those bytes in the same CAS transaction as its head.
      const encoded = compact ? doc.encodeDiff() : Y.mergeUpdates(updates);
      if (!inspectCheckpoint(encoded).ok) throw new RecoveryResourceError();
      const encrypted = await this.encrypt(encoded);
      const token = bytesToBase64Url(secureRandom(16));
      const touched = this.now();
      const saved = compact
        ? await this.store.write({ id: this.id, token, touched, ...encrypted }, record?.token)
        : await this.store.append(this.id, record.token!, token, touched, encrypted);
      if (!saved) continue;
      this.knownToken = token;
      this.cursor = {
        checkpoint: compact ? token : record.checkpoint!,
        updates: compact ? 0 : (record.updates ?? 0) + 1,
      };
      this.pending = this.pending.filter((p) => p.revision > revision);
      this.written = revision;
    }
    this.saved = true;
    if (this.problem === "unavailable") this.problem = undefined;
  }

  private async encrypt(encoded: Uint8Array): Promise<RecoveryChunk> {
    const iv = secureRandom(12);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: this.aad as BufferSource },
        this.keys.storage,
        encoded as BufferSource,
      ),
    );
    return { iv, ciphertext };
  }

  async close(doc: CollabDoc): Promise<void> {
    this.stop?.();
    await this.flush(doc);
    this.closed = true;
  }
}
