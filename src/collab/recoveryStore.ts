import { guardWrite, openRecoveryDb, RECOVERY_STORES, RecoveryWipedError } from "../lib/recoveryDb";

/** Ciphertext checkpoints only. No document fields, room links or secret material enter IndexedDB. */
export interface RecoveryChunk {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}
export interface RecoveryRecord extends RecoveryChunk {
  id: string;
  token: string;
  touched: number;
  updates?: RecoveryChunk[];
  checkpoint?: string;
}
export interface RecoverySummary {
  id: string;
  touched: number;
  bytes: number;
  token?: string;
  updates?: number;
  journalBytes?: number;
  checkpoint?: string;
}
export const recoverySummary = (r: RecoveryRecord): RecoverySummary => ({
  id: r.id,
  touched: r.touched,
  bytes:
    (r.ciphertext?.byteLength ?? RECOVERY_LIMITS.recordBytes + 1) +
    (r.updates ?? []).reduce((n, u) => n + u.ciphertext.byteLength, 0),
  token: r.token,
  updates: r.updates?.length ?? 0,
  journalBytes: (r.updates ?? []).reduce((n, u) => n + u.ciphertext.byteLength, 0),
  checkpoint: r.checkpoint ?? r.token,
});

export const RECOVERY_LIMITS = {
  rooms: 16,
  bytes: 64 * 1024 * 1024,
  recordBytes: 32 * 1024 * 1024 + 16,
  ageMs: 30 * 24 * 60 * 60 * 1000,
  journalUpdates: 128,
  journalBytes: 256 * 1024,
} as const;

export interface RecoveryStore {
  read(id: string): Promise<RecoveryRecord | undefined>;
  head(id: string): Promise<RecoverySummary | undefined>;
  tail(
    id: string,
    checkpoint: string,
    after: number,
  ): Promise<{ head: RecoverySummary; updates: RecoveryChunk[] } | undefined>;
  /** Compare-and-swap and eviction share a transaction, including across tabs. */
  write(record: RecoveryRecord, expected: string | undefined): Promise<boolean>;
  /** Append only the encrypted delta; checkpoint bytes are never read or rewritten. */
  append(id: string, expected: string, token: string, touched: number, update: RecoveryChunk): Promise<boolean>;
  remove(id: string, expected: string): Promise<void>;
}

/** Oldest-write eviction, with deterministic tie-breaking. The record being saved is kept. */
export function evictions(records: RecoverySummary[], keep: string, now: number): string[] {
  const ordered = records
    .filter((r) => r.id !== keep)
    .sort((a, b) => a.touched - b.touched || a.id.localeCompare(b.id));
  let count = records.length;
  let bytes = records.reduce((n, r) => n + r.bytes, 0);
  const removed: string[] = [];
  for (const r of ordered) {
    if (count <= RECOVERY_LIMITS.rooms && bytes <= RECOVERY_LIMITS.bytes && now - r.touched <= RECOVERY_LIMITS.ageMs)
      continue;
    removed.push(r.id);
    count--;
    bytes -= r.bytes;
  }
  return removed;
}

