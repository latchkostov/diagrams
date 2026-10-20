import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../../src/collab/clock";
import { commitEpoch, EpochChain, signStart, type ChainData, type EpochStart } from "../../../src/collab/epochs";
import { newAgreement, newIdentity, sign, type Identity } from "../../../src/collab/signing";
import {
  clientFrame,
  parseControl,
  RELAY_CLOSE,
  relayProofBytes,
  readServerFrame,
} from "../../../src/collab/transport/relayProtocol";
import { bytesToBase64Url } from "../../../src/interop/codec";
import { RoomGuard } from "../src/collab/guard";
import { barrier, connect, startServer, type TestServer } from "./harness";

// Shared Live P6: a self-hosted relay admits only a knock-to-join room's members, from the room's own signed chain,
// gives anyone else the lobby only, and closes a member removed at once (in any epoch since). Signatures only: the
// relay never has a key that opens content.

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("missing");
  return value;
};

/** A knock-to-join room as its host holds it: its chain, and the host's roster moves on it. */
async function knockRoom() {
  const room = bytesToBase64Url(randomBytes(32));
  const host = await newIdentity();
  const chain = new EpochChain(host.key, room);
  const kc = await commitEpoch(randomBytes(32), room, 0);
  let current: EpochStart = await signStart(host, room, { epoch: 0, kc, x: (await newAgreement()).x });
  await chain.addStarts([current]);
  const roster = () => must(chain.rosterOf(current));
  return {
    room,
    host,
    chain,
    data: (): ChainData => chain.data(current),
    async join(id: Identity) {
      expect(await roster().append(host, "join", { who: id.key, x: (await newAgreement()).x })).toBeDefined();
    },
    /** The host removes someone: its removal, and the next epoch's start. */
    async remove(id: Identity) {
      const removal = must(await roster().append(host, "remove", { who: id.key }));
      expect(removal).toBeDefined();
      const epoch = current.epoch + 1;
      const next = await signStart(host, room, {
        epoch,
        kc: await commitEpoch(randomBytes(32), room, epoch),
        prev: removal.sig,
      });
      await chain.addStarts([next]);
      expect(chain.rosterOf(next)).toBeDefined();
      current = next;
    },
  };
}
type Room = Awaited<ReturnType<typeof knockRoom>>;

/** An envelope on a channel (its clear header's byte 3), its body a marker the test can find. */
const envelope = (channel: number, marker: string) => {
  const body = Buffer.from(marker);
  const out = new Uint8Array(32 + body.length);
  out.set([0x4c, 0x44, 1, channel]);
  out.set(body, 32);
  return out;
};

/** A socket in the room: its welcome, what it's told, and what reaches it. */
async function seat(s: TestServer, r: Room, root = r.host.key) {
  const c = await connect(s, s.origin);
  c.socket.send(JSON.stringify({ t: "hello", v: 1, room: r.room, root }));
  await barrier(c.socket);
  await vi.waitFor(() => expect(c.messages.some((m) => !m.binary)).toBe(true));
  const controls = () => c.messages.filter((m) => !m.binary).map((m) => parseControl(Buffer.from(m.bytes).toString()));
  const welcome = controls()[0];
  if (welcome?.t !== "welcome") throw new Error("no welcome");
  const markers = () =>
    c.messages
      .filter((m) => m.binary)
      .map((m) => Buffer.from(must(readServerFrame(m.bytes)).envelope.subarray(32)).toString());
  const status = () =>
    controls()
      .filter((m) => m?.t === "status")
      .at(-1);
  return {
    ...c,
    self: welcome.self,
    challenge: must(welcome.challenge),
    markers,
    status,
    async prove(id: Identity, challenge = must(welcome.challenge)) {
      const sig = await sign(id.privateKey, relayProofBytes(r.room, challenge, welcome.self, id.key));
      c.socket.send(JSON.stringify({ t: "prove", key: id.key, sig: bytesToBase64Url(sig) }));
    },
    push(chain: ChainData = r.data()) {
      c.socket.send(JSON.stringify({ t: "chain", chain }));
    },
    send(channel: number, marker: string) {
      c.socket.send(clientFrame(envelope(channel, marker)));
    },
  };
}
type Seat = Awaited<ReturnType<typeof seat>>;
const admitted = (c: Seat) => vi.waitFor(() => expect(c.status()).toEqual({ t: "status", member: true }));
const told = (c: Seat, member: boolean) => vi.waitFor(() => expect(c.status()).toEqual({ t: "status", member }));
/** Everything sent so far has been through the relay (each socket's own round trip). */
const settle = (...cs: Seat[]) => Promise.all(cs.map((c) => barrier(c.socket)));

