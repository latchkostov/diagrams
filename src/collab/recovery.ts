import { bytesToBase64Url, textToBytes } from "../interop/codec";
import { CollabDoc } from "./doc";
import type { RoomKeys } from "./keys";
import { secureRandom } from "./random";
import { RECOVERY_LIMITS, type RecoveryRecord, type RecoveryStore } from "./recoveryStore";

export type RecoveryProblem = "unavailable" | "corrupt";

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
      record.touched > this.now() ||
      this.now() - record.touched > RECOVERY_LIMITS.ageMs
    )
      throw new Error("corrupt-recovery");
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv as BufferSource, additionalData: this.aad as BufferSource },
        this.keys.storage,
        record.ciphertext as BufferSource,
      ),
    );
  }

  private async read(): Promise<{ record?: RecoveryRecord; update?: Uint8Array }> {
    const record = await this.store.read(this.id);
    if (!record) return {};
    if (record.token === this.knownToken) return { record };
    try {
      const update = await this.decode(record);
      const scratch = new CollabDoc();
      try {
        if (!scratch.applyRemote(update).ok) throw new Error("corrupt-recovery");
      } finally {
        scratch.destroy();
      }
      this.knownToken = record.token;
      return { record, update };
    } catch {
      this.problem = "corrupt";
      await this.store.remove(this.id, record.token);
      return {};
    }
  }

  async restore(doc: CollabDoc): Promise<void> {
    try {
      const { update } = await this.read();
      if (update) {
        doc.applyRemote(update);
        this.saved = true;
      }
    } catch {
      this.problem = "unavailable";
    }
  }

  watch(doc: CollabDoc): void {
    this.stop = doc.onChange(() => {
      this.revision++;
      this.saved = false;
      this.changed();
      void this.flush(doc);
    });
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
      if (update) doc.applyRemote(update);
      const revision = this.revision;
      const iv = secureRandom(12);
      const encoded = doc.encodeDiff();
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv as BufferSource, additionalData: this.aad as BufferSource },
          this.keys.storage,
          encoded as BufferSource,
        ),
      );
      const next = { id: this.id, token: bytesToBase64Url(secureRandom(16)), touched: this.now(), iv, ciphertext };
      if (!(await this.store.write(next, record?.token))) continue;
      this.knownToken = next.token;
      this.written = revision;
    }
    this.saved = true;
    if (this.problem === "unavailable") this.problem = undefined;
  }

  async close(doc: CollabDoc): Promise<void> {
    this.stop?.();
    await this.flush(doc);
    this.closed = true;
  }
}
