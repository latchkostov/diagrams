import { randomBytes } from "node:crypto";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { FakeClock } from "../../../src/collab/clock";
import {
  commitEpoch,
  EpochChain,
  scopeOf,
  signStart,
  type ChainData,
  type EpochStart,
} from "../../../src/collab/epochs";
import { signEntry } from "../../../src/collab/roster";
import { createRelayTransport } from "../../../src/collab/transport/relay";
import { newAgreement, newIdentity, sign, type Identity } from "../../../src/collab/signing";
import {
  clientFrame,
  parseControl,
  RELAY_CLOSE,
  relayProofBytes,
  readServerFrame,
} from "../../../src/collab/transport/relayProtocol";
import { bytesToBase64Url } from "../../../src/interop/codec";
import { barrier, browserSockets, connect, startServer, type TestServer, type WebSocket } from "./harness";

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

let pushes = 0;

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
      c.socket.send(JSON.stringify({ t: "chain", id: pushes++, chain }));
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

/** A page on the relay through the real transport: its admission as a session gives it, from the room `r` it holds. */
function page(s: TestServer, r: Room, id: Identity, clock: FakeClock, sockets: WebSocket[]) {
  const transport = createRelayTransport({
    url: s.url,
    roomId: r.room,
    root: r.host.key,
    WebSocket: browserSockets(s.origin, sockets),
    clock,
    random: () => new Uint8Array([0, 0, 0, 0]),
  });
  onTestFinished(() => transport.close());
  const listeners = new Set<() => void>();
  const frames: string[] = [];
  transport.subscribe({ join: () => {}, leave: () => {}, frame: (_from, bytes) => void frames.push(marker(bytes)) });
  transport.authorize?.({
    prove: async (challenge, peer) => ({
      key: id.key,
      sig: bytesToBase64Url(await sign(id.privateKey, relayProofBytes(r.room, challenge, peer, id.key))),
    }),
    chain: (from) => {
      const data = r.data();
      const keep = data.starts
        .map((st, i) => [st, data.logs[i]] as const)
        .filter(([st]) => from === undefined || st.epoch >= from);
      return { starts: keep.map(([st]) => st), logs: keep.map(([, log]) => log) };
    },
    tip: () => {
      const data = r.data();
      return { epoch: data.starts.length - 1, entries: data.logs.at(-1)?.entries.length ?? 0 };
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
  return { transport, frames, changed: () => listeners.forEach((fn) => fn()) };
}
const marker = (bytes: Uint8Array) => Buffer.from(bytes.subarray(32)).toString();
/** Advances the relay's and the pages' clock a second at a time, letting sockets and checks catch up. */
async function run(clock: FakeClock, ms: number, sockets: WebSocket[]) {
  for (let t = 0; t < ms; t += 1_000) {
    clock.advance(1_000);
    await Promise.all(sockets.map(barrier));
  }
}
/** Each server socket's close code, as it closes. */
function closes(s: TestServer) {
  const codes: number[] = [];
  s.wss.on("connection", (ws: WebSocket) => ws.on("close", (code: number) => codes.push(code)));
  return codes;
}

describe("admission recovers from the relay's budgets and queue, through the real transport", () => {
  it("retries a throttled admission proof after budget refill", async () => {
    const clock = new FakeClock();
    // The room's checks: the host's proof, its start and the member's join. The member's proof doesn't fit.
    const s = await startServer({ LD_VERIFY_PER_ROOM: "3" }, clock);
    const r = await knockRoom();
    const member = await newIdentity();
    await r.join(member);
    const sockets: WebSocket[] = [];
    const host = page(s, r, r.host, clock, sockets);
    await vi.waitFor(() => expect(s.rooms.get(r.room)?.guard?.members).toBe(1));
    const m = page(s, r, member, clock, sockets);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    await run(clock, 2_000, sockets);
    expect(s.rooms.get(r.room)?.guard?.members).toBe(1);
    // The budget refills; the same socket's proof is sent again, and counts.
    await run(clock, 12_000, sockets);
    await vi.waitFor(() => expect(s.rooms.get(r.room)?.guard?.members).toBe(2));
    expect(sockets).toHaveLength(2);
    host.transport.send(envelope(1, "for the member"));
    await vi.waitFor(() => expect(m.frames).toContain("for the member"));
  });

  it("finishes restoring the chain after its sender is admitted", async () => {
    const clock = new FakeClock();
    // A socket's checks: the host's proof, the start and one entry; the chain has three.
    const s = await startServer({ LD_VERIFY_PER_SOCKET: "3" }, clock);
    const r = await knockRoom();
    const members = [await newIdentity(), await newIdentity(), await newIdentity()];
    for (const m of members) await r.join(m);
    const sockets: WebSocket[] = [];
    page(s, r, r.host, clock, sockets);
    // The host is admitted (it's the room's host from the start), its chain only partly checked.
    await vi.waitFor(() => expect(s.rooms.get(r.room)?.guard?.members).toBe(1));
    const last = page(s, r, members[2], clock, sockets);
    await run(clock, 2_000, sockets);
    expect(s.rooms.get(r.room)?.guard?.members).toBe(1);
    // Nobody pushes by hand: the host's page finishes on its own as its budget refills.
    await run(clock, 25_000, sockets);
    await vi.waitFor(() => expect(s.rooms.get(r.room)?.guard?.members).toBe(2));
    expect(last.frames).toEqual([]);
  });

  it("a removal dropped by an exhausted verification budget is retried and closes the removed socket (4010)", async () => {
    const clock = new FakeClock();
    const s = await startServer({ LD_VERIFY_PER_ROOM: "40" }, clock);
    const codes = closes(s);
    const r = await knockRoom();
    const member = await newIdentity();
    await r.join(member);
    const sockets: WebSocket[] = [];
    const host = page(s, r, r.host, clock, sockets);
    page(s, r, member, clock, sockets);
    await vi.waitFor(() => expect(s.rooms.get(r.room)?.guard?.members).toBe(2));
    // Someone at the door spends the room's checks on entries that never count.
    const stranger = await seat(s, r);
    const junk = await Promise.all(
      Array.from({ length: 60 }, async () =>
        signEntry(await newIdentity(), r.room, scopeOf(r.data().starts[0]), {
          n: 1,
          op: "admit",
          who: member.key,
          deps: [],
        }),
      ),
    );
    stranger.push({ starts: [], logs: [{ scope: scopeOf(r.data().starts[0]), entries: junk }] });
    await settle(stranger);
    // The host removes the member: its push can't be checked now; the member's still in.
    await r.remove(member);
    host.changed();
    await run(clock, 3_000, sockets);
    expect(codes).not.toContain(RELAY_CLOSE.removed);
    expect(s.rooms.get(r.room)?.guard?.members).toBe(2);
    // The budget refills: the removal's pushed again, and the member's socket is closed at once.
    await run(clock, 20_000, sockets);
    await vi.waitFor(() => expect(codes).toContain(RELAY_CLOSE.removed));
    expect(s.rooms.get(r.room)?.guard?.members).toBe(1);
  });

  it("the queue is bounded: blocked work and many large pushes stay within it, and leaving cancels what's queued", async () => {
    const s = await startServer({ LD_ADMISSION_JOBS: "2", LD_ADMISSION_BYTES: "300000" });
    const r = await knockRoom();
    const a = await seat(s, r);
    const guard = () => {
      const g = s.rooms.get(r.room)?.guard;
      if (!g) throw new Error("no guard");
      return g;
    };
    // The first job blocks (its chain's being checked).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const add = EpochChain.prototype.add;
    const spy = vi.spyOn(EpochChain.prototype, "add").mockImplementation(async function (
      this: EpochChain,
      ...args: Parameters<EpochChain["add"]>
    ) {
      await gate;
      return add.apply(this, args);
    });
    onTestFinished(() => spy.mockRestore());
    try {
      a.push();
      // Large pushes (100 KB each), far more than the queue holds.
      const big = { starts: [], logs: [{ scope: "0:x", entries: ["y".repeat(100_000)] }] };
      for (let i = 0; i < 20; i++) a.push(big);
      await settle(a);
      const load = guard().load();
      expect(load.jobs).toBeLessThanOrEqual(2);
      expect(load.bytes).toBeLessThanOrEqual(300_000);
      // The excess was answered: send it again.
      const acks = a.messages
        .filter((m) => !m.binary)
        .map((m) => parseControl(Buffer.from(m.bytes).toString()))
        .filter((m) => m?.t === "chainAck");
      expect(acks.length).toBeGreaterThanOrEqual(18);
      expect(acks.every((m) => m?.t === "chainAck" && !m.complete)).toBe(true);
      // A second socket in the room keeps its own share of the room's queue.
      const b = await seat(s, r);
      b.push(big);
      await settle(b);
      expect(guard().load(b.self).jobs).toBe(1);
      // The first socket goes: its queued work goes with it.
      a.socket.close();
      await a.closed;
      expect(guard().load(a.self)).toEqual({ jobs: 0, bytes: 0 });
      expect(guard().load().jobs).toBeLessThanOrEqual(2);
    } finally {
      release();
    }
    await vi.waitFor(() => expect(guard().load()).toEqual({ jobs: 0, bytes: 0 }));
  });
});
