import { expect, it, vi, onTestFinished } from "vitest";
import * as Y from "yjs";
import { COLLAB_LIMITS } from "./limits";
import { CollabDoc } from "./doc";
import { deriveEpochKeys, deriveRoomKeys, newEpochSecret, newRoom } from "./keys";
import { commitEpoch, scopeOf, signStart } from "./epochs";
import { seededBytes } from "./random";
import { newAgreement, newIdentity } from "./signing";
import { demoDiagram } from "./lab/demo";
import { RECOVERY_RETRY, RoomRecovery } from "./recovery";
import {
  evictions,
  recoverySummary,
  RECOVERY_LIMITS,
  type RecoveryRecord,
  type RecoveryStore,
  type RecoveryChunk,
} from "./recoveryStore";
import { roomFor } from "./transport/conformance";
import { CollabSession } from "./session";
import { FakeClock, realClock } from "./clock";
import { MemoryNetwork } from "./transport/memory";
import { metaOf } from "./schema";

class Store implements RecoveryStore {
  records = new Map<string, RecoveryRecord>();
  fail = false;
  contention = false;
  head(id: string) {
    const r = this.records.get(id);
    return Promise.resolve(r && recoverySummary(r));
  }
  tail(id: string, checkpoint: string, after: number) {
    const old = this.records.get(id);
    if (!old || (old.checkpoint ?? old.token) !== checkpoint) return Promise.resolve(undefined);
    return Promise.resolve({ head: recoverySummary(old), updates: structuredClone(old.updates?.slice(after) ?? []) });
  }
  append(id: string, expected: string, token: string, touched: number, update: RecoveryChunk) {
    const old = this.records.get(id);
    if (old?.token !== expected) return Promise.resolve(false);
    return this.write(
      { ...old, token, touched, checkpoint: old.checkpoint ?? old.token, updates: [...(old.updates ?? []), update] },
      expected,
    );
  }
  read(id: string) {
    return Promise.resolve(structuredClone(this.records.get(id)));
  }
  write(record: RecoveryRecord, expected?: string) {
    if (this.fail) return Promise.reject(new DOMException("full", "QuotaExceededError"));
    if (this.contention) {
      this.contention = false;
      return Promise.resolve(false);
    }
    if (this.records.get(record.id)?.token !== expected) return Promise.resolve(false);
    this.records.set(record.id, structuredClone(record));
    for (const id of evictions([...this.records.values()].map(recoverySummary), record.id, record.touched))
      this.records.delete(id);
    return Promise.resolve(true);
  }
  remove(id: string, expected: string) {
    if (this.records.get(id)?.token === expected) this.records.delete(id);
    return Promise.resolve();
  }
}

it("persists an edit arriving as the preceding write completes, before its job is released", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(112));
  const doc = new CollabDoc({ clientId: 112 });
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  let signalEntered: () => void = () => {
    throw new Error("Write gate not initialized");
  };
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const write = store.write.bind(store);
  let complete: () => void = () => {
    throw new Error("Write has not started");
  };
  const writes = vi.spyOn(store, "write").mockImplementationOnce((record, expected) => {
    let release: (value: boolean) => void = () => {
      throw new Error("Write result gate not initialized");
    };
    const held = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    complete = () => {
      void write(record, expected).then((saved) => {
        release(saved);
        // The save continuation runs first; this update precedes its catch/finally
        // reactions, while flush still sees the preceding job as active.
        queueMicrotask(() =>
          doc.apply([{ op: "patch", kind: "nodes", id: "api", set: { label: "Edit at write completion" } }]),
        );
      });
    };
    signalEntered();
    return held;
  });
  onTestFinished(async () => {
    await recovery.close(doc);
    doc.destroy();
    writes.mockRestore();
  });
  recovery.watch(doc);
  await entered;
  const pending = recovery.flush(doc);
  complete();
  await pending;
  expect(recovery.saved).toBe(true);
  expect(writes).toHaveBeenCalledTimes(2);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(restored.project().diagram?.nodes.find((n) => n.id === "api")?.label).toBe("Edit at write completion");
  restored.destroy();
});

it("recovers encrypted CRDT identity and deletions, merges offline edits, and scopes records by generation", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(101));
  const first = new CollabDoc({ clientId: 1 });
  first.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(first);
  await recovery.flush(first);
  const bytes = [...store.records.values()][0];
  expect(new TextDecoder().decode(bytes.ciphertext)).not.toContain("Orders pipeline");
  expect(Object.keys(bytes).sort()).toEqual(["ciphertext", "id", "iv", "token", "touched"]);
  await expect(crypto.subtle.exportKey("raw", keys.storage)).rejects.toThrow();
  await expect(
    crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.iv as BufferSource,
        additionalData: new TextEncoder().encode(`livediagrams/collab/storage/v1/${recovery.id}`),
      },
      keys.signal,
      bytes.ciphertext as BufferSource,
    ),
  ).rejects.toThrow();
  const copy = new CollabDoc({ clientId: 2 });
  const resumed = new RoomRecovery(store, keys);
  await resumed.restore(copy);
  expect(copy.stateVector()).toEqual(first.stateVector());
  expect(copy.canUndo()).toBe(false);
  resumed.watch(copy);
  first.apply([{ op: "patch", kind: "nodes", id: "api", set: { label: "Offline API" } }]);
  copy.apply([{ op: "remove", kind: "nodes", id: "db" }]);
  await Promise.all([recovery.flush(first), resumed.flush(copy)]);
  const final = new CollabDoc();
  const reopened = new RoomRecovery(store, keys);
  await reopened.restore(final);
  expect(final.project().diagram?.nodes.find((n) => n.id === "api")?.label).toBe("Offline API");
  expect(final.project().diagram?.nodes.find((n) => n.id === "db")).toBeUndefined();
  expect(final.canUndo()).toBe(false);
  const nextGeneration = new RoomRecovery(store, await deriveRoomKeys({ ...roomFor(101), epoch: 1 }));
  const empty = new CollabDoc();
  await nextGeneration.restore(empty);
  expect(empty.isEmpty()).toBe(true);
  await Promise.all([recovery.close(first), resumed.close(copy)]);
  for (const doc of [first, copy, final, empty]) doc.destroy();
});

