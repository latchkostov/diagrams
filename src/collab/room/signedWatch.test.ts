import { describe, expect, it, onTestFinished, vi } from "vitest";
import { FakeClock } from "../clock";
import type { RoomLink } from "../link";
import { newIdentity } from "../signing";
import { canaryDiagram, openClient, roomFor, type TestClient } from "../transport/conformance";
import { MemoryNetwork } from "../transport/memory";
import type { LiveChannel, LiveMessage } from "./liveShare";
import { RoomRoster } from "./roomRoster";
import { sessionChannel, WatchTogether, type WatchNotices, type WatchRoom } from "./watch";

// A signed room's shared Live (P4): its run's messages count only from its driver (the roster's), whatever anyone
// else sends, and a request's yes is a signed roster entry, not a message anyone could send.

const room: WatchRoom = {
  read: () => ({ documentId: "room-a", eligible: true }),
  show: () => {},
  subscribe: () => () => {},
};
const notices: WatchNotices = { offer: vi.fn(), told: vi.fn() };
const beacon = (tick: number): LiveMessage => ({ t: "beacon", run: "run-1", tick, playing: true, speed: 1, on: true });

async function setUp() {
  const net = new MemoryNetwork({ seed: 41 });
  const clock = new FakeClock();
  const host = await newIdentity();
  const link: RoomLink = { ...roomFor(41), hostKey: host.key };
  const clients: TestClient[] = [];
  const settle = () => net.settle(async () => void (await Promise.all(clients.map((x) => x.session.idle()))));
  const open = async (name: string, seed: number, initial = false) => {
    const c = await openClient(name, net.connect(), link, clock, seed, {
      ...(initial ? { initial: canaryDiagram() } : {}),
      signed: { identity: initial ? host : await newIdentity() },
    });
    clients.push(c);
    onTestFinished(() => c.session.leave());
    await settle();
    return c;
  };
  const a = await open("a", 411, true);
  const b = await open("b", 412);
  const c = await open("c", 413);
  await settle();
  const watch = new WatchTogether(
    c.session,
    new RoomRoster({ member: "0123456789abcdef", hosting: false, cohosts: [] }, () => {}),
    room,
    notices,
  );
  onTestFinished(() => watch.dispose());
  const got: string[] = [];
  (watch as unknown as { channel: LiveChannel }).channel.onMessage((sender, _from, m) =>
    got.push(`${sender === a.session.senderId ? "a" : sender === b.session.senderId ? "b" : "?"}:${m.t}`),
  );
  return { a, b, c, watch, got, settle };
}

describe("a signed room's shared Live", () => {
  it("only the driver's run messages count: anyone else's are ignored by everyone", async () => {
    const { a, b, watch, got, settle } = await setUp();
    expect(watch.getState().hosting).toBe(false);
    sessionChannel(a.session).send(beacon(1));
    sessionChannel(b.session).send(beacon(2));
    // A follower's request for the run counts from anyone.
    sessionChannel(b.session).send({ t: "hello" });
    await settle();
    expect(got).toEqual(["a:beacon", "b:hello"]);
  });

  it("the host lets someone drive (a signed entry): theirs count from then; the last driver's until its handoff", async () => {
    const { a, b, c, got, settle } = await setUp();
    expect(await a.session.appendRoster("drive", { who: b.session.signed!.key })).toBe(true);
    await settle();
    expect(c.session.signed!.state().driver).toBe(b.session.signed!.key);
    sessionChannel(b.session).send(beacon(3));
    // The last driver's last messages, and its handoff, are still on their way.
    sessionChannel(a.session).send(beacon(4));
    sessionChannel(a.session).send({ t: "handoff", run: "run-1", to: b.session.senderId, tick: 4, seq: 0 });
    await settle();
    sessionChannel(a.session).send(beacon(5));
    await settle();
    expect(got).toEqual(["b:beacon", "a:beacon", "a:handoff"]);
  });

  it("a yes, a handover or a roster said in a message changes nothing: only signed entries do", async () => {
    const { a, b, c, watch, settle } = await setUp();
    // b claims the room, and says it may drive.
    sessionChannel(b.session).send({ t: "host", to: c.session.senderId, cohosts: [b.session.senderId] });
    sessionChannel(b.session).send({ t: "answer", to: b.session.senderId, what: "drive", yes: true });
    await settle();
    expect(watch.getState().hosting).toBe(false);
    expect(c.session.signed!.state()).toMatchObject({ host: a.session.signed!.key, cohosts: [], driver: undefined });
    expect(watch.getState().roster.host).toBe(a.session.senderId);
  });
});
