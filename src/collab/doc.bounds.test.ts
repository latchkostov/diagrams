import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import * as Y from "yjs";
import { opGrowth, ops } from "../test/opCounter";
import { CollabDoc, type RemoteProblem } from "./doc";
import { COLLAB_LIMITS } from "./limits";
import { metaOf } from "./schema";

const originalLimits = { maxMessageBytes: COLLAB_LIMITS.maxMessageBytes, maxSenders: COLLAB_LIMITS.maxSenders };
afterEach(() => Object.assign(COLLAB_LIMITS, originalLimits));

function boundedRoom() {
  const limits = COLLAB_LIMITS as unknown as Record<string, number>;
  limits.maxMessageBytes = 1024;
  const doc = new CollabDoc({ clientId: 1 });
  onTestFinished(() => doc.destroy());
  return doc;
}

function updates(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const source = new Y.Doc();
    source.clientID = i + 100;
    metaOf(source).set(`field${i}`, "x".repeat(180));
    const update = Y.encodeStateAsUpdate(source);
    source.destroy();
    return update;
  });
}

it.each([false, true])("bounds accumulated room state, including pending structs (pending=%s)", (pending) => {
  const doc = boundedRoom();
  const input = pending ? pendingUpdates(64) : updates(64);
  let refused: RemoteProblem | undefined;
  const work = ops(() => {
    for (const update of input) {
      const result = doc.applyRemote(update, "editor");
      if (!result.ok) refused = result.problem;
    }
  }, input.length * 2000);
  expect(work).toBeGreaterThan(0);
  expect(refused).toBe("peer-full");
  expect(doc.encodeDiff().length).toBeLessThanOrEqual(COLLAB_LIMITS.maxMessageBytes);
  const before = doc.encodeDiff();
  expect(doc.applyRemote(input.at(-1)!, "editor")).toEqual({ ok: false, problem: "peer-full" });
  expect(doc.encodeDiff()).toEqual(before);
});

function pendingUpdates(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const source = new Y.Doc();
    source.clientID = i + 100;
    metaOf(source).set("missing", 1);
    const sv = Y.encodeStateVector(source);
    metaOf(source).set("waiting", "x".repeat(180));
    const update = Y.encodeStateAsUpdate(source, sv);
    source.destroy();
    return update;
  });
}

it("bounds total state across editors and does linear work on further rejected updates", () => {
  const input = updates(512);
  const run = (count: number) => {
    const doc = boundedRoom();
    let refused: RemoteProblem | undefined;
    for (let i = 0; i < count; i++) {
      const result = doc.applyRemote(input[i], `editor${i % 4}`);
      if (!result.ok) refused = result.problem;
    }
    expect(refused).toBe("room-full");
    expect(doc.encodeDiff().length).toBeLessThanOrEqual(2 * COLLAB_LIMITS.maxMessageBytes);
  };
  expect(
    opGrowth(
      () => run(64),
      () => run(512),
    ),
  ).toBeLessThan(24);
});

it("bounds sender bookkeeping rather than letting fresh sender identities bypass the room cap", () => {
  const doc = boundedRoom();
  (COLLAB_LIMITS as unknown as Record<string, number>).maxSenders = 4;
  const input = updates(5);
  for (let i = 0; i < 4; i++) expect(doc.applyRemote(input[i], `editor${i}`).ok).toBe(true);
  const before = doc.encodeDiff();
  expect(
    ops(() => expect(doc.applyRemote(input[4], "extra")).toEqual({ ok: false, problem: "too-many-peers" })),
  ).toBeGreaterThan(0);
  expect(doc.encodeDiff()).toEqual(before);
});

// One struct identity, but a fresh unresolved cross-client origin on every delivery.
function conflictingPendingUpdates(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const encoder = new Y.UpdateEncoderV1();
    // V1 envelope: one client, one struct, client 100, starting clock 0.
    const header = [1, 1, 100, 0];
    const item = new Y.Item(
      Y.createID(100, 0),
      null,
      Y.createID(i + 1000, 0),
      null,
      null,
      null,
      "title",
      new Y.ContentAny(["x"]),
    );
    item.write(encoder, 0);
    return Uint8Array.from([...header, ...encoder.toUint8Array(), 0]);
  });
}

it("bounds missing dependencies when repeated pending structs deduplicate", () => {
  const input = conflictingPendingUpdates(512);
  const run = (count: number) => {
    const doc = boundedRoom();
    expect(doc.applyRemote(input[0], "editor")).toEqual({ ok: true });
    const missing = doc.ydoc.store.pendingStructs!.missing;
    const iterate = missing[Symbol.iterator].bind(missing);
    let scanned = 0;
    const spy = vi.spyOn(missing, Symbol.iterator).mockImplementation(function* () {
      for (const entry of iterate()) {
        scanned++;
        yield entry;
      }
      return undefined;
    });
    let refused = 0;
    const work = ops(() => {
      for (const update of input.slice(1, count)) {
        if (!doc.applyRemote(update, "editor").ok) refused++;
      }
    });
    spy.mockRestore();
    expect(refused).toBeGreaterThan(0);
    // Serialized state stays tiny even when the missing-dependency map leaks.
    expect(doc.encodeDiff().length + missing.size * 16).toBeLessThanOrEqual(COLLAB_LIMITS.maxMessageBytes);
    const size = missing.size;
    expect(doc.applyRemote(input.at(-1)!, "editor")).toEqual({ ok: false, problem: "peer-full" });
    expect(missing.size).toBe(size);
    return work + scanned;
  };
  const small = run(64);
  expect(run(512) / small).toBeLessThan(24);
});

it.each([false, true])("retains the aggregate room cap across sender epochs (pending=%s)", (pending) => {
  const doc = boundedRoom();
  const input = pending ? conflictingPendingUpdates(64) : updates(64);
  let refused = 0;
  for (const [i, update] of input.entries()) {
    doc.restartSenders();
    const result = doc.applyRemote(update, `epoch-${i}`);
    if (!result.ok) {
      expect(result.problem).toBe("room-full");
      refused++;
    }
  }
  expect(refused).toBeGreaterThan(0);
  expect(doc.encodeDiff().length + (doc.ydoc.store.pendingStructs?.missing.size ?? 0) * 16).toBeLessThanOrEqual(
    2 * COLLAB_LIMITS.maxMessageBytes,
  );
});

it("preserves normal edits, garbage collection and duplicate sync replies", () => {
  const doc = boundedRoom();
  const source = new Y.Doc();
  source.clientID = 100;
  onTestFinished(() => source.destroy());
  const input: Uint8Array[] = [];
  source.on("update", (update: Uint8Array) => input.push(update));
  for (let i = 0; i < 100; i++) metaOf(source).set("title", `${i}: ${"a".repeat(180)}`);
  for (const update of input) expect(doc.applyRemote(update, "editor")).toEqual({ ok: true });
  const snapshot = Y.encodeStateAsUpdate(source);
  for (let i = 0; i < 64; i++) expect(doc.applyRemote(snapshot, "editor")).toEqual({ ok: true });
  expect(metaOf(doc.ydoc).get("title")).toBe(`99: ${"a".repeat(180)}`);
  expect(doc.encodeDiff()).toEqual(snapshot);
  expect(doc.stats.remoteRefused).toBe(0);
  const restored = boundedRoom();
  expect(restored.applyCheckpoint(snapshot)).toEqual({ ok: true });
  expect(restored.encodeDiff()).toEqual(snapshot);
});