it("sync proofs distinguish deletion-only changes even when the state vectors match", async () => {
  const a = new CollabDoc(),
    b = new CollabDoc();
  a.hydrate(demoDiagram());
  b.applyRemote(a.encodeDiff());
  expect(await a.syncProof()).toEqual(await b.syncProof());
  a.apply([{ op: "remove", kind: "nodes", id: "db" }]);
  expect(a.stateVector()).toEqual(b.stateVector());
  expect(await a.syncProof()).not.toEqual(await b.syncProof());
  b.applyRemote(a.encodeDiff());
  expect(await a.syncProof()).toEqual(await b.syncProof());
  a.destroy();
  b.destroy();
});

it("restores accumulated checkpoints beyond a single wire update limit and never deletes a resource-limited checkpoint", async () => {
  const limits = COLLAB_LIMITS as unknown as Record<string, number>;
  const prior = { maxClientsPerUpdate: limits.maxClientsPerUpdate, maxCheckpointClients: limits.maxCheckpointClients };
  onTestFinished(() => {
    Object.assign(limits, prior);
  });
  limits.maxClientsPerUpdate = 2;
  limits.maxCheckpointClients = 16;
  const doc = new CollabDoc({ clientId: 100 });
  doc.hydrate(demoDiagram());
  for (let client = 1; client < 8; client++) {
    const part = new Y.Doc();
    part.clientID = client;
    part.getMap("meta").set(`@client${client}`, client);
    expect(doc.applyRemote(Y.encodeStateAsUpdate(part)).ok).toBe(true);
    part.destroy();
  }
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(111)),
    recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  const copy = new CollabDoc(),
    resumed = new RoomRecovery(store, keys);
  await resumed.restore(copy);
  expect(copy.stateVector()).toEqual(doc.stateVector());
  expect(resumed.problem).toBeUndefined();
  limits.maxCheckpointClients = 2;
  const refused = new RoomRecovery(store, keys),
    empty = new CollabDoc();
  await refused.restore(empty);
  expect(refused.problem).toBe("unavailable");
  expect(store.records.has(recovery.id)).toBe(true);
  limits.maxCheckpointClients = 16;
  await recovery.close(doc);
  doc.destroy();
  copy.destroy();
  empty.destroy();
});

it("caches sync hashing until the document changes", async () => {
  const doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const digest = vi.spyOn(crypto.subtle, "digest");
  onTestFinished(() => digest.mockRestore());
  for (let n = 0; n < 16; n++) await doc.syncProof();
  expect(digest).toHaveBeenCalledTimes(1);
  doc.apply([{ op: "meta", set: { title: "New revision" } }]);
  await doc.syncProof();
  expect(digest).toHaveBeenCalledTimes(2);
  doc.destroy();
});

it("notifies a synced room when a silent new peer invalidates whole-room sync", async () => {
  const net = new MemoryNetwork(),
    clock = new FakeClock();
  const a = await CollabSession.open({
    room: roomFor(112),
    transport: net.connect(),
    privacy: {},
    clock,
    initial: demoDiagram(),
  });
  const b = await CollabSession.open({ room: roomFor(112), transport: net.connect(), privacy: {}, clock });
  await net.settle(async () => {
    await a.idle();
    await b.idle();
  });
  expect(a.roomStatus).toBe("synced");
  const changed = vi.fn();
  a.onChange(changed);
  const silent = net.connect();
  expect(a.roomStatus).not.toBe("synced");
  expect(changed).toHaveBeenCalled();
  silent.close();
  await Promise.all([a.leave(), b.leave()]);
  a.doc.destroy();
  b.doc.destroy();
});

it.each(["ciphertext", "iv", "schema", "expired"])(
  "discards a %s-corrupt checkpoint and remains recoverable",
  async (fault) => {
    const store = new Store(),
      keys = await deriveRoomKeys(roomFor(102));
    const first = new CollabDoc();
    first.hydrate(demoDiagram());
    const recovery = new RoomRecovery(
      store,
      keys,
      () => {},
      () => 1000,
    );
    recovery.watch(first);
    await recovery.flush(first);
    await recovery.close(first);
    const record = store.records.get(recovery.id)!;
    if (fault === "ciphertext") record.ciphertext[0] ^= 1;
    if (fault === "iv") record.iv = new Uint8Array(3);
    if (fault === "expired") record.touched = 1000 - RECOVERY_LIMITS.ageMs - 1;
    if (fault === "schema") {
      const bad = new CollabDoc();
      bad.ydoc.getMap("unknown-root").set("payload", {});
      record.ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: record.iv as BufferSource,
            additionalData: new TextEncoder().encode(`livediagrams/collab/storage/v1/${recovery.id}`),
          },
          keys.storage,
          bad.encodeDiff() as BufferSource,
        ),
      );
      bad.destroy();
    }
    const copy = new CollabDoc(),
      resumed = new RoomRecovery(
        store,
        keys,
        () => {},
        () => 1000,
      );
    await resumed.restore(copy);
    expect(copy.isEmpty()).toBe(true);
    expect(resumed.problem).toBe("corrupt");
    expect(store.records.has(recovery.id)).toBe(false);
    copy.hydrate(demoDiagram());
    resumed.watch(copy);
    await resumed.flush(copy);
    expect(resumed.saved).toBe(true);
    await resumed.close(copy);
    first.destroy();
    copy.destroy();
  },
);

it("keeps quota-exceeded edits in memory, reports unsaved, and retries after backoff", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(103));
  const doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  store.fail = true;
  const changed = vi.fn(),
    clock = new FakeClock(),
    recovery = new RoomRecovery(store, keys, changed, Date.now, clock);
  recovery.watch(doc);
  await recovery.flush(doc);
  doc.apply([{ op: "meta", set: { title: "Keep this work" } }]);
  await recovery.flush(doc);
  expect(recovery.saved).toBe(false);
  expect(recovery.problem).toBe("unavailable");
  expect(doc.project().diagram?.title).toBe("Keep this work");
  store.fail = false;
  store.contention = true;
  clock.advance(RECOVERY_RETRY.initialMs);
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  expect(recovery.problem).toBeUndefined();
  expect(changed).toHaveBeenCalled();
  await recovery.close(doc);
  doc.destroy();
});

