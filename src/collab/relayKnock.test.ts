import { describe, expect, it, onTestFinished, vi } from "vitest";
import { barrier, browserSockets, connect, startServer, type WebSocket } from "../../services/server/test/harness";
import { bytesToBase64Url } from "../interop/codec";
import { FakeClock } from "./clock";
import { commitEpoch, signStart } from "./epochs";
import { deriveRoomKeys, newEpochSecret } from "./keys";
import type { RoomLink } from "./link";
import { seededBytes } from "./random";
import type { KnockMember } from "./session";
import { newAgreement, newIdentity, sign, type Agreement, type Identity } from "./signing";
import { canaryDiagram, openClient, roomFor, type TestClient } from "./transport/conformance";
import { createRelayTransport } from "./transport/relay";
import { clientFrame, parseControl, readServerFrame, RELAY_CLOSE, relayProofBytes } from "./transport/relayProtocol";

// Shared Live P6 end to end: honest pages on a self-hosted relay that enforces knock-to-join, and a deliberately
// modified client beside them. Someone who isn't a member gets nothing of the room (whatever they send), and a member
// removed is cut off at once, in the epoch after a re-key too, whatever their page keeps sending.

interface Person {
  name: string;
  identity: Identity;
  agreement: Agreement;
  client?: TestClient;
}

async function relayRoom(seed: number) {
  const s = await startServer();
  const sockets: WebSocket[] = [];
  const clock = new FakeClock();
  const host: Person = { name: "host", identity: await newIdentity(), agreement: await newAgreement() };
  const link: RoomLink = { ...roomFor(seed), hostKey: host.identity.key, knock: true };
  const lobbyKeys = await deriveRoomKeys(link);
  const secret = newEpochSecret(seededBytes(seed + 1000));
  const start = await signStart(host.identity, lobbyKeys.roomId, {
    epoch: 0,
    kc: await commitEpoch(secret, lobbyKeys.roomId, 0),
    x: host.agreement.x,
  });
  const people: Person[] = [host];
  let opened = 0;
  const transport = () =>
    createRelayTransport({
      url: s.url,
      roomId: lobbyKeys.roomId,
      root: host.identity.key,
      WebSocket: browserSockets(s.origin, sockets),
      random: seededBytes(seed * 100 + ++opened),
    });
  const live = () => people.filter((p) => p.client && p.client.session.status !== "left").map((p) => p.client!);
  /** Ordered round trips on every socket, and every session's queues, until quiet. */
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.all(sockets.map(barrier));
      await Promise.all(live().map((c) => c.session.idle()));
    }
  };
  const open = async (p: Person, member: KnockMember, initial = false) => {
    p.client = await openClient(p.name, transport(), link, clock, 9000 + seed * 100 + ++opened, {
      ...(initial ? { initial: canaryDiagram() } : {}),
      signed: { identity: p.identity, knock: member },
    });
    onTestFinished(() => p.client?.session.leave());
    return p.client;
  };
  await open(host, { agreement: host.agreement, chain: { starts: [start], logs: [] }, secret }, true);
  const join = async (name: string) => {
    const p: Person = { name, identity: await newIdentity(), agreement: await newAgreement() };
    people.push(p);
    const client = await open(p, { agreement: p.agreement, chain: { starts: [], logs: [] } });
    await vi.waitFor(() => expect(host.client!.session.knocks.has(p.identity.key)).toBe(true), { timeout: 5_000 });
    expect(await host.client!.session.admit(p.identity.key)).toBe(true);
    await vi.waitFor(() => expect(client.session.knocking).toBe(false), { timeout: 5_000 });
    await settle();
    return client;
  };
  /** A modified client: a raw socket in the room, speaking for `identity`, sending whatever it likes. */
  const modified = async (identity: Identity) => {
    const c = await connect(s, s.origin);
    sockets.push(c.socket);
    c.socket.send(JSON.stringify({ t: "hello", v: 1, room: lobbyKeys.roomId, root: host.identity.key }));
    await vi.waitFor(() => expect(c.messages.some((m) => !m.binary)).toBe(true));
    const welcome = parseControl(Buffer.from(c.messages.find((m) => !m.binary)!.bytes).toString());
    if (welcome?.t !== "welcome" || !welcome.challenge) throw new Error("no challenge");
    const sig = await sign(
      identity.privateKey,
      relayProofBytes(lobbyKeys.roomId, welcome.challenge, welcome.self, identity.key),
    );
    c.socket.send(JSON.stringify({ t: "prove", key: identity.key, sig: bytesToBase64Url(sig) }));
    const channels = () => c.messages.filter((m) => m.binary).map((m) => readServerFrame(m.bytes)!.envelope[3]);
    /** A frame on a channel, as a modified page would send it: a real envelope header, junk after it. */
    const send = (channel: number) => {
      const envelope = new Uint8Array(80);
      envelope.set([0x4c, 0x44, 1, channel]);
      c.socket.send(clientFrame(envelope));
    };
    return { ...c, channels, send };
  };
  return { s, clock, host, people, settle, join, modified, lobbyKeys };
}