describe("a self-hosted relay admits only a knock-to-join room's members (shared Live P6)", () => {
  it("welcomes with a challenge; someone who isn't a member gets and sends only the lobby", async () => {
    const s = await startServer();
    const r = await knockRoom();
    const member = await newIdentity();
    await r.join(member);
    const a = await seat(s, r);
    await a.prove(r.host);
    a.push();
    await admitted(a);
    const b = await seat(s, r);
    await b.prove(member);
    await admitted(b);
    // Someone with only the link: a key of its own, never let in.
    const stranger = await newIdentity();
    const x = await seat(s, r);
    expect(x.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await x.prove(stranger);
    await told(x, false);
    a.send(1, "doc-from-host");
    a.send(2, "presence-from-host");
    a.send(3, "live-from-host");
    a.send(4, "lobby-from-host");
    x.send(1, "doc-from-stranger");
    x.send(3, "live-from-stranger");
    x.send(4, "lobby-from-stranger");
    await settle(a, x, b);
    await settle(a, x, b);
    expect(b.markers()).toEqual([
      "doc-from-host",
      "presence-from-host",
      "live-from-host",
      "lobby-from-host",
      "lobby-from-stranger",
    ]);
    expect(x.markers()).toEqual(["lobby-from-host"]);
    expect(a.markers()).toEqual(["lobby-from-stranger"]);
  });

  it("a socket that hasn't said who it is, or says it with a bad signature, is at the door", async () => {
    const s = await startServer();
    const r = await knockRoom();
    const member = await newIdentity();
    await r.join(member);
    const a = await seat(s, r);
    await a.prove(r.host);
    a.push();
    await admitted(a);
    const silent = await seat(s, r);
    const forged = await seat(s, r);
    // A member's key, signed over someone else's challenge.
    await forged.prove(member, silent.challenge);
    const wrongKey = await seat(s, r);
    const sig = await sign(
      (await newIdentity()).privateKey,
      relayProofBytes(r.room, wrongKey.challenge, wrongKey.self, member.key),
    );
    wrongKey.socket.send(JSON.stringify({ t: "prove", key: member.key, sig: bytesToBase64Url(sig) }));
    a.send(1, "content");
    await settle(a, silent, forged, wrongKey);
    await settle(a, silent, forged, wrongKey);
    for (const c of [silent, forged, wrongKey]) {
      expect(c.markers()).toEqual([]);
      expect(c.status()).toBeUndefined();
    }
  });

  it("someone let in is admitted as soon as the chain that lets them in arrives", async () => {
    const s = await startServer();
    const r = await knockRoom();
    const a = await seat(s, r);
    await a.prove(r.host);
    a.push();
    await admitted(a);
    const newcomer = await newIdentity();
    const k = await seat(s, r);
    await k.prove(newcomer);
    await told(k, false);
    a.send(1, "before");
    await r.join(newcomer);
    a.push();
    await admitted(k);
    a.send(1, "after");
    await settle(a, k);
    await settle(a, k);
    expect(k.markers()).toEqual(["after"]);
  });

  it("a member removed is closed at once, in the epoch after and every one since; the others stay", async () => {
    const s = await startServer({ LD_METRICS: "1" });
    const r = await knockRoom();
    const [m1, m2, m3] = [await newIdentity(), await newIdentity(), await newIdentity()];
    for (const m of [m1, m2, m3]) await r.join(m);
    const a = await seat(s, r);
    await a.prove(r.host);
    a.push();
    await admitted(a);
    const seats = await Promise.all(
      [m1, m2, m3].map(async (m) => {
        const c = await seat(s, r);
        await c.prove(m);
        await admitted(c);
        return c;
      }),
    );
    // Removed, re-keyed: closed.
    await r.remove(m1);
    a.push();
    expect(await seats[0].closed).toBe(RELAY_CLOSE.removed);
    // A later removal, after the re-key: the relay follows the line.
    await r.remove(m2);
    a.push({ starts: r.data().starts.slice(-2), logs: r.data().logs.slice(-2) });
    expect(await seats[1].closed).toBe(RELAY_CLOSE.removed);
    a.send(1, "still here");
    await settle(a, seats[2]);
    await settle(a, seats[2]);
    expect(seats[2].markers()).toContain("still here");
    // Back with the same key (a modified page reconnecting): at the door.
    const back = await seat(s, r);
    await back.prove(m1);
    await told(back, false);
    a.send(1, "after both");
    await settle(a, back);
    await settle(a, back);
    expect(back.markers()).toEqual([]);
    const metrics = (await fetch(`${s.origin}/metrics`).then((res) => res.text())).toString();
    expect(metrics).toContain('refusals_total{reason="removed"} 2');
  });

  it("a hello naming another root, or none, in a knock-to-join room is refused; a room without one is as before", async () => {
    const s = await startServer();
    const r = await knockRoom();
    const a = await seat(s, r);
    await a.prove(r.host);
    const other = await connect(s, s.origin);
    other.socket.send(JSON.stringify({ t: "hello", v: 1, room: r.room, root: (await newIdentity()).key }));
    expect(await other.closed).toBe(RELAY_CLOSE.badFrame);
    const none = await connect(s, s.origin, r.room);
    expect(await none.closed).toBe(RELAY_CLOSE.badFrame);
    // A room without knock-to-join: no challenge, everything forwarded, and a root later isn't taken.
    const plain = bytesToBase64Url(randomBytes(32));
    const p1 = await connect(s, s.origin, plain);
    const p2 = await connect(s, s.origin, plain);
    await settle(p1 as unknown as Seat, p2 as unknown as Seat);
    const welcome = parseControl(Buffer.from(p1.messages[0].bytes).toString());
    expect(welcome?.t === "welcome" && welcome.challenge).toBeUndefined();
    p1.socket.send(clientFrame(envelope(1, "plain")));
    await barrier(p1.socket);
    await barrier(p2.socket);
    expect(p2.messages.some((m) => m.binary)).toBe(true);
    const late = await connect(s, s.origin);
    late.socket.send(JSON.stringify({ t: "hello", v: 1, room: plain, root: r.host.key }));
    expect(await late.closed).toBe(RELAY_CLOSE.badFrame);
  });

  it("a restart loses nothing: sockets say who they are and push the chain again", async () => {
    const r = await knockRoom();
    const member = await newIdentity();
    await r.join(member);
    for (let round = 0; round < 2; round++) {
      const s = await startServer();
      const a = await seat(s, r);
      const b = await seat(s, r);
      await b.prove(member);
      await told(b, false);
      await a.prove(r.host);
      a.push();
      await admitted(a);
      await admitted(b);
      a.send(1, `round ${round}`);
      await settle(a, b);
      await settle(a, b);
      expect(b.markers()).toEqual([`round ${round}`]);
      await s.close();
    }
  });

  it("never logs keys, room ids, chains or content", async () => {
    const s = await startServer();
    const r = await knockRoom();
    const member = await newIdentity();
    await r.join(member);
    const a = await seat(s, r);
    await a.prove(r.host);
    a.push();
    await admitted(a);
    const b = await seat(s, r);
    await b.prove(member);
    await admitted(b);
    const canary = "Synthetic-canary-never-log";
    a.send(1, canary);
    await r.remove(member);
    a.push();
    await b.closed;
    const logs = s.logs.join("\n");
    expect(logs).toContain('"admitted"');
    expect(logs).toContain('"removed"');
    for (const word of [canary, r.room, r.host.key, member.key, r.data().starts[0].sig, "127.0.0.1"])
      expect(logs).not.toContain(word);
    for (const line of s.logs)
      expect(Object.keys(JSON.parse(line)).every((k) => ["event", "code"].includes(k))).toBe(true);
  });
});

describe("the relay's signature checks are budgeted, charged to whoever sent what's checked", () => {
  /** The guard alone, with small budgets: who's told what. */
  async function guarded(limits: { perSocket: number; perRoom: number; windowMs: number }) {
    const r = await knockRoom();
    const clock = new FakeClock();
    const guard = new RoomGuard(r.host.key, r.room, clock, limits);
    const told = new Map<string, boolean[]>();
    const closed = new Map<string, number>();
    const add = (peer: string) => {
      told.set(peer, []);
      return guard.seat(
        peer,
        (code) => closed.set(peer, code),
        (member) => must(told.get(peer)).push(member),
      );
    };
    const prove = async (peer: string, challenge: string, id: Identity) =>
      guard.prove(
        peer,
        id.key,
        bytesToBase64Url(await sign(id.privateKey, relayProofBytes(r.room, challenge, peer, id.key))),
      );
    return { r, clock, guard, told, closed, add, prove };
  }

  it("a socket's push beyond its budget is checked only in part; pushed again in the next window, it completes", async () => {
    const g = await guarded({ perSocket: 4, perRoom: 1000, windowMs: 10_000 });
    const member = await newIdentity();
    for (let i = 0; i < 3; i++) await g.r.join(await newIdentity());
    await g.r.join(member);
    const host = "0000000000000001";
    const m = "0000000000000002";
    await g.prove(host, g.add(host), g.r.host);
    await g.prove(m, g.add(m), member);
    // The host's proof took one check; its push of a start and four entries can't all be checked now.
    await g.guard.push(host, g.r.data());
    expect(g.guard.isMember(m)).toBe(false);
    g.clock.advance(10_000);
    await g.guard.push(host, g.r.data());
    expect(g.guard.isMember(m)).toBe(true);
    expect(g.told.get(m)).toEqual([false, true]);
  });

  it("a socket's pushes are charged to it, not to the others", async () => {
    const g = await guarded({ perSocket: 3, perRoom: 1000, windowMs: 10_000 });
    for (let i = 0; i < 4; i++) await g.r.join(await newIdentity());
    const [pusher, host] = ["00000000000000a1", "00000000000000a2"];
    g.add(pusher);
    const challenge = g.add(host);
    // Someone pushes the chain until its own budget is gone: the host's proof still has all of the host's.
    await g.guard.push(pusher, g.r.data());
    await g.guard.push(pusher, g.r.data());
    await g.prove(host, challenge, g.r.host);
    expect(g.told.get(host)).toEqual([true]);
  });

  it("the room's budget bounds every socket's checks together", async () => {
    const g = await guarded({ perSocket: 1000, perRoom: 3, windowMs: 10_000 });
    for (let i = 0; i < 4; i++) await g.r.join(await newIdentity());
    const [pusher, host] = ["00000000000000b1", "00000000000000b2"];
    g.add(pusher);
    const challenge = g.add(host);
    await g.guard.push(pusher, g.r.data());
    // The room's checks for this window are spent: the proof isn't looked at.
    await g.prove(host, challenge, g.r.host);
    expect(g.told.get(host)).toEqual([]);
    g.clock.advance(10_000);
    const again = "00000000000000b3";
    await g.prove(again, g.add(again), g.r.host);
    expect(g.told.get(again)).toEqual([true]);
  });
});