it("recovery waits for local durability before navigation", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(113)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  let entered: () => void = () => {},
    release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = store.write.bind(store);
  vi.spyOn(store, "write").mockImplementation(async (record, expected) => {
    entered();
    await held;
    return write(record, expected);
  });
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await started;
  expect(doc.project().diagram?.title).toBe("Orders pipeline");
  expect(recovery.saved).toBe(false);
  expect(store.records.size).toBe(0);
  release();
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  expect(store.records.size).toBe(1);
  await recovery.close(doc);
  doc.destroy();
});

it("evicts the oldest checkpoints by count, bytes and age while keeping the new record", () => {
  const record = (id: string, touched: number, size = 1) =>
    recoverySummary({
      id,
      touched,
      token: id,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(size),
    });
  expect(
    evictions(
      Array.from({ length: 18 }, (_, i) => record(String(i), i)),
      "17",
      20,
    ),
  ).toEqual(["0", "1"]);
  expect(evictions([record("old", 1, RECOVERY_LIMITS.bytes), record("new", 2)], "new", 2)).toEqual(["old"]);
  expect(
    evictions([record("old", 0), record("new", RECOVERY_LIMITS.ageMs + 1)], "new", RECOVERY_LIMITS.ageMs + 1),
  ).toEqual(["old"]);
});

it("retains guard-valid CRDT checkpoints when concurrent work no longer validates natively", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(106));
  const doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  // A guard-valid native validation failure stands for concurrent overflow or a schema conflict.
  metaOf(doc.ydoc).set("planning", {});
  expect(doc.project().status).toBe("invalid");
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  const copy = new CollabDoc(),
    resumed = new RoomRecovery(store, keys);
  await resumed.restore(copy);
  expect(copy.project().status).toBe("invalid");
  expect(copy.recoveryExport()).toEqual(doc.recoveryExport());
  expect(resumed.problem).toBeUndefined();
  expect(store.records.has(recovery.id)).toBe(true);
  await recovery.close(doc);
  doc.destroy();
  copy.destroy();
});

it("does not claim whole-room sync while a reachable peer is behind, and rejects proofs from unknown transport identities", async () => {
  const net = new MemoryNetwork(),
    clock = new FakeClock(),
    raw = net.connect();
  let lagging = true,
    spoof = false;
  const transport = {
    ...raw,
    peers: () => [...raw.peers(), ...(lagging ? ["lagging"] : [])],
    subscribe: (handlers: Parameters<typeof raw.subscribe>[0]) =>
      raw.subscribe({ ...handlers, frame: (from, bytes) => handlers.frame(spoof ? "not-reachable" : from, bytes) }),
  };
  const a = await CollabSession.open({ room: roomFor(107), transport, privacy: {}, initial: demoDiagram(), clock });
  const b = await CollabSession.open({ room: roomFor(107), transport: net.connect(), privacy: {}, clock });
  const settle = () =>
    net.settle(async () => {
      await a.idle();
      await b.idle();
    });
  await settle();
  expect(a.roomStatus).not.toBe("synced");
  lagging = false;
  expect(a.roomStatus).toBe("synced");
  spoof = true;
  a.doc.apply([{ op: "meta", set: { title: "Await authentic reachable peers" } }]);
  await settle();
  expect(a.roomStatus).not.toBe("synced");
  await Promise.all([a.leave(), b.leave()]);
  a.doc.destroy();
  b.doc.destroy();
});

it("two epochs with one number (each side of a partition) keep their own copies: neither reads the other's as corrupt", async () => {
  const store = new Store();
  const lobby = await deriveRoomKeys(roomFor(113));
  const [a, b] = await Promise.all([
    deriveEpochKeys(lobby, 1, newEpochSecret(seededBytes(1131))),
    deriveEpochKeys(lobby, 1, newEpochSecret(seededBytes(1132))),
  ]);
  const docA = new CollabDoc({ clientId: 1131 });
  docA.hydrate({ ...demoDiagram(), title: "Side A" });
  const tabA = new RoomRecovery(store, a, () => {}, Date.now, realClock, `1:${"A".repeat(86)}`);
  tabA.watch(docA);
  await tabA.flush(docA);
  // The other side's tab, on the same device: its own epoch 1, its own secret.
  const docB = new CollabDoc({ clientId: 1132 });
  const tabB = new RoomRecovery(store, b, () => {}, Date.now, realClock, `1:${"B".repeat(86)}`);
  await tabB.restore(docB);
  expect(tabB.problem).toBeUndefined();
  expect(tabB.id).not.toBe(tabA.id);
  // Side A's copy is still there, and still reads back.
  const again = new CollabDoc({ clientId: 1133 });
  await new RoomRecovery(store, a, () => {}, Date.now, realClock, `1:${"A".repeat(86)}`).restore(again);
  expect(again.project().diagram?.title).toBe("Side A");
  // A room before knock-to-join keeps its old record id: its epoch number.
  expect(new RoomRecovery(store, lobby).id).toBe(`${lobby.roomId}:${lobby.epoch}`);
  for (const d of [docA, docB, again]) d.destroy();
});

it("a knock-to-join room's session keeps its copy under its epoch's scope", async () => {
  const net = new MemoryNetwork(),
    clock = new FakeClock(),
    store = new Store();
  const [identity, agreement] = [await newIdentity(), await newAgreement()];
  const room = newRoom(seededBytes(114), identity.key);
  room.knock = true;
  const lobby = await deriveRoomKeys(room);
  const secret = newEpochSecret(seededBytes(1141));
  const start = await signStart(identity, lobby.roomId, {
    epoch: 0,
    kc: await commitEpoch(secret, lobby.roomId, 0),
    x: agreement.x,
  });
  const session = await CollabSession.open({
    room,
    transport: net.connect(),
    privacy: {},
    initial: demoDiagram(),
    clock,
    recovery: store,
    signed: { identity, knock: { agreement, chain: { starts: [start], logs: [] }, secret } },
  });
  await session.leave();
  expect([...store.records.keys()]).toEqual([`${lobby.roomId}:${scopeOf(start)}`]);
  session.doc.destroy();
});

