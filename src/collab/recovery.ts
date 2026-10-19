import { bytesToBase64Url, textToBytes } from "../interop/codec";
import * as Y from "yjs";
import { CollabDoc } from "./doc";
import type { RoomKeys } from "./keys";
import { secureRandom } from "./random";
import { inspectCheckpoint } from "./guard";
import { realClock, type Clock } from "./clock";
import { RecoveryCodec, RecoveryResourceError } from "./recoveryCodec";
import {
  RECOVERY_LIMITS,
  recoverySummary,
  type RecoveryRecord,
  type RecoveryStore,
  type RecoveryChunk,
  type RecoverySummary,
} from "./recoveryStore";

export type RecoveryProblem = "unavailable" | "corrupt";
export const RECOVERY_RETRY = { initialMs: 1000, maxMs: 30_000 } as const;

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
  private queuedBytes = 0;
  private checkpointRequired = true;
  private checkpointRevision?: number;
  private retry?: () => void;
  private retryDelay: number = RECOVERY_RETRY.initialMs;
  /** The document's state vector when its last checkpoint was captured (undefined before one is known). */
  private savedVector?: Uint8Array;

  /**
   * What this document holds beyond its last saved checkpoint, as one CRDT update (it carries the whole delete set,
   * so deletions are included): merging it into any later checkpoint adds only these edits and reverts nothing.
   * Undefined when everything is saved.
   */
  unsaved(doc: CollabDoc): Uint8Array | undefined {
    if (this.saved || doc.isEmpty()) return undefined;
    return doc.encodeDiff(this.savedVector);
  }

  /** Diagnostic bound on retained plaintext deltas (the live CRDT is owned by the session). */
  get pendingBytes(): number {
    return this.queuedBytes;
  }
  readonly id: string;
  private readonly aad: Uint8Array;
  private readonly codec: RecoveryCodec;

  constructor(
    private readonly store: RecoveryStore,
    private readonly keys: RoomKeys,
    private readonly changed: () => void = () => {},
    private readonly now = Date.now,
    private readonly clock: Clock = realClock,
    /**
     * A knock-to-join room's epoch scope (`<epoch>:<start signature>`): two epochs with one number (each side of a
     * partition) have different secrets, so each keeps its own copy. Without one (rooms before knock-to-join), the
     * epoch number names it, as it always has.
     */
    scope?: string,
  ) {
    this.id = scope ? `${keys.roomId}:${scope}` : `${keys.roomId}:${keys.epoch}`;
    this.aad = textToBytes(`livediagrams/collab/storage/v1/${this.id}`);
    this.codec = new RecoveryCodec(keys, this.aad);
  }

  private async decode(record: RecoveryRecord): Promise<Uint8Array> {
    if (
      record.id !== this.id ||
      !(record.iv instanceof Uint8Array) ||
      record.iv.length !== 12 ||
      !(record.ciphertext instanceof Uint8Array) ||
      !Number.isFinite(record.touched) ||
      Math.max(0, this.now() - record.touched) > RECOVERY_LIMITS.ageMs
    )
      throw new Error("corrupt-recovery");
    if (
      (record.updates?.length ?? 0) > RECOVERY_LIMITS.journalUpdates ||
      recoverySummary(record).bytes > RECOVERY_LIMITS.recordBytes
    )
      throw new RecoveryResourceError();
    return this.decodeChunks([record, ...(record.updates ?? [])]);
  }

  private async decodeChunks(
    chunks: RecoveryChunk[],
    maxBytes: number = RECOVERY_LIMITS.recordBytes,
  ): Promise<Uint8Array> {
    return this.codec.validate(await this.codec.decrypt(chunks, maxBytes));
  }

  private async read(): Promise<{ record?: RecoverySummary; update?: Uint8Array }> {
    const head = await this.store.head(this.id);
    if (head?.token === this.knownToken && head) return { record: head };
    // A different tab appended to the same checkpoint. Read/decrypt just the new journal entries,
    // atomically with their head. Compaction changes checkpoint identity and requires a full read.
    if (head && this.cursor && head.checkpoint === this.cursor.checkpoint) {
      const tail = await this.store.tail(this.id, this.cursor.checkpoint, this.cursor.updates);
      if (tail) {
        try {
          if (tail.updates.length > RECOVERY_LIMITS.journalUpdates) throw new RecoveryResourceError();
          if (tail.updates.length !== (tail.head.updates ?? 0) - this.cursor.updates)
            throw new Error("corrupt-recovery");
          const update = await this.decodeChunks(tail.updates, RECOVERY_LIMITS.journalBytes);
          this.knownToken = tail.head.token;
          this.cursor = { checkpoint: tail.head.checkpoint!, updates: tail.head.updates ?? 0 };
          return { record: tail.head, update };
        } catch (error) {
          if (error instanceof RecoveryResourceError) throw error;
          // Use the full reader's corruption policy and retain its last valid base checkpoint.
          // Read again atomically: another tab may already have replaced the damaged tail.
        }
      }
    }
    const record = await this.store.read(this.id);
    if (!record) return {};
    let base: Uint8Array | undefined;
    try {
      base = await this.decode({ ...record, updates: undefined });
      let update = base;
      if (record.updates?.length) {
        if (
          record.updates.length > RECOVERY_LIMITS.journalUpdates ||
          recoverySummary(record).bytes > RECOVERY_LIMITS.recordBytes
        )
          throw new RecoveryResourceError();
        const deltas = await this.codec.decrypt(record.updates, RECOVERY_LIMITS.journalBytes);
        update = this.codec.validate([base, ...deltas]);
      }
      this.knownToken = record.token;
      this.cursor = { checkpoint: record.checkpoint ?? record.token, updates: record.updates?.length ?? 0 };
      return { record: recoverySummary(record), update };
    } catch (error) {
      if (error instanceof RecoveryResourceError) throw error;
      this.problem = "corrupt";
      await this.store.remove(this.id, record.token);
      this.knownToken = undefined;
      this.cursor = undefined;
      this.requireCheckpoint();
      return { update: base };
    }
  }

  private requireCheckpoint(): void {
    this.checkpointRequired = true;
    this.checkpointRevision = undefined;
    this.pending = [];
    this.queuedBytes = 0;
  }

  async restore(doc: CollabDoc): Promise<void> {
    try {
      const { record, update } = await this.read();
      if (update) {
        doc.applyCheckpoint(update);
        this.saved = !!record;
        if (record) this.savedVector = Y.encodeStateVectorFromUpdate(update);
      }
    } catch {
      this.problem = "unavailable";
    }
  }

  watch(doc: CollabDoc): void {
    const changed = (update: Uint8Array) => {
      this.revision++;
      if (!this.checkpointRequired || this.checkpointRevision !== undefined) {
        if (
          this.queuedBytes + update.byteLength > RECOVERY_LIMITS.journalBytes ||
          this.pending.length >= RECOVERY_LIMITS.journalUpdates
        )
          this.requireCheckpoint();
        else {
          this.pending.push({ revision: this.revision, update });
          this.queuedBytes += update.byteLength;
        }
      }
      this.saved = false;
      this.changed();
      void this.flush(doc);
    };
    doc.ydoc.on("update", changed);
    this.stop = () => doc.ydoc.off("update", changed);
    // Attaching may follow offline edits that predate this listener. Never append until their
    // complete CRDT base has been acknowledged by storage.
    this.requireCheckpoint();
    this.saved = false;
    if (!doc.isEmpty()) void this.flush(doc);
  }

  flush(doc: CollabDoc): Promise<void> {
    if (this.closed || this.retry || doc.isEmpty()) return Promise.resolve();
    return (this.job ??= this.save(doc)
      .catch(() => {
        this.requireCheckpoint();
        this.saved = false;
        this.problem = "unavailable";
        this.retry = this.clock.after(this.retryDelay, () => {
          this.retry = undefined;
          void this.flush(doc);
        });
        this.retryDelay = Math.min(this.retryDelay * 2, RECOVERY_RETRY.maxMs);
      })
      .finally(() => {
        this.job = undefined;
        this.changed();
        // An update can arrive between save's last loop check and this promise
        // reaction. Its flush saw the old job; keep that caller waiting for the
        // queued revision rather than leaving it unsaved until another edit.
        if (this.written !== this.revision || this.checkpointRequired) return this.flush(doc);
      }));
  }

  private async save(doc: CollabDoc): Promise<void> {
    while (this.written !== this.revision || this.checkpointRequired) {
      // Another tab may have saved since we loaded. Merge its CRDT before compare-and-swap;
      // retry contention without losing either writer's updates.
      const { record, update } = await this.read();
      if (update && !doc.applyCheckpoint(update).ok) throw new RecoveryResourceError();
      const revision = this.revision;
      const vector = doc.stateVector();
      const updates = this.pending.map((p) => p.update);
      const bytes = updates.reduce((n, p) => n + p.byteLength, 0);
      const compact =
        this.checkpointRequired ||
        !record ||
        (record.updates ?? 0) >= RECOVERY_LIMITS.journalUpdates ||
        (record.journalBytes ?? 0) + bytes + 16 >= RECOVERY_LIMITS.journalBytes ||
        record.bytes + bytes + 16 > RECOVERY_LIMITS.recordBytes;
      // A full encode/validation only at initialization or compaction. Keystrokes validate/encrypt
      // the changed structs, and IDB appends only those bytes in the same CAS transaction as its head.
      const encoded = compact ? doc.encodeDiff() : Y.mergeUpdates(updates);
      if (compact) {
        this.checkpointRevision = revision;
        // The captured base owns these revisions. Retain only edits arriving after its encode.
        this.pending = [];
        this.queuedBytes = 0;
      }
      if (!inspectCheckpoint(encoded).ok) throw new RecoveryResourceError();
      const encrypted = await this.encrypt(encoded);
      const token = bytesToBase64Url(secureRandom(16));
      const touched = this.now();
      const saved = compact
        ? await this.store.write({ id: this.id, token, touched, ...encrypted }, record?.token)
        : await this.store.append(this.id, record.token!, token, touched, encrypted);
      if (!saved) {
        // A rejected base never covered its captured revisions on disk.
        if (compact) this.requireCheckpoint();
        continue;
      }
      this.knownToken = token;
      this.cursor = {
        checkpoint: compact ? token : record.checkpoint!,
        updates: compact ? 0 : (record.updates ?? 0) + 1,
      };
      this.pending = this.pending.filter((p) => p.revision > revision);
      this.queuedBytes = this.pending.reduce((n, p) => n + p.update.byteLength, 0);
      if (compact && this.checkpointRevision === revision) this.checkpointRequired = false;
      this.checkpointRevision = undefined;
      this.written = revision;
      this.savedVector = vector;
    }
    this.saved = true;
    this.retryDelay = RECOVERY_RETRY.initialMs;
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
    this.cancelRetry();
    // Leaving is an explicit final save attempt, even during backoff.
    await this.flush(doc);
    this.closed = true;
    this.cancelRetry();
  }

  private cancelRetry(): void {
    this.retry?.();
    this.retry = undefined;
  }
}
