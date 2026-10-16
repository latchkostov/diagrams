import { describe, expect, it } from "vitest";
import { bytesToBase64Url, textToBytes } from "../interop/codec";
import { HEADER_BYTES, Opener, Sealer, type Opened } from "./envelope";
import { deriveRoomKeys, newRoom, type RoomKeys } from "./keys";
import { COLLAB_LIMITS } from "./limits";
import { seededBytes } from "./random";
import { ReplayWindow } from "./replay";

const room = { epoch: 0, secret: seededBytes(1)(32) };
const ids = seededBytes(2);
const A = ids(16);
const B = ids(16);
const C = ids(16);

async function pair(r = room) {
  const keys = await deriveRoomKeys(r);
  return { keys, sealer: new Sealer(keys, A), opener: new Opener(keys, B) };
}
const reason = (o: Opened) => (o.ok ? "ok" : o.reason);
const text = (o: Opened) => (o.ok ? new TextDecoder().decode(o.plaintext) : undefined);

describe("room key schedule", () => {
  it("derives a public room id unrelated to the secret, different per room and per epoch", async () => {
    const k0 = await deriveRoomKeys(room);
    const k1 = await deriveRoomKeys({ ...room, epoch: 1 });
    const other = await deriveRoomKeys({ epoch: 0, secret: seededBytes(3)(32) });
    expect(k0.roomId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([k0.roomId, k1.roomId, other.roomId]).size).toBe(3);
    expect(k0.roomId).not.toBe(bytesToBase64Url(room.secret));
    // The tracker's discovery hash is separate from the room id (no transport's name matches another's).
    expect(bytesToBase64Url(k0.discovery)).not.toBe(k0.roomId.slice(0, 27));
    expect(k0.discovery).toHaveLength(20);
  });

  it("is deterministic: everyone with the link derives the same room", async () => {
    expect((await deriveRoomKeys(room)).roomId).toBe(
      (await deriveRoomKeys({ ...room, secret: room.secret.slice() })).roomId,
    );
  });

  it("makes non-extractable keys", async () => {
    const k = await deriveRoomKeys(room);
    expect(k.signal.extractable).toBe(false);
    expect(k.channels.doc.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", k.signal)).rejects.toThrow();
  });

  it("draws a new room's secret from the random source", () => {
    const r = newRoom(seededBytes(9));
    expect(r.epoch).toBe(0);
    expect(r.secret).toHaveLength(32);
  });
});

describe("envelopes", () => {
  it("seals and opens", async () => {
    const { sealer, opener } = await pair();
    const opened = await opener.open(await sealer.seal("doc", textToBytes("hello")));
    expect(text(opened)).toBe("hello");
    expect(opened.ok && opened.counter).toBe(1);
  });

  it("never puts plaintext or the secret on the wire, and never reuses an IV", async () => {
    const { sealer } = await pair();
    const a = await sealer.seal("doc", textToBytes("Zephyrquill"));
    const b = await sealer.seal("doc", textToBytes("Zephyrquill"));
    expect(new TextDecoder("latin1").decode(a)).not.toContain("Zephyrquill");
    expect(bytesToBase64Url(a.subarray(HEADER_BYTES))).not.toBe(bytesToBase64Url(b.subarray(HEADER_BYTES)));
    expect(a.slice(24, 32)).not.toEqual(b.slice(24, 32));
  });

  it("refuses a frame sealed with another room's key", async () => {
    const { sealer } = await pair({ epoch: 0, secret: seededBytes(77)(32) });
    const { opener } = await pair();
    expect(reason(await opener.open(await sealer.seal("doc", textToBytes("x"))))).toBe("auth-failed");
  });

  it("refuses tampered ciphertext, tag, header fields and channel", async () => {
    const { sealer, opener } = await pair();
    const frame = await sealer.seal("doc", textToBytes("payload"));
    const flip = (i: number) => {
      const f = frame.slice();
      f[i] ^= 1;
      return f;
    };
    expect(reason(await opener.open(flip(frame.length - 1)))).toBe("auth-failed"); // tag
    expect(reason(await opener.open(flip(HEADER_BYTES)))).toBe("auth-failed"); // ciphertext
    expect(reason(await opener.open(flip(10)))).toBe("auth-failed"); // sender id (another subkey)
    expect(reason(await opener.open(flip(30)))).toBe("auth-failed"); // counter (another IV)
    const small = await sealer.seal("doc", textToBytes("x"));
    const relabelled = small.slice();
    relabelled[3] = 2;
    expect(reason(await opener.open(relabelled))).toBe("auth-failed");
    // The genuine frame still opens afterwards: failures don't burn its counter.
    expect(reason(await opener.open(frame))).toBe("ok");
  });

  it("refuses a frame bound to another room id (same keys, different additional data)", async () => {
    const keys = await deriveRoomKeys(room);
    const sealer = new Sealer({ ...keys, roomIdBytes: new Uint8Array(32) } as RoomKeys, A);
    const opener = new Opener(keys, B);
    expect(reason(await opener.open(await sealer.seal("doc", textToBytes("x"))))).toBe("auth-failed");
  });

  it("refuses replays and accepts reordering within the window", async () => {
    const { sealer, opener } = await pair();
    const f1 = await sealer.seal("doc", textToBytes("1"));
    const f2 = await sealer.seal("doc", textToBytes("2"));
    const f3 = await sealer.seal("doc", textToBytes("3"));
    expect(reason(await opener.open(f3))).toBe("ok");
    expect(reason(await opener.open(f1))).toBe("ok");
    expect(reason(await opener.open(f1))).toBe("replay");
    expect(reason(await opener.open(f3))).toBe("replay");
    expect(reason(await opener.open(f2))).toBe("ok");
  });

  it("refuses counters older than the replay window", async () => {
    const { sealer, opener } = await pair();
    const first = await sealer.seal("presence", textToBytes("p"));
    // Skip ahead a window's worth of counters (sealing a thousand frames only to throw them away is slow).
    (sealer as unknown as { counters: Record<string, number> }).counters.presence += COLLAB_LIMITS.replayWindow;
    expect(reason(await opener.open(await sealer.seal("presence", textToBytes("p"))))).toBe("ok");
    expect(reason(await opener.open(first))).toBe("stale");
  });

  it("refuses an old key epoch, and a newer one, before decrypting", async () => {
    const old = await pair({ ...room, epoch: 3 });
    const current = await pair({ ...room, epoch: 4 });
    expect(reason(await current.opener.open(await old.sealer.seal("doc", textToBytes("x"))))).toBe("old-epoch");
    const future = await pair({ ...room, epoch: 5 });
    expect(reason(await current.opener.open(await future.sealer.seal("doc", textToBytes("x"))))).toBe("future-epoch");
  });

  it("refuses an old-epoch frame relabelled with the current epoch (the epoch is in the key schedule)", async () => {
    const old = await pair({ ...room, epoch: 3 });
    const current = await pair({ ...room, epoch: 4 });
    const f = await old.sealer.seal("doc", textToBytes("x"));
    new DataView(f.buffer).setUint32(4, 4);
    expect(reason(await current.opener.open(f))).toBe("auth-failed");
  });

  it("refuses its own frames reflected back", async () => {
    const keys = await deriveRoomKeys(room);
    const me = new Sealer(keys, A);
    expect(reason(await new Opener(keys, A).open(await me.seal("doc", textToBytes("x"))))).toBe("reflected");
  });

  it.each([
    ["too short", new Uint8Array(10), "too-short"],
    ["bad magic", new Uint8Array(64), "bad-magic"],
  ])("refuses %s", async (_n, frame, expected) => {
    const { opener } = await pair();
    expect(reason(await opener.open(frame))).toBe(expected);
  });

  it("checks size before decrypting: an oversized presence frame is refused unread", async () => {
    const { opener } = await pair();
    const f = new Uint8Array(COLLAB_LIMITS.maxPresenceFrameBytes + 1);
    f.set([0x4c, 0x44, 1, 2]);
    expect(reason(await opener.open(f))).toBe("too-large");
  });

  it("caps the senders it tracks, and only authenticated ones count", async () => {
    const keys = await deriveRoomKeys(room);
    const opener = new Opener(keys, B);
    const forger = new Sealer(await deriveRoomKeys({ epoch: 0, secret: seededBytes(5)(32) }), C);
    // Forgeries under fresh sender ids never occupy a slot.
    for (let i = 0; i < 100; i++) {
      const f = await forger.seal("presence", textToBytes("x"));
      f.set(seededBytes(1000 + i)(16), 8);
      expect(reason(await opener.open(f))).toBe("auth-failed");
    }
    expect(opener.senderCount).toBe(0);
    const genuine = seededBytes(3);
    for (let i = 0; i < COLLAB_LIMITS.maxSenders; i++)
      expect(reason(await opener.open(await new Sealer(keys, genuine(16)).seal("presence", textToBytes("x"))))).toBe(
        "ok",
      );
    expect(reason(await opener.open(await new Sealer(keys, genuine(16)).seal("presence", textToBytes("x"))))).toBe(
      "too-many-senders",
    );
  });

  it("refuses to seal a frame past its channel's size", async () => {
    const { sealer } = await pair();
    await expect(sealer.seal("presence", new Uint8Array(COLLAB_LIMITS.maxPresenceFrameBytes))).rejects.toThrow(
      /too large/,
    );
  });
});

describe("ReplayWindow", () => {
  it("accepts each counter once, in any order within the window", () => {
    const w = new ReplayWindow(64);
    for (const c of [5, 1, 3, 70, 7, 69, 64]) {
      expect(w.check(c), String(c)).toBe("ok");
      w.accept(c);
    }
    for (const c of [70, 69, 64, 7]) expect(w.check(c)).toBe("replay");
    expect(w.check(5)).toBe("stale"); // 70 - 5 = 65: outside
    expect(w.check(6)).toBe("stale"); // 70 - 6 = 64: outside
    expect(w.check(8)).toBe("ok");
    expect(w.check(0)).toBe("invalid");
    expect(w.check(1.5)).toBe("invalid");
  });

  it("shifts correctly across word boundaries", () => {
    const w = new ReplayWindow(96);
    const seen = new Set<number>();
    const rnd = seededBytes(11);
    let max = 0;
    for (let i = 0; i < 2_000; i++) {
      const c = Math.max(1, max + (rnd(1)[0] % 40) - 20);
      const expected = c <= max - 96 ? "stale" : seen.has(c) ? "replay" : "ok";
      expect(w.check(c)).toBe(expected);
      if (expected === "ok") {
        w.accept(c);
        seen.add(c);
        max = Math.max(max, c);
      }
    }
  });
});