it("every leave caller waits for the same final encrypted save", async () => {
  const net = new MemoryNetwork(),
    clock = new FakeClock(),
    store = new Store();
  const session = await CollabSession.open({
    room: roomFor(108),
    transport: net.connect(),
    privacy: {},
    initial: demoDiagram(),
    clock,
    recovery: store,
  });
  const one = session.leave(),
    two = session.leave();
  expect(two).toBe(one);
  await two;
  expect(store.records.size).toBe(1);
  session.doc.destroy();
});

it("reports a left room without a document as offline", async () => {
  const net = new MemoryNetwork();
  const session = await CollabSession.open({
    room: roomFor(110),
    transport: net.connect(),
    privacy: {},
    clock: new FakeClock(),
  });
  expect(session.roomStatus).toBe("connecting");
  await session.leave();
  expect(session.roomStatus).toBe("offline");
  session.doc.destroy();
});

it("skips decoding its own checkpoint but merges a new external writer token", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(109)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  const apply = vi.spyOn(CollabDoc.prototype, "applyCheckpoint");
  for (let n = 0; n < 8; n++) {
    doc.apply([{ op: "meta", set: { title: `Edit ${n}` } }]);
    await recovery.flush(doc);
  }
  expect(apply).not.toHaveBeenCalled();
  const external = new CollabDoc(),
    other = new RoomRecovery(store, keys);
  await other.restore(external);
  other.watch(external);
  external.apply([{ op: "patch", kind: "nodes", id: "db", set: { label: "External writer" } }]);
  await other.flush(external);
  apply.mockClear();
  doc.apply([{ op: "meta", set: { title: "Local writer" } }]);
  await recovery.flush(doc);
  expect(apply).toHaveBeenCalledTimes(2); // validate the small tail in isolation, then merge into the live room
  expect(doc.project().diagram?.nodes.find((n) => n.id === "db")?.label).toBe("External writer");
  apply.mockRestore();
  await Promise.all([recovery.close(doc), other.close(external)]);
  doc.destroy();
  external.destroy();
});

it("restores after every peer leaves and distinguishes local durability from authenticated sync including deletes", async () => {
  const net = new MemoryNetwork(),
    clock = new FakeClock(),
    storeA = new Store(),
    storeB = new Store();
  const a = await CollabSession.open({
    room: roomFor(104),
    transport: net.connect(),
    privacy: {},
    initial: demoDiagram(),
    clock,
    recovery: storeA,
  });
  await a.recovery!.flush(a.doc);
  expect(a.roomStatus).toBe("saved-device");
  const b = await CollabSession.open({
    room: roomFor(104),
    transport: net.connect(),
    privacy: {},
    clock,
    recovery: storeB,
  });
  const settle = () =>
    net.settle(async () => {
      await a.idle();
      await b.idle();
    });
  await settle();
  expect(a.roomStatus).toBe("synced");
  expect(b.roomStatus).toBe("synced");
  a.doc.apply([{ op: "remove", kind: "nodes", id: "db" }]);
  expect(a.roomStatus).not.toBe("synced");
  await settle();
  expect(a.roomStatus).toBe("synced");
  await Promise.all([a.leave(), b.leave()]);
  a.doc.destroy();
  b.doc.destroy();
  const reopened = await CollabSession.open({
    room: roomFor(104),
    transport: net.connect(),
    privacy: {},
    clock,
    recovery: storeA,
  });
  expect(reopened.hasDocument).toBe(true);
  await reopened.recovery!.flush(reopened.doc);
  expect(reopened.roomStatus).toBe("saved-device");
  expect(reopened.doc.project().diagram?.nodes.find((n) => n.id === "db")).toBeUndefined();
  await reopened.leave();
  reopened.doc.destroy();
});

it("never reads the recovery store or opens a transport for a Private diagram", async () => {
  const store = new Store();
  const read = vi.spyOn(store, "read"),
    net = new MemoryNetwork(),
    transport = net.connect();
  const subscribe = vi.spyOn(transport, "subscribe");
  await expect(
    CollabSession.open({ room: roomFor(105), transport, privacy: { private: true }, recovery: store }),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  transport.close();
});

it("keeps valid encrypted work across a backward system-clock correction", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(120)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  let now = 1000;
  const recovery = new RoomRecovery(
    store,
    keys,
    () => {},
    () => now,
  );
  recovery.watch(doc);
  await recovery.flush(doc);
  await recovery.close(doc);
  now--;
  const copy = new CollabDoc(),
    resumed = new RoomRecovery(
      store,
      keys,
      () => {},
      () => now,
    );
  await resumed.restore(copy);
  expect(copy.stateVector()).toEqual(doc.stateVector());
  expect(resumed.problem).toBeUndefined();
  expect(store.records.has(recovery.id)).toBe(true);
  doc.destroy();
  copy.destroy();
});

it("appends bounded encrypted deltas during sustained editing, compacts periodically, and acknowledges only durable revisions", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(121)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  const encode = vi.spyOn(doc, "encodeDiff"),
    write = vi.spyOn(store, "write"),
    append = vi.spyOn(store, "append"),
    read = vi.spyOn(store, "read");
  const encrypt = vi.spyOn(crypto.subtle, "encrypt");
  onTestFinished(() => {
    encode.mockRestore();
    write.mockRestore();
    append.mockRestore();
    read.mockRestore();
    encrypt.mockRestore();
  });
  for (let i = 0; i < RECOVERY_LIMITS.journalUpdates; i++) {
    doc.apply([{ op: "patch", kind: "nodes", id: "api", set: { label: `Edit ${i}` } }]);
    expect(recovery.saved).toBe(false);
    await recovery.flush(doc);
    expect(recovery.saved).toBe(true);
  }
  expect(encode).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(append).toHaveBeenCalledTimes(RECOVERY_LIMITS.journalUpdates);
  // Only changed structs are encrypted; no full checkpoint sneaks into the append path.
  expect(
    encrypt.mock.calls.every(([, , bytes]) => (bytes as Uint8Array).byteLength < doc.encodeDiff().length / 8),
  ).toBe(true);
  encode.mockClear();
  doc.apply([{ op: "remove", kind: "nodes", id: "db" }]);
  await recovery.flush(doc);
  expect(encode).toHaveBeenCalledTimes(1);
  const record = store.records.get(recovery.id)!;
  expect(record.updates).toBeUndefined();
  const copy = new CollabDoc(),
    resumed = new RoomRecovery(store, keys);
  await resumed.restore(copy);
  expect(copy.stateVector()).toEqual(doc.stateVector());
  expect(await copy.syncProof()).toEqual(await doc.syncProof());
  expect(copy.project().diagram?.nodes.find((n) => n.id === "api")?.label).toBe(
    `Edit ${RECOVERY_LIMITS.journalUpdates - 1}`,
  );
  expect(copy.project().diagram?.nodes.find((n) => n.id === "db")).toBeUndefined();
  await recovery.close(doc);
  doc.destroy();
  copy.destroy();
});