describe("a self-hosted relay enforcing knock-to-join, with honest pages and a modified client (shared Live P6)", () => {
  it("someone who isn't a member gets nothing of the room, whatever they send; members are unaffected", async () => {
    const r = await relayRoom(1);
    const host = r.host.client!;
    const m = await r.join("m");
    const stranger = await r.modified(await newIdentity());
    await r.settle();
    for (const channel of [1, 2, 3]) stranger.send(channel);
    host.edit((d) => ({ ...d, title: "Members only" }));
    m.session.setPresence({ alias: "Moved" });
    await r.settle();
    // Honest pages got none of the stranger's content frames (they'd have refused them, but they never came).
    expect(host.session.stats.rejected["auth-failed"] ?? 0).toBe(0);
    expect(m.session.stats.rejected["auth-failed"] ?? 0).toBe(0);
    // The stranger got nothing but the lobby, while the members edit and move.
    expect(stranger.channels().length).toBeGreaterThan(0);
    expect(new Set(stranger.channels())).toEqual(new Set([4]));
    await vi.waitFor(() => expect(m.session.doc.project().diagram?.title).toBe("Members only"));
  }, 30_000);

  it("a member removed is cut off at once, in the epoch after a re-key too, and what they keep sending goes nowhere", async () => {
    const r = await relayRoom(2);
    const host = r.host.client!;
    const stays = await r.join("stays");
    const goes = await r.join("goes");
    const later = await r.join("later");
    // A modified page speaking as `goes` too: it keeps sending whatever happens.
    const ghost = await r.modified(r.people[2].identity);
    await vi.waitFor(() =>
      expect(ghost.messages.some((m) => !m.binary && Buffer.from(m.bytes).toString().includes('"member":true'))).toBe(
        true,
      ),
    );
    expect(await host.session.remove(goes.session.signed!.key)).toBe(true);
    expect(await ghost.closed).toBe(RELAY_CLOSE.removed);
    await vi.waitFor(() => expect(goes.session.removed).toBe(true), { timeout: 10_000 });
    // After the re-key, a second removal: the relay follows the line.
    const ghost2 = await r.modified(r.people[3].identity);
    await vi.waitFor(() =>
      expect(ghost2.messages.some((m) => !m.binary && Buffer.from(m.bytes).toString().includes('"member":true'))).toBe(
        true,
      ),
    );
    expect(await host.session.remove(later.session.signed!.key)).toBe(true);
    expect(await ghost2.closed).toBe(RELAY_CLOSE.removed);
    // A removed page coming back with its key is at the door: lobby only, whatever it sends.
    const back = await r.modified(r.people[2].identity);
    for (const channel of [1, 2, 3]) back.send(channel);
    host.edit((d) => ({ ...d, title: "After two removals" }));
    await r.settle();
    await vi.waitFor(() => expect(stays.session.doc.project().diagram?.title).toBe("After two removals"));
    expect(stays.session.keys.epoch).toBe(2);
    expect(new Set(back.channels())).toEqual(new Set([4]));
    expect(stays.session.stats.rejected["auth-failed"] ?? 0).toBe(0);
  }, 30_000);
});
