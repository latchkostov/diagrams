/** Ciphertext checkpoints only. No document fields, room links or secret material enter IndexedDB. */
export interface RecoveryRecord {
  id: string;
  token: string;
  touched: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export const RECOVERY_LIMITS = {
  rooms: 16,
  bytes: 64 * 1024 * 1024,
  recordBytes: 32 * 1024 * 1024 + 16,
  ageMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export interface RecoveryStore {
  read(id: string): Promise<RecoveryRecord | undefined>;
  /** Compare-and-swap and eviction share a transaction, including across tabs. */
  write(record: RecoveryRecord, expected: string | undefined): Promise<boolean>;
  remove(id: string, expected: string): Promise<void>;
}

/** Oldest-write eviction, with deterministic tie-breaking. The record being saved is kept. */
export function evictions(records: RecoveryRecord[], keep: string, now: number): string[] {
  const ordered = records
    .filter((r) => r.id !== keep)
    .sort((a, b) => a.touched - b.touched || a.id.localeCompare(b.id));
  let count = records.length;
  let bytes = records.reduce((n, r) => n + r.ciphertext.byteLength, 0);
  const removed: string[] = [];
  for (const r of ordered) {
    if (count <= RECOVERY_LIMITS.rooms && bytes <= RECOVERY_LIMITS.bytes && now - r.touched <= RECOVERY_LIMITS.ageMs)
      continue;
    removed.push(r.id);
    count--;
    bytes -= r.ciphertext.byteLength;
  }
  return removed;
}

export class IndexedDbRecoveryStore implements RecoveryStore {
  private db?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      const request = this.factory.open("livediagrams-collab-recovery-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("rooms", { keyPath: "id" });
      request.onerror = () => {
        this.db = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        this.db = undefined;
        reject(new Error("recovery-blocked"));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.db = undefined;
        };
        resolve(db);
      };
    }));
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("rooms", mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? new Error("recovery-write"));
      tx.onabort = () => reject(tx.error ?? new Error("recovery-abort"));
      run(tx.objectStore("rooms"), (v) => {
        value = v;
      });
    });
  }

  read(id: string): Promise<RecoveryRecord | undefined> {
    return this.transaction("readonly", (store, done) => {
      const req = store.get(id) as IDBRequest<RecoveryRecord | undefined>;
      req.onsuccess = () => done(req.result);
    });
  }

  write(record: RecoveryRecord, expected: string | undefined): Promise<boolean> {
    if (record.ciphertext.byteLength > RECOVERY_LIMITS.recordBytes) return Promise.reject(new Error("recovery-full"));
    return this.transaction("readwrite", (store, done) => {
      const req = store.get(record.id) as IDBRequest<RecoveryRecord | undefined>;
      req.onsuccess = () => {
        if (req.result?.token !== expected) {
          done(false);
          return;
        }
        try {
          store.put(record);
        } catch {
          store.transaction.abort();
          return;
        }
        const all = store.getAll() as IDBRequest<RecoveryRecord[]>;
        all.onsuccess = () => {
          for (const id of evictions(all.result, record.id, record.touched)) store.delete(id);
          done(true);
        };
      };
    });
  }

  remove(id: string, expected: string): Promise<void> {
    return this.transaction("readwrite", (store, done) => {
      const req = store.get(id) as IDBRequest<RecoveryRecord | undefined>;
      req.onsuccess = () => {
        if (req.result?.token === expected) store.delete(id);
        done(undefined);
      };
    });
  }
}