it("invalidates sync when an authenticated peer proves a missed deletion", async () => {
  const net = new MemoryNetwork(),
    clock = new FakeClock();
  const raw = net.connect();
  let drop = false;
  const a = await CollabSession.open({
    room: roomFor(122),
    transport: raw,
    privacy: {},
    initial: demoDiagram(),
    clock,
  });
  const other = net.connect();
  const b = await CollabSession.open({
    room: roomFor(122),
    transport: {
      ...other,
      send: (bytes, to) => {
        if (!drop) other.send(bytes, to);
      },
    },
    privacy: {},
    clock,
  });
  const settle = () =>
    net.settle(async () => {
      await a.idle();
      await b.idle();
    });
  await settle();
  expect(a.roomStatus).toBe("synced");
  const changed = vi.fn();
  a.onChange(changed);
  drop = true;
  b.doc.apply([{ op: "remove", kind: "nodes", id: "db" }]);
  await b.idle(); // the update and its first proof were both lost
  drop = false;
  // A correct authenticated proof, with no corresponding update. No local edit on A invalidated sync.
  const { Sealer, SENDER_ID_BYTES } = await import("./envelope");
  const { frame, DOC } = await import("./protocol");
  const proof = new Sealer(b.keys, new Uint8Array(SENDER_ID_BYTES).fill(9));
  other.send(await proof.seal("doc", frame(DOC.syncProof, await b.doc.syncProof())), raw.self);
  await settle();
  expect(a.roomStatus).not.toBe("synced");
  expect(changed).toHaveBeenCalled();
  expect(a.doc.project().diagram?.nodes.some((n) => n.id === "db")).toBe(true);
  await Promise.all([a.leave(), b.leave()]);
  a.doc.destroy();
  b.doc.destroy();
});

it("merges another tab's encrypted journal without decoding or reading the 5,000-node checkpoint again", async () => {
  const { serviceMesh } = await import("../bench/workloads/mesh");
  const diagram = serviceMesh(5000),
    a = new CollabDoc(),
    b = new CollabDoc();
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(123));
  a.hydrate(diagram);
  const first = new RoomRecovery(store, keys),
    second = new RoomRecovery(store, keys);
  first.watch(a);
  await first.flush(a);
  await second.restore(b);
  second.watch(b);
  await second.flush(b);
  // The newly attached writer first establishes its full base; then both cursors follow that base.
  a.apply([{ op: "meta", set: { title: "Both attached" } }]);
  await first.flush(a);
  const read = vi.spyOn(store, "read"),
    tail = vi.spyOn(store, "tail"),
    encodeA = vi.spyOn(a, "encodeDiff"),
    encodeB = vi.spyOn(b, "encodeDiff");
  onTestFinished(() => {
    read.mockRestore();
    tail.mockRestore();
    encodeA.mockRestore();
    encodeB.mockRestore();
  });
  for (let i = 0; i < 2; i++) {
    a.apply([{ op: "patch", kind: "nodes", id: diagram.nodes[0].id, set: { label: `A ${i}` } }]);
    await first.flush(a);
    b.apply([{ op: "patch", kind: "nodes", id: diagram.nodes[1].id, set: { label: `B ${i}` } }]);
    await second.flush(b);
  }
  a.apply([{ op: "meta", set: { title: "Merge final peer edit" } }]);
  await first.flush(a);
  expect(read).not.toHaveBeenCalled();
  expect(tail).toHaveBeenCalled();
  expect(encodeA).not.toHaveBeenCalled();
  expect(encodeB).not.toHaveBeenCalled();
  expect(a.project().diagram?.nodes[1].label).toBe("B 1");
  expect(b.project().diagram?.nodes[0].label).toBe("A 1");
  await Promise.all([first.close(a), second.close(b)]);
  a.destroy();
  b.destroy();
});

it.each(["fresh", "reattach", "empty"])(
  "crash after every durable write reloads the complete %s base and ordered deltas",
  async (mode) => {
    // Exercise every state transition with bounded work; the production 128-entry cap is tested above.
    const journalLimit = 4;
    const limits = RECOVERY_LIMITS as unknown as { journalUpdates: number };
    const previousJournalLimit = limits.journalUpdates;
    limits.journalUpdates = journalLimit;
    onTestFinished(() => {
      limits.journalUpdates = previousJournalLimit;
    });
    const store = new Store(),
      keys = await deriveRoomKeys(roomFor(124)),
      doc = new CollabDoc();
    if (mode !== "empty") doc.hydrate(demoDiagram());
    if (mode === "reattach") {
      const prior = new RoomRecovery(store, keys);
      prior.watch(doc);
      await prior.close(doc);
      // Includes new structs, deletions and a later dependent edit from the same Yjs client.
      doc.apply([
        { op: "patch", kind: "nodes", id: "api", set: { label: "Before attachment" } },
        { op: "remove", kind: "nodes", id: "db" },
      ]);
    }
    const snapshots: { disk: Map<string, RecoveryRecord>; proof: Uint8Array }[] = [];
    const write = store.write.bind(store);
    vi.spyOn(store, "write").mockImplementation(async (record, expected) => {
      const saved = await write(record, expected);
      if (saved) snapshots.push({ disk: structuredClone(store.records), proof: await doc.syncProof() });
      return saved;
    });
    const recovery = new RoomRecovery(store, keys);
    recovery.watch(doc);
    if (mode === "empty") doc.hydrate(demoDiagram());
    await recovery.flush(doc);
    for (let i = 0; i <= journalLimit; i++) {
      doc.apply([{ op: "patch", kind: "nodes", id: "api", set: { label: `Durable ${i}` } }]);
      await recovery.flush(doc);
      expect(recovery.saved).toBe(true);
    }
    expect(snapshots).toHaveLength(journalLimit + 2);
    expect(snapshots.some(({ disk }) => [...disk.values()][0].updates?.length === journalLimit)).toBe(true);
    // Simulated process death: reload only frozen disk, without close()/a final flush or the live doc.
    for (const { disk, proof } of snapshots) {
      const crashedStore = new Store();
      crashedStore.records = disk;
      const restored = new CollabDoc(),
        reload = new RoomRecovery(crashedStore, keys);
      await reload.restore(restored);
      expect(reload.problem).toBeUndefined();
      expect(await restored.syncProof()).toEqual(proof);
      restored.destroy();
    }
    expect([...snapshots.at(-1)!.disk.values()][0].updates).toBeUndefined();
    await recovery.close(doc);
    doc.destroy();
  },
);

