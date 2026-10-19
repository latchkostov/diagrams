import { describe, expect, it, onTestFinished, vi } from "vitest";
import { FakeClock } from "../clock";
import type { RoomLink } from "../link";
import { newIdentity } from "../signing";
import { canaryDiagram, openClient, roomFor, type TestClient } from "../transport/conformance";
import { MemoryNetwork } from "../transport/memory";
import { HANDOFF_MS, type LiveChannel, type LiveMessage } from "./liveShare";
import { RoomRoster } from "./roomRoster";
import { sessionChannel, WatchTogether, type WatchNotices, type WatchRoom } from "./watch";

// A signed room's shared Live (P4): its run's messages count only from its driver (the roster's), whatever anyone
// else sends; a handoff never grants the run (only a signed drive entry does); and a request's yes is a signed roster
// entry, not a message anyone could send.

const room: WatchRoom = {
  read: () => ({ documentId: "room-a", eligible: true }),
  show: () => {},
  subscribe: () => () => {},
};
const notices: WatchNotices = { offer: vi.fn(), told: vi.fn() };
const beacon = (tick: number): LiveMessage => ({ t: "beacon", run: "run-1", tick, playing: true, speed: 1, on: true });
const handoff = (to: TestClient, tick: number): LiveMessage => ({
  t: "handoff",
  run: "run-1",
  to: to.session.senderId,
  tick,
  seq: 0,
});
const showing = { live: { run: "run-1", title: "Black Friday", playing: true } };

async function setUp(seed: number) {
  const net = new MemoryNetwork({ seed });
  const clock = new FakeClock();
  const host = await newIdentity();
  const link: RoomLink = { ...roomFor(seed), hostKey: host.key };
  const clients: TestClient[] = [];
  const settle = () => net.settle(async () => void (await Promise.all(clients.map((x) => x.session.idle()))));
  const open = async (name: string, s: number, initial = false) => {
    const c = await openClient(name, net.connect(), link, clock, s, {
      ...(initial ? { initial: canaryDiagram() } : {}),
      signed: { identity: initial ? host : await newIdentity() },
    });
    clients.push(c);
    onTestFinished(() => c.session.leave());
    await settle();
    return c;
  };
  const a = await open("a", seed * 10 + 1, true);
  const b = await open("b", seed * 10 + 2);
  const c = await open("c", seed * 10 + 3);
  const d = await open("d", seed * 10 + 4);
  await settle();
  const watch = new WatchTogether(
    c.session,
    new RoomRoster({ member: "0123456789abcdef", hosting: false, cohosts: [] }, () => {}),
    room,
    notices,
  );
  onTestFinished(() => watch.dispose());
  const got: string[] = [];
  const name = (sender: string) => clients.find((x) => x.session.senderId === sender)?.name ?? "?";
  (watch as unknown as { channel: LiveChannel }).channel.onMessage((sender, _from, m) =>
    got.push(`${name(sender)}:${m.t}${"tick" in m ? m.tick : ""}`),
  );
  const send = (from: TestClient, m: LiveMessage) => sessionChannel(from.session).send(m);
  /** One sender's messages, in the order they came. */
  const from = (who: string) => got.filter((g) => g.startsWith(`${who}:`));
  return { a, b, c, d, watch, got, from, send, settle };
}

describe("a signed room's shared Live", () => {
  it("only the driver's run messages count: anyone else's are ignored by everyone", async () => {
    const { a, b, watch, got, send, settle } = await setUp(41);
    expect(watch.getState().hosting).toBe(false);
    send(a, beacon(1));
    send(b, beacon(2));
    // A follower's request for the run counts from anyone.
    send(b, { t: "hello" });
    await settle();
    expect([...got].sort()).toEqual(["a:beacon1", "b:hello"]);
  });

  it("the host lets someone drive (a signed entry): theirs count from then; the last driver's until its handoff", async () => {
    const { a, b, c, from, send, settle } = await setUp(42);
    a.session.setPresence(showing);
    await settle();
    expect(await a.session.appendRoster("drive", { who: b.session.signed!.key })).toBe(true);
    await settle();
    expect(c.session.signed!.state().driver).toBe(b.session.signed!.key);
    send(b, beacon(3));
    // The last driver's last messages for its run, and its handoff, are still on their way.
    send(a, beacon(4));
    send(a, handoff(b, 4));
    await settle();
    send(a, beacon(5));
    await settle();
    expect(from("b")).toEqual(["b:beacon3"]);
    expect(from("a")).toEqual(["a:beacon4", "a:handoff4"]);
  });

  it("an early handoff waits for the grant that names its driver, then counts", async () => {
    const { a, b, from, send, settle } = await setUp(43);
    a.session.setPresence(showing);
    await settle();
    // The host hands the run over before signing the grant: held, not taken.
    send(a, handoff(b, 7));
    await settle();
    expect(from("a")).toEqual([]);
    expect(await a.session.appendRoster("drive", { who: b.session.signed!.key })).toBe(true);
    await settle();
    expect(from("a")).toEqual(["a:handoff7"]);
  });

  it("a handoff to someone the roster doesn't name as driver grants them nothing", async () => {
    const { a, b, d, from, send, settle } = await setUp(44);
    expect(await a.session.appendRoster("drive", { who: b.session.signed!.key })).toBe(true);
    b.session.setPresence(showing);
    await settle();
    // The driver (not a host or co-host) hands the run to d, whom no grant names.
    send(b, handoff(d, 3));
    await settle();
    send(d, beacon(4));
    await settle();
    expect(from("d")).toEqual([]);
    expect(from("b")).toEqual([]);
  });

  it("alternating handoffs never renew the last driver's moment: past it, its messages are ignored", async () => {
    const { a, b, d, from, send, settle } = await setUp(45);
    let now = 1_000_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    onTestFinished(() => clock.mockRestore());
    expect(await a.session.appendRoster("drive", { who: b.session.signed!.key })).toBe(true);
    b.session.setPresence(showing);
    await settle();
    // The host takes Live back: b's messages for its run count for a moment.
    expect(await a.session.appendRoster("drive", { who: a.session.signed!.key })).toBe(true);
    await settle();
    send(b, beacon(1));
    await settle();
    expect(from("b")).toEqual(["b:beacon1"]);
    // b and d hand the run back and forth: neither handoff names the roster's driver, so neither renews anything.
    for (let i = 0; i < 4; i++) {
      now += HANDOFF_MS / 3;
      send(b, handoff(d, i));
      send(d, handoff(b, i));
      await settle();
    }
    send(b, beacon(9));
    send(d, beacon(9));
    await settle();
    expect(from("b")).toEqual(["b:beacon1"]);
    expect(from("d")).toEqual([]);
  });

  it("a yes, a handover or a roster said in a message changes nothing: only signed entries do", async () => {
    const { a, b, c, watch, send, settle } = await setUp(46);
    send(b, { t: "host", to: c.session.senderId, cohosts: [b.session.senderId] });
    send(b, { t: "answer", to: b.session.senderId, what: "drive", yes: true });
    await settle();
    expect(watch.getState().hosting).toBe(false);
    expect(c.session.signed!.state()).toMatchObject({ host: a.session.signed!.key, cohosts: [], driver: undefined });
    expect(watch.getState().roster.host).toBe(a.session.senderId);
  });
});
