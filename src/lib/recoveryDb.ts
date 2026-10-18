import { sharedWritesAllowed, storageGeneration } from "./storage";

// The room recovery database (src/collab/recoveryStore.ts: encrypted CRDT checkpoints, never a key or a link), and
// how Clear everything on this device empties it. It lives outside src/collab because clearing must work in every
// build, whether or not this page ever loaded the collaboration code.
//
// Clearing is a transaction, not a database delete. One readwrite transaction empties every store and records the
// new storage generation (../lib/storage.ts) beside the data. Every write transaction the store makes reads that
// record first and aborts when it names a generation other than the one its page loaded with. IndexedDB runs
// transactions on one database one at a time, across tabs, so a tab that hasn't heard about the wipe yet (a
// pending encryption, a slow BroadcastChannel) can't write an old room back after it: its write either ran before
// the clear (and was cleared) or runs after it (and aborts). Deleting the database instead would lose that record,
// and a late tab's open would quietly recreate the old room.

export const RECOVERY_DB = "livediagrams-collab-recovery-v1";
export const RECOVERY_DB_VERSION = 4;
export const RECOVERY_STORES = ["rooms", "metadata", "updates", "lifecycle"] as const;
const GENERATION_RECORD = "generation";

export class RecoveryWipedError extends Error {
  constructor() {
    super("This device was cleared: nothing more is saved here.");
    this.name = "RecoveryWipedError";
  }
}

/**
 * Opens (creating or upgrading) the database. `summarize` migrates checkpoints from before the journal store
 * (version 3) into the metadata store without decoding them. `waitIfBlocked`: Clear everything waits for other tabs
 * to close their connections (they do on `versionchange`); the store gives up and retries later.
 */
export function openRecoveryDb(
  factory: IDBFactory,
  summarize: (record: never) => unknown,
  opts: { waitIfBlocked?: boolean } = {},
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(RECOVERY_DB, RECOVERY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const upgrade = request.transaction;
      if (!upgrade) throw new Error("recovery-upgrade");
      if (!db.objectStoreNames.contains("rooms")) db.createObjectStore("rooms", { keyPath: "id" });
      if (!db.objectStoreNames.contains("metadata")) db.createObjectStore("metadata", { keyPath: "id" });
      if (!db.objectStoreNames.contains("updates")) {
        db.createObjectStore("updates", { keyPath: ["id", "sequence"] });
        // One-time migration of existing Lab checkpoints, without decoding content or losing CRDT identity.
        const metadata = upgrade.objectStore("metadata");
        const cursor = upgrade.objectStore("rooms").openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) {
            metadata.put(summarize(item.value as never));
            item.continue();
          }
        };
      }
      if (!db.objectStoreNames.contains("lifecycle")) db.createObjectStore("lifecycle", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error ?? new Error("recovery-open"));
    if (!opts.waitIfBlocked) request.onblocked = () => reject(new Error("recovery-blocked"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

/**
 * Runs `run` once this page may still write here. In a page outside the app's storage lifecycle (tests) there is no
 * generation to compare and the check is skipped.
 */
export function guardWrite(tx: IDBTransaction, run: () => void, refused: () => void): void {
  if (!sharedWritesAllowed()) {
    refused();
    tx.abort();
    return;
  }
  const born = storageGeneration();
  if (born === undefined) return run();
  const req = tx.objectStore("lifecycle").get(GENERATION_RECORD) as IDBRequest<{ value?: string | null } | undefined>;
  req.onsuccess = () => {
    const marker = req.result?.value;
    if (marker !== undefined && marker !== born) {
      refused();
      tx.abort();
      return;
    }
    run();
  };
}

/** Whether a recovery database may exist here: listed by the browser, or (where it can't list) a collaboration build. */
async function mayExist(factory: IDBFactory, collab: boolean): Promise<boolean> {
  if (typeof factory.databases !== "function") return collab;
  try {
    return (await factory.databases()).some((d) => d.name === RECOVERY_DB);
  } catch {
    return collab;
  }
}

/**
 * Clear everything: empties the recovery database and records `generation`, in one transaction. Resolves once it has
 * committed, after any write already running in another tab. Nothing to do where there is no IndexedDB or no
 * database.
 */
export async function wipeRecoveryDb(
  generation: string,
  opts: { factory?: IDBFactory; collab: boolean },
): Promise<void> {
  const factory = opts.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory || !(await mayExist(factory, opts.collab))) return;
  const db = await openRecoveryDb(factory, (record) => record, { waitIfBlocked: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...RECOVERY_STORES], "readwrite");
      for (const store of RECOVERY_STORES) if (store !== "lifecycle") tx.objectStore(store).clear();
      tx.objectStore("lifecycle").put({ id: GENERATION_RECORD, value: generation });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("recovery-wipe"));
      tx.onabort = () => reject(tx.error ?? new Error("recovery-wipe"));
    });
  } finally {
    db.close();
  }
}