it("bounds pending plaintext while a write stalls or fails, then checkpoints all later edits", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(125)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const clock = new FakeClock(),
    recovery = new RoomRecovery(store, keys, undefined, Date.now, clock);
  recovery.watch(doc);
  await recovery.flush(doc);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const append = vi.spyOn(store, "append").mockImplementationOnce(async () => {
    entered();
    await blocked;
    throw new Error("storage-unavailable");
  });
  doc.apply([{ op: "meta", set: { title: "First pending" } }]);
  await started;
  for (let i = 0; i < 1000; i++) {
    doc.apply([{ op: "meta", set: { title: `${i}:` + "x".repeat(8000) } }]);
    expect(recovery.pendingBytes).toBeLessThanOrEqual(RECOVERY_LIMITS.journalBytes);
  }
  release();
  await recovery.flush(doc);
  expect(recovery.pendingBytes).toBe(0);
  expect(recovery.saved).toBe(false);
  expect(recovery.problem).toBe("unavailable");
  store.fail = true;
  for (let i = 0; i < 3; i++) {
    doc.apply([{ op: "meta", set: { title: `Failed retry ${i}` } }]);
    await recovery.flush(doc);
    expect(recovery.pendingBytes).toBe(0);
  }
  store.fail = false;
  const write = vi.spyOn(store, "write");
  clock.advance(RECOVERY_RETRY.initialMs);
  await recovery.flush(doc);
  expect(write).toHaveBeenCalledTimes(1);
  expect(recovery.saved).toBe(true);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  append.mockRestore();
  write.mockRestore();
  await recovery.close(doc);
  doc.destroy();
  restored.destroy();
});

it("does not acknowledge edits arriving while a required checkpoint is in flight", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(126)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = store.write.bind(store);
  vi.spyOn(store, "write").mockImplementationOnce(async (record, expected) => {
    entered();
    await held;
    return write(record, expected);
  });
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await started;
  doc.apply([{ op: "meta", set: { title: "After checkpoint encode" } }]);
  release();
  await recovery.flush(doc);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(recovery.saved).toBe(true);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  await recovery.close(doc);
  doc.destroy();
  restored.destroy();
});

it.each(["ciphertext", "iv", "schema", "resource", "replacement", "shape", "entries"])(
  "handles a %s external journal tail without poisoning future saves",
  async (fault) => {
    const store = new Store(),
      keys = await deriveRoomKeys(roomFor(127)),
      a = new CollabDoc(),
      b = new CollabDoc();
    a.hydrate(demoDiagram());
    const clock = new FakeClock(),
      first = new RoomRecovery(store, keys, undefined, Date.now, clock),
      second = new RoomRecovery(store, keys);
    first.watch(a);
    await first.flush(a);
    await second.restore(b);
    second.watch(b);
    await second.flush(b);
    a.apply([{ op: "meta", set: { title: "Establish shared cursor" } }]);
    await first.flush(a);
    b.apply([{ op: "patch", kind: "nodes", id: "db", set: { label: "External edit" } }]);
    await second.flush(b);
    const record = store.records.get(first.id)!,
      chunk = record.updates!.at(-1)!;
    const originalUpdates = structuredClone(record.updates!);
    const headBeforeDamage = recoverySummary(record);
    const replacement = structuredClone(record);
    replacement.token = "concurrent-valid-replacement";
    if (fault === "ciphertext" || fault === "replacement") chunk.ciphertext[0] ^= 1;
    if (fault === "iv") chunk.iv = new Uint8Array(3);
    if (fault === "entries")
      record.updates = [
        ...originalUpdates.slice(0, -1),
        ...Array.from({ length: RECOVERY_LIMITS.journalUpdates + 1 }, () => structuredClone(chunk)),
      ];
    if (fault === "shape") {
      (chunk as { ciphertext: unknown }).ciphertext = undefined;
      // IndexedDB stores the head independently of the damaged chunk. Model that metadata here.
      const readHead = store.head.bind(store);
      const head = vi
        .spyOn(store, "head")
        .mockImplementation((id) =>
          store.records.get(id) === record ? Promise.resolve(headBeforeDamage) : readHead(id),
        );
      onTestFinished(() => head.mockRestore());
    }
    const limits = COLLAB_LIMITS as unknown as Record<string, number>;
    const previous = limits.maxCheckpointStructs;
    onTestFinished(() => {
      limits.maxCheckpointStructs = previous;
    });
    if (fault === "resource") limits.maxCheckpointStructs = 0;
    if (fault === "schema") {
      const bad = new Y.Doc();
      bad.getMap("unknown-root").set("x", 1);
      chunk.ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: chunk.iv as BufferSource,
            additionalData: new TextEncoder().encode(`livediagrams/collab/storage/v1/${first.id}`),
          },
          keys.storage,
          Y.encodeStateAsUpdate(bad) as BufferSource,
        ),
      );
      bad.destroy();
    }
    const removeRecord = store.remove.bind(store);
    const remove = vi.spyOn(store, "remove").mockImplementation(async (id, token) => {
        if (fault === "replacement") store.records.set(id, replacement);
        await removeRecord(id, token);
      }),
      tail = vi.spyOn(store, "tail");
    if (fault === "shape")
      tail.mockImplementationOnce((_id, _checkpoint, after) =>
        Promise.resolve({ head: headBeforeDamage, updates: structuredClone(record.updates!.slice(after)) }),
      );
    a.apply([{ op: "patch", kind: "nodes", id: "api", set: { label: "Keep in-memory edit" } }]);
    await first.flush(a);
    expect(tail).toHaveBeenCalled();
    if (fault === "resource" || fault === "entries") {
      expect(remove).not.toHaveBeenCalled();
      expect(store.records.get(first.id)?.token).toBe(record.token);
      expect(first.problem).toBe("unavailable");
      expect(first.saved).toBe(false);
      limits.maxCheckpointStructs = previous;
      if (fault === "entries") record.updates = originalUpdates;
      clock.advance(RECOVERY_RETRY.initialMs);
      await first.flush(a);
    } else {
      expect(remove).toHaveBeenCalledWith(first.id, record.token);
      expect(first.problem).toBe("corrupt");
    }
    expect(first.saved).toBe(true);
    if (fault === "replacement")
      expect(a.project().diagram?.nodes.find((n) => n.id === "db")?.label).toBe("External edit");
    const restored = new CollabDoc();
    await new RoomRecovery(store, keys).restore(restored);
    expect(restored.project().diagram?.nodes.find((n) => n.id === "api")?.label).toBe("Keep in-memory edit");
    expect(await restored.syncProof()).toEqual(await a.syncProof());
    await Promise.all([first.close(a), second.close(b)]);
    a.destroy();
    b.destroy();
    restored.destroy();
  },
);

