import { expect, it, vi, onTestFinished } from "vitest";
import * as Y from "yjs";
import { COLLAB_LIMITS } from "./limits";
import { CollabDoc } from "./doc";
import { deriveRoomKeys } from "./keys";
import { demoDiagram } from "./lab/demo";
import { RoomRecovery } from "./recovery";
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
import { FakeClock } from "./clock";
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

it("keeps quota-exceeded edits in memory, reports unsaved, and retries on the next save", async () => {
  const store = new Store(),
    keys = await deriveRoomKeys(roomFor(103));
  const doc = new CollabDoc();
  doc.hydrate(demoDiagram());
  store.fail = true;
  const changed = vi.fn(),
    recovery = new RoomRecovery(store, keys, changed);
  recovery.watch(doc);
  await recovery.flush(doc);
  doc.apply([{ op: "meta", set: { title: "Keep this work" } }]);
  await recovery.flush(doc);
  expect(recovery.saved).toBe(false);
  expect(recovery.problem).toBe("unavailable");
  expect(doc.project().diagram?.title).toBe("Keep this work");
  store.fail = false;
  store.contention = true;
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
  expect(apply).toHaveBeenCalledTimes(1); // the external journal tail merges directly into the live room
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