export class IndexedDbRecoveryStore implements RecoveryStore {
  private db?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= openRecoveryDb(this.factory, recoverySummary).then(
      (db) => {
        db.onversionchange = () => {
          db.close();
          this.db = undefined;
        };
        return db;
      },
      (error: unknown) => {
        this.db = undefined;
        throw error;
      },
    ));
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, result: (value: T) => void, metadata: IDBObjectStore, updates: IDBObjectStore) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([...RECOVERY_STORES], mode);
      let value: T;
      let wiped = false;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(wiped ? new RecoveryWipedError() : (tx.error ?? new Error("recovery-write")));
      tx.onabort = () => reject(wiped ? new RecoveryWipedError() : (tx.error ?? new Error("recovery-abort")));
      const go = () =>
        run(
          tx.objectStore("rooms"),
          (v) => {
            value = v;
          },
          tx.objectStore("metadata"),
          tx.objectStore("updates"),
        );
      // Every write first checks that this device wasn't cleared since the page loaded (../lib/recoveryDb.ts).
      if (mode === "readwrite")
        guardWrite(tx, go, () => {
          wiped = true;
        });
      else go();
    });
  }

  read(id: string): Promise<RecoveryRecord | undefined> {
    return this.transaction("readonly", (store, done, metadata, updates) => {
      const req = store.get(id) as IDBRequest<RecoveryRecord | undefined>;
      const head = metadata.get(id) as IDBRequest<RecoverySummary | undefined>;
      const tail = updates.getAll(journalRange(id)) as IDBRequest<(RecoveryChunk & { id: string; sequence: number })[]>;
      tail.onsuccess = () =>
        done(
          req.result && {
            ...req.result,
            token: head.result?.token ?? req.result.token,
            touched: head.result?.touched ?? req.result.touched,
            checkpoint: head.result?.checkpoint ?? req.result.token,
            ...(tail.result.length ? { updates: tail.result.map(({ iv, ciphertext }) => ({ iv, ciphertext })) } : {}),
          },
        );
    });
  }

  head(id: string): Promise<RecoverySummary | undefined> {
    return this.transaction("readonly", (_store, done, metadata) => {
      const req = metadata.get(id) as IDBRequest<RecoverySummary | undefined>;
      req.onsuccess = () => done(req.result);
    });
  }

  tail(
    id: string,
    checkpoint: string,
    after: number,
  ): Promise<{ head: RecoverySummary; updates: RecoveryChunk[] } | undefined> {
    return this.transaction("readonly", (_store, done, metadata, updates) => {
      const req = metadata.get(id) as IDBRequest<RecoverySummary | undefined>;
      req.onsuccess = () => {
        const head = req.result;
        if (!head || head.checkpoint !== checkpoint || (head.updates ?? 0) < after) return done(undefined);
        const tail = updates.getAll(IDBKeyRange.bound([id, after], [id, Number.MAX_SAFE_INTEGER])) as IDBRequest<
          RecoveryChunk[]
        >;
        tail.onsuccess = () => done({ head, updates: tail.result.map(({ iv, ciphertext }) => ({ iv, ciphertext })) });
      };
    });
  }

  append(id: string, expected: string, token: string, touched: number, update: RecoveryChunk): Promise<boolean> {
    return this.transaction("readwrite", (_store, done, metadata, updates) => {
      const req = metadata.get(id) as IDBRequest<RecoverySummary | undefined>;
      req.onsuccess = () => {
        const old = req.result;
        if (old?.token !== expected) return done(false);
        const bytes = old.bytes + update.ciphertext.byteLength;
        if (bytes > RECOVERY_LIMITS.recordBytes || (old.updates ?? 0) >= RECOVERY_LIMITS.journalUpdates)
          return updates.transaction.abort();
        try {
          updates.put({ id, sequence: old.updates ?? 0, ...update });
          metadata.put({
            ...old,
            token,
            touched,
            bytes,
            updates: (old.updates ?? 0) + 1,
            journalBytes: (old.journalBytes ?? 0) + update.ciphertext.byteLength,
          });
        } catch {
          updates.transaction.abort();
          return;
        }
        this.evict(metadata, _store, updates, id, touched, () => done(true));
      };
    });
  }

  private evict(
    metadata: IDBObjectStore,
    store: IDBObjectStore,
    updates: IDBObjectStore,
    keep: string,
    touched: number,
    done: () => void,
  ) {
    const all = metadata.getAll() as IDBRequest<RecoverySummary[]>;
    all.onsuccess = () => {
      for (const id of evictions(all.result, keep, touched)) {
        store.delete(id);
        metadata.delete(id);
        updates.delete(journalRange(id));
      }
      done();
    };
  }

  write(record: RecoveryRecord, expected: string | undefined): Promise<boolean> {
    if (record.ciphertext.byteLength > RECOVERY_LIMITS.recordBytes) return Promise.reject(new Error("recovery-full"));
    return this.transaction("readwrite", (store, done, metadata, updates) => {
      const req = metadata.get(record.id) as IDBRequest<RecoverySummary | undefined>;
      req.onsuccess = () => {
        if (req.result?.token !== expected) {
          done(false);
          return;
        }
        try {
          store.put(record);
          metadata.put(recoverySummary(record));
          updates.delete(journalRange(record.id));
        } catch {
          store.transaction.abort();
          return;
        }
        this.evict(metadata, store, updates, record.id, record.touched, () => done(true));
      };
    });
  }

  remove(id: string, expected: string): Promise<void> {
    return this.transaction("readwrite", (store, done, metadata, updates) => {
      const req = metadata.get(id) as IDBRequest<RecoverySummary | undefined>;
      req.onsuccess = () => {
        if (req.result?.token === expected) {
          store.delete(id);
          metadata.delete(id);
          updates.delete(journalRange(id));
        }
        done(undefined);
      };
    });
  }
}

const journalRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