it("falls back to the last valid checkpoint on a corrupt journal during restore", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(128)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  const proof = await doc.syncProof();
  doc.apply([{ op: "meta", set: { title: "Lost damaged journal" } }]);
  await recovery.close(doc);
  store.records.get(recovery.id)!.updates![0].ciphertext[0] ^= 1;
  const restored = new CollabDoc(),
    reload = new RoomRecovery(store, keys);
  await reload.restore(restored);
  expect(reload.problem).toBe("corrupt");
  expect(reload.saved).toBe(false);
  expect(await restored.syncProof()).toEqual(proof);
  reload.watch(restored);
  await reload.flush(restored);
  expect(reload.saved).toBe(true);
  await reload.close(restored);
  doc.destroy();
  restored.destroy();
});

it.each(["checkpoint", "append"])("backs off failed %s saves while typing and resets after success", async (mode) => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(129)),
    clock = new FakeClock(),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys, undefined, Date.now, clock);
  if (mode === "append") {
    recovery.watch(doc);
    await recovery.flush(doc);
  }
  const encode = vi.spyOn(doc, "encodeDiff"),
    encrypt = vi.spyOn(crypto.subtle, "encrypt");
  onTestFinished(() => {
    encode.mockRestore();
    encrypt.mockRestore();
  });
  store.fail = true;
  if (mode === "checkpoint") recovery.watch(doc);
  else doc.apply([{ op: "meta", set: { title: "Fail append" } }]);
  await recovery.flush(doc);
  let delay: number = RECOVERY_RETRY.initialMs;
  for (let attempt = 0; attempt < 8; attempt++) {
    const encodes = encode.mock.calls.length,
      encrypts = encrypt.mock.calls.length;
    expect(clock.nextDue()).toBe(clock.now() + delay);
    for (let edit = 0; edit < 16; edit++) {
      doc.apply([{ op: "meta", set: { title: `Attempt ${attempt}, edit ${edit}` } }]);
      await recovery.flush(doc);
      expect(recovery.saved).toBe(false);
      expect(recovery.problem).toBe("unavailable");
      expect(recovery.pendingBytes).toBe(0);
    }
    clock.advance(delay - 1);
    await recovery.flush(doc);
    expect(encode).toHaveBeenCalledTimes(encodes);
    expect(encrypt).toHaveBeenCalledTimes(encrypts);
    clock.advance(1);
    await recovery.flush(doc);
    expect(encode).toHaveBeenCalledTimes(encodes + 1);
    expect(encrypt).toHaveBeenCalledTimes(encrypts + 1);
    expect(recovery.saved).toBe(false);
    expect(recovery.problem).toBe("unavailable");
    delay = Math.min(delay * 2, RECOVERY_RETRY.maxMs);
  }
  store.fail = false;
  clock.advance(delay);
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  expect(recovery.problem).toBeUndefined();
  expect(clock.pending).toBe(0);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  store.fail = true;
  doc.apply([{ op: "meta", set: { title: "Failure after recovery" } }]);
  await recovery.flush(doc);
  expect(clock.nextDue()).toBe(clock.now() + RECOVERY_RETRY.initialMs);
  await recovery.close(doc);
  expect(recovery.saved).toBe(false);
  expect(clock.pending).toBe(0);
  doc.destroy();
  restored.destroy();
});

it("drives recovery retries with the session clock and cancels them on leave", async () => {
  const store = new Store(),
    clock = new FakeClock(),
    net = new MemoryNetwork();
  store.fail = true;
  const session = await CollabSession.open({
    room: roomFor(130),
    transport: net.connect(),
    privacy: {},
    initial: demoDiagram(),
    recovery: store,
    clock,
  });
  await session.recovery!.flush(session.doc);
  expect(session.recovery!.saved).toBe(false);
  expect(session.recovery!.problem).toBe("unavailable");
  store.fail = false;
  clock.advance(RECOVERY_RETRY.initialMs);
  await session.recovery!.flush(session.doc);
  expect(session.roomStatus).toBe("saved-device");
  expect(session.recovery!.problem).toBeUndefined();
  store.fail = true;
  session.doc.apply([{ op: "meta", set: { title: "Unsaved on leave" } }]);
  await session.recovery!.flush(session.doc);
  await session.leave();
  expect(session.recovery!.saved).toBe(false);
  expect(clock.pending).toBe(0);
  session.doc.destroy();
});

it("leaving during backoff saves immediately when storage recovers", async () => {
  const store = new Store(),
    clock = new FakeClock(),
    net = new MemoryNetwork();
  store.fail = true;
  const room = roomFor(133);
  const session = await CollabSession.open({
    room,
    transport: net.connect(),
    privacy: {},
    initial: demoDiagram(),
    recovery: store,
    clock,
  });
  await session.recovery!.flush(session.doc);
  expect(clock.nextDue()).toBe(clock.now() + RECOVERY_RETRY.initialMs);
  session.doc.apply([{ op: "meta", set: { title: "Durable before leaving" } }]);
  store.fail = false;
  const entered = barrier(),
    finalWrite = barrier();
  const write = store.write.bind(store);
  const writes = vi.spyOn(store, "write").mockImplementation(async (record, expected) => {
    entered.release();
    await finalWrite.held;
    return write(record, expected);
  });
  let left = false;
  const leaving = session.leave().then(() => {
    left = true;
  });
  try {
    await Promise.race([entered.held, leaving]);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(left).toBe(false);
    expect(session.recovery!.saved).toBe(false);
    expect(clock.now()).toBe(0);
    expect(store.records.size).toBe(0);
  } finally {
    finalWrite.release();
  }
  await leaving;
  expect(session.recovery!.saved).toBe(true);
  const restored = new CollabDoc();
  await new RoomRecovery(store, await deriveRoomKeys(room)).restore(restored);
  expect(await restored.syncProof()).toEqual(await session.doc.syncProof());
  expect(clock.pending).toBe(0);
  const count = writes.mock.calls.length;
  clock.advance(RECOVERY_RETRY.maxMs * 2);
  await session.recovery!.flush(session.doc);
  expect(writes).toHaveBeenCalledTimes(count);
  session.doc.destroy();
  restored.destroy();
});

it("decrypts the checkpoint once during a full recovery read with journal entries", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(131)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  for (let i = 0; i < 2; i++) {
    doc.apply([{ op: "meta", set: { title: `Journal ${i}` } }]);
    await recovery.flush(doc);
  }
  const record = store.records.get(recovery.id)!;
  expect(record.updates).toHaveLength(2);
  const decrypt = vi.spyOn(crypto.subtle, "decrypt");
  onTestFinished(() => decrypt.mockRestore());
  const restored = new CollabDoc(),
    reload = new RoomRecovery(store, keys);
  await reload.restore(restored);
  expect(reload.saved).toBe(true);
  expect(reload.problem).toBeUndefined();
  expect(decrypt).toHaveBeenCalledTimes(1 + record.updates!.length);
  expect(
    decrypt.mock.calls.filter(([, , bytes]) => Buffer.from(bytes as Uint8Array).equals(Buffer.from(record.ciphertext))),
  ).toHaveLength(1);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  await recovery.close(doc);
  doc.destroy();
  restored.destroy();
});

it("appends bounded overlapping edits after a required checkpoint instead of repeatedly encoding it", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(132)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys),
    write = store.write.bind(store);
  let saves = 0;
  vi.spyOn(store, "write").mockImplementation(async (record, expected) => {
    if (++saves <= 10) {
      doc.apply([{ op: "meta", set: { title: `Overlapping ${saves}` } }]);
      expect(recovery.saved).toBe(false);
      expect(recovery.pendingBytes).toBeGreaterThan(0);
      expect(recovery.pendingBytes).toBeLessThanOrEqual(RECOVERY_LIMITS.journalBytes);
    }
    return write(record, expected);
  });
  const encode = vi.spyOn(doc, "encodeDiff"),
    append = vi.spyOn(store, "append");
  recovery.watch(doc);
  await recovery.flush(doc);
  expect(encode).toHaveBeenCalledTimes(1);
  expect(append).toHaveBeenCalledTimes(10);
  expect(recovery.saved).toBe(true);
  expect(recovery.pendingBytes).toBe(0);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  await recovery.close(doc);
  doc.destroy();
  restored.destroy();
});

function barrier() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

it("checkpoints overflowed deltas after a stalled append succeeds", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(133)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await recovery.flush(doc);
  const entered = barrier(),
    blocked = barrier(),
    append = store.append.bind(store);
  vi.spyOn(store, "append").mockImplementationOnce(async (...args) => {
    entered.release();
    await blocked.held;
    return append(...args);
  });
  const encode = vi.spyOn(doc, "encodeDiff");
  doc.apply([{ op: "meta", set: { title: "Stalled append" } }]);
  await entered.held;
  for (let i = 0; i < 40; i++) {
    doc.apply([{ op: "meta", set: { title: `${i}:` + "x".repeat(8000) } }]);
    expect(recovery.pendingBytes).toBeLessThanOrEqual(RECOVERY_LIMITS.journalBytes);
  }
  blocked.release();
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  expect(encode).toHaveBeenCalledTimes(1);
  expect(store.records.get(recovery.id)!.updates).toBeUndefined();
  await recovery.close(doc);
  doc.destroy();
  restored.destroy();
});

it.each(["append", "checkpoint"])("keeps saved false until the latest %s is durable", async (mode) => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(134)),
    doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  const baseProof = await doc.syncProof(),
    first = barrier(),
    second = barrier(),
    releaseFirst = barrier(),
    releaseSecond = barrier(),
    write = store.write.bind(store);
  let writes = 0;
  vi.spyOn(store, "write").mockImplementation(async (record, expected) => {
    writes++;
    if (writes === 1) {
      first.release();
      await releaseFirst.held;
    }
    if (writes === 2) {
      second.release();
      await releaseSecond.held;
    }
    return write(record, expected);
  });
  const recovery = new RoomRecovery(store, keys);
  recovery.watch(doc);
  await first.held;
  for (let i = 0; i < (mode === "checkpoint" ? RECOVERY_LIMITS.journalUpdates + 1 : 1); i++)
    doc.apply([{ op: "meta", set: { title: `After captured base ${i}` } }]);
  expect(recovery.saved).toBe(false);
  releaseFirst.release();
  await second.held;
  const between = new CollabDoc();
  await new RoomRecovery(store, keys).restore(between);
  expect(await between.syncProof()).toEqual(baseProof);
  expect(await between.syncProof()).not.toEqual(await doc.syncProof());
  expect(recovery.saved).toBe(false);
  releaseSecond.release();
  await recovery.flush(doc);
  expect(recovery.saved).toBe(true);
  expect(store.records.get(recovery.id)!.updates?.length ?? 0).toBe(mode === "append" ? 1 : 0);
  const restored = new CollabDoc();
  await new RoomRecovery(store, keys).restore(restored);
  expect(await restored.syncProof()).toEqual(await doc.syncProof());
  await recovery.close(doc);
  for (const d of [doc, between, restored]) d.destroy();
});
