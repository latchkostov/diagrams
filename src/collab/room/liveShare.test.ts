import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { LiveController } from "../../live/controller";
import { emptyInputs } from "../../live/capacityModel";
import { snapshotDigest } from "../../sim/digest";
import type { WatchedSession } from "../../live/watchBridge";
import type { LogEntry } from "../../live/controlLog";
import { textToBytes } from "../../interop/codec";
import { COLLAB_LIMITS } from "../limits";
import { encodeMessage, LiveDecoder, parseMessage } from "./liveWire";
import {
  ASK_MS,
  HOST_SILENT_MS,
  LiveDriver,
  LiveFollower,
  followViewport,
  viewOf,
  type FollowStatus,
  type LiveChannel,
  type LiveMessage,
  type LiveTimers,
} from "./liveShare";

// Watch together (shared Live P2) between two real live controllers, over an in-memory room channel, frame by
// frame on fake timers: the follower lands on the host's state at every tick the host digested, live tweaks and
// rate changes included, and a late joiner catches up to the same.

const diagram = kafka as unknown as DiagramFile;
const steady: Simulation = {
  id: "steady",
  title: "Steady checkouts",
  seed: 5,
  durationMs: 120_000,
  traffic: [
    {
      id: "checkouts",
      node: "shopper",
      messageType: "OrderRequest",
      shape: { kind: "constant", ratePerSec: 300, durationMs: 120_000 },
    },
  ],
};

/**
 * A room's live channel between named senders: every message reaches everyone else (or one) through the real wire
 * format (./liveWire.ts: parts, checks), each frame within the session's frame limit.
 */
class Room {
  private members = new Map<
    string,
    { listener: (sender: string, from: string, m: LiveMessage) => void; decoder: LiveDecoder }
  >();
  delivered: { from: string; m: LiveMessage; bytes: number }[] = [];
  /** While false, the host's frames are lost (their connection dropped). */
  hostOnline = true;
  channel(sender: string): LiveChannel {
    let id = 0;
    return {
      send: (message, to) => {
        const parts = encodeMessage(message, ++id);
        if (!parts) return "too-large";
        // The session refuses a frame past its limit (its envelope takes 49 bytes).
        if (parts.some((p) => p.length + 49 > COLLAB_LIMITS.maxLiveFrameBytes)) return "too-large";
        if (sender === "host" && !this.hostOnline) return "sent";
        this.delivered.push({ from: sender, m: message, bytes: JSON.stringify(message).length });
        for (const part of parts) this.raw(sender, part, to);
        return "sent";
      },
      onMessage: (listener) => {
        this.members.set(sender, { listener, decoder: new LiveDecoder(() => Date.now()) });
        return () => this.members.delete(sender);
      },
    };
  }
  /** A frame as it arrives, whatever it holds. */
  raw(sender: string, payload: Uint8Array, to?: string) {
    for (const [other, member] of this.members)
      if (other !== sender && (!to || to === other)) {
        const message = member.decoder.push(sender, payload);
        if (message) member.listener(sender, sender, message);
      }
  }
}

const timers: LiveTimers = {
  now: () => Date.now(),
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  soon(fn) {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  },
};

const session = (controller: LiveController): WatchedSession => ({
  controller,
  getDiagram: () => diagram,
  store: {
    getState: () => ({ transform: [0, 0, 1], width: 1000, height: 600 }),
    subscribe: () => () => {},
  },
  camera: { dispatch: () => {}, state: { owner: "fit" }, subscribe: () => () => {} },
  documentId: "doc",
  isPrivate: () => false,
});

const digestOf = (c: LiveController) => {
  const { snapshot, draws } = c.digestInputs();
  return snapshotDigest(snapshot, draws);
};

interface Watcher {
  controller: LiveController;
  follower: LiveFollower;
  status: FollowStatus[];
  local: number;
}

function watcher(room: Room, name: string): Watcher {
  const controller = new LiveController(diagram);
  const w: Watcher = { controller, status: [], local: 0, follower: undefined as unknown as LiveFollower };
  w.follower = new LiveFollower(
    room.channel(name),
    session(controller),
    "host",
    (s) => w.status.push(s),
    () => w.local++,
    timers,
  );
  return w;
}

/** One 16 ms frame for everyone: the host as the frame clock says, each follower at its follower's pace. */
function frame(host: LiveController, watchers: Watcher[]) {
  vi.advanceTimersByTime(16);
  host.advance(16);
  for (const w of watchers) w.controller.advance(w.follower.pace(16));
}

function framesUntil(host: LiveController, watchers: Watcher[], done: () => boolean, max = 20_000) {
  for (let i = 0; i < max && !done(); i++) frame(host, watchers);
  expect(done()).toBe(true);
}

const tickOf = (c: LiveController) => c.tick;

/** A JSON object nested `n` deep. */
const deep = (n: number): unknown => (n ? { a: deep(n - 1) } : 1);

/** The host pauses; the follower comes to the same tick, in the same state; the host plays on. */
function sameAfterPause(host: LiveController, w: Watcher) {
  host.setPlaying(false);
  framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(w.controller) === tickOf(host));
  expect(digestOf(w.controller)).toBe(digestOf(host));
  host.setPlaying(true);
}

const short: Simulation = {
  ...steady,
  id: "short",
  title: "A short burst",
  durationMs: 3_000,
  traffic: [{ ...steady.traffic[0], shape: { kind: "constant", ratePerSec: 200, durationMs: 3_000 } }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Watch together", () => {
  it("a follower lands on the host's state on the same tick, through live tweaks and a rate change", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const shows: unknown[] = [];
    const driver = new LiveDriver(room.channel("host"), session(host), (s) => shows.push(s), undefined, timers);
    expect(driver.runId).toBeDefined();
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following");
    // The host plays on and tweaks: replicas at 12 s, an entry rate at 18 s (a rebuild), an outage at 24 s.
    framesUntil(host, [w], () => tickOf(host) >= 1200);
    host.setNodeProps("inventory", { replicas: 3 });
    framesUntil(host, [w], () => tickOf(host) >= 1800);
    host.setInputs({ ...emptyInputs(), rates: { shopper: 450 } });
    framesUntil(host, [w], () => tickOf(host) >= 2400);
    host.setNodeStatus("payments", "down");
    framesUntil(host, [w], () => tickOf(host) >= 3000);
    // Every digest the host sent was checked on the follower's run at its tick, and matched.
    const digests = room.delivered.filter((d) => d.m.t === "digest");
    expect(digests.length).toBeGreaterThanOrEqual(5);
    // None while the host replayed (the rate change): each digest's last op is on or before its tick.
    const opTicks = new Map(host.controlLog().map((e) => [e.seq, e.tick]));
    for (const d of room.delivered) if (d.m.t === "op") opTicks.set(d.m.entry.seq, d.m.entry.tick);
    for (const { m } of digests) if (m.t === "digest") expect(opTicks.get(m.seq) ?? 0).toBeLessThanOrEqual(m.tick);
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    expect(w.status.filter((s) => s.phase === "catching-up")).toHaveLength(1);
    // The host pauses: the follower comes to the same tick, in the same state.
    host.setPlaying(false);
    framesUntil(host, [w], () => tickOf(w.controller) === tickOf(host));
    expect(digestOf(w.controller)).toBe(digestOf(host));
    expect(w.controller.effectiveProps("inventory").replicas).toBe(3);
    expect(w.controller.snapshot().nodes.payments.status).toBe("down");
    expect(w.local).toBe(0);
    expect(shows.at(-1)).toMatchObject({ title: "Steady checkouts", playing: false });
    driver.dispose();
  });

  it("follows about half a second behind, and never past the host", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 1000);
    for (let i = 0; i < 300; i++) {
      frame(host, [w]);
      expect(tickOf(w.controller)).toBeLessThanOrEqual(tickOf(host));
    }
    expect(tickOf(host) - tickOf(w.controller)).toBeGreaterThan(20);
    expect(tickOf(host) - tickOf(w.controller)).toBeLessThan(120);
    driver.dispose();
  });

  it("a late joiner catches up from the run's start and lands on the same state", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    for (let i = 0; i < 800; i++) frame(host, []);
    host.setNodeProps("inventory", { replicas: 3 });
    host.inject("gateway", 200);
    for (let i = 0; i < 800; i++) frame(host, []);
    const late = watcher(room, "late");
    framesUntil(host, [late], () => late.follower.phase === "following");
    expect(late.status.some((s) => s.phase === "catching-up")).toBe(true);
    host.setPlaying(false);
    framesUntil(host, [late], () => tickOf(late.controller) === tickOf(host));
    expect(digestOf(late.controller)).toBe(digestOf(host));
    driver.dispose();
  });

  it("when the host's connection drops, followers hold still; they go on when it's back", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 500);
    room.hostOnline = false;
    const until = Date.now() + HOST_SILENT_MS + 500;
    framesUntil(host, [w], () => Date.now() >= until);
    expect(w.follower.phase).toBe("host-dropped");
    const held = tickOf(w.controller);
    for (let i = 0; i < 100; i++) frame(host, [w]);
    expect(tickOf(w.controller)).toBe(held);
    // No new leader: the host is still the host.
    room.hostOnline = true;
    framesUntil(host, [w], () => w.follower.phase !== "host-dropped");
    driver.dispose();
  });

  it("an action of the follower's own ends following (they watch on their own from there)", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following");
    expect(w.local).toBe(0);
    w.controller.setNodeProps("inventory", { replicas: 9 });
    expect(w.local).toBe(1);
    driver.dispose();
  });

  it("keeps following across host restart, simulation selection and replay-after-finish", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 600);
    const runs = [driver.runId];
    const onNewRun = () => {
      const run = driver.runId;
      expect(runs).not.toContain(run);
      runs.push(run);
      framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 300);
      sameAfterPause(host, w);
    };
    // Restart: a new run from the same start.
    framesUntil(host, [w], () => tickOf(host) >= 900);
    host.restart();
    onNewRun();
    // Another simulation: a new run, its own start.
    host.selectSimulation(short);
    host.setPlaying(true);
    onNewRun();
    // The run finishes; Play plays it again from the start (a new run, logged as play).
    framesUntil(host, [w], () => !!host.getState().run?.done);
    framesUntil(host, [w], () => !!w.controller.getState().run?.done);
    expect(digestOf(w.controller)).toBe(digestOf(host));
    host.setPlaying(true);
    onNewRun();
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    expect(w.local).toBe(0);
    driver.dispose();
  });

  it("recovers commands missed during host disconnect", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 600);
    // Lost: two ops the host makes while its frames don't arrive.
    room.hostOnline = false;
    host.setNodeProps("inventory", { replicas: 3 });
    for (let i = 0; i < 20; i++) frame(host, [w]);
    host.setNodeStatus("payments", "down");
    for (let i = 0; i < 20; i++) frame(host, [w]);
    room.hostOnline = true;
    // No op after them: the next digest names ops the follower hasn't got, and it asks for the run.
    const asked = room.delivered.filter((d) => d.m.t === "hello").length;
    framesUntil(host, [w], () => room.delivered.filter((d) => d.m.t === "hello").length > asked);
    framesUntil(host, [w], () => w.follower.phase === "following");
    sameAfterPause(host, w);
    expect(w.controller.effectiveProps("inventory").replicas).toBe(3);
    expect(w.controller.snapshot().nodes.payments.status).toBe("down");
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    driver.dispose();
  });

  it("a missing op found by the next one: the follower asks for the run and lands on the host's state", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 600);
    room.hostOnline = false;
    host.setNodeProps("inventory", { replicas: 4 });
    room.hostOnline = true;
    host.setNodeProps("gateway", { replicas: 2 });
    framesUntil(host, [w], () => w.status.at(-1)?.phase === "joining");
    framesUntil(host, [w], () => w.follower.phase === "following");
    sameAfterPause(host, w);
    expect(w.controller.effectiveProps("inventory").replicas).toBe(4);
    driver.dispose();
  });

  it("a seek back behind ops the follower hasn't applied yet drops that branch, near or far", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 1500);
    // An op the follower (half a second behind) hasn't reached, then a seek back past it: a far one.
    host.setNodeProps("inventory", { replicas: 5 });
    host.seek(5_000);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 800);
    sameAfterPause(host, w);
    expect(w.controller.effectiveProps("inventory").replicas).not.toBe(5);
    // And a near one (a checkpoint away).
    framesUntil(host, [w], () => tickOf(host) >= 1200);
    host.setNodeProps("inventory", { replicas: 6 });
    host.seek(tickOf(host) * 10 - 2_000);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 1200);
    sameAfterPause(host, w);
    expect(w.controller.effectiveProps("inventory").replicas).not.toBe(6);
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    driver.dispose();
  });

  it("a run larger than a frame (an 80-note simulation, a long log) reaches a late joiner in parts", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    const narrated: Simulation = {
      ...steady,
      id: "narrated",
      title: "Narrated",
      timeline: Array.from({ length: 80 }, (_, i) => ({
        atMs: 1_000 + i * 1_000,
        action: { do: "note" as const, text: `Note ${i}: ${"what happens here, and why it matters. ".repeat(6)}` },
      })),
    };
    host.selectSimulation(narrated);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    for (let i = 0; i < 300; i++) {
      frame(host, []);
      host.setNodeProps("inventory", { replicas: 1 + (i % 4) });
    }
    const late = watcher(room, "late");
    // Catch-up advances a few ticks at a time, checking its deadline between them.
    const seek = late.controller.seek.bind(late.controller);
    let widest = 0;
    late.controller.seek = (ms: number) => {
      widest = Math.max(widest, ms / 10 - late.controller.tick);
      seek(ms);
    };
    framesUntil(host, [late], () => late.follower.phase === "following");
    expect(room.delivered.some((d) => d.m.t === "start" && d.bytes > COLLAB_LIMITS.maxLiveFrameBytes)).toBe(true);
    expect(room.delivered.filter((d) => d.m.t === "log").length).toBeGreaterThan(2);
    expect(widest).toBeLessThanOrEqual(10);
    sameAfterPause(host, late);
    driver.dispose();
  });

  it("free play's Inputs change starts it over: shared as a new run", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setTraffic(true);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 400);
    const before = driver.runId;
    host.setInputs({ ...emptyInputs(), rates: { shopper: 120 } });
    framesUntil(host, [w], () => driver.runId !== before);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 300);
    sameAfterPause(host, w);
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    driver.dispose();
  });

  it("while the host replays (an Inputs change), it sends no beacon or digest from behind its logged ops", () => {
    const room = new Room();
    const listeners: ((e: LogEntry) => void)[] = [];
    let tick = 0;
    const log: LogEntry[] = [];
    const fake = {
      get tick() {
        return tick;
      },
      runId: 1,
      controlLog: () => log,
      onOp: (l: (e: LogEntry) => void) => (listeners.push(l), () => {}),
      getState: () => ({ playing: true, speed: 1, run: null, simulation: null, traffic: false, inputs: emptyInputs() }),
      digestInputs: () => new LiveController(diagram).digestInputs(),
    } as unknown as LiveController;
    const driver = new LiveDriver(room.channel("host"), session(fake), () => {}, undefined, timers);
    const said = () => room.delivered.filter((d) => d.m.t === "beacon" || d.m.t === "digest").map((d) => d.m);
    tick = 900;
    vi.advanceTimersByTime(600);
    expect(said()).toContainEqual(expect.objectContaining({ t: "beacon", tick: 900 }));
    // An Inputs change at 1,000: the engine replays from the start toward it.
    const entry: LogEntry = { run: 1, seq: 1, tick: 1000, op: { kind: "inputs", inputs: emptyInputs() } };
    log.push(entry);
    for (const l of listeners) l(entry);
    tick = 400;
    const before = said().length;
    vi.advanceTimersByTime(2_000);
    expect(said().length).toBe(before);
    // Back where the ops are: beacons again (and a digest, when one's due).
    tick = 1500;
    vi.advanceTimersByTime(600);
    expect(said().slice(before)).toEqual([
      expect.objectContaining({ t: "beacon", tick: 1500 }),
      expect.objectContaining({ t: "digest", tick: 1500, seq: 1 }),
    ]);
    driver.dispose();
  });

  it("drops malformed messages without touching the follower's state", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 600);
    const run = driver.runId;
    const seq = host.controlLog().at(-1)?.seq ?? 0;
    const statuses = w.status.length;
    const bad: unknown[] = [
      { t: "op", run, entry: { seq: seq + 1, tick: host.tick, op: { kind: "step", simMs: 1e20 } } },
      { t: "op", run, entry: { seq: seq + 1, tick: host.tick, op: null } },
      { t: "op", run, entry: { seq: seq + 1, tick: host.tick, op: { kind: "inject", node: "gateway", count: 1e12 } } },
      { t: "op", run, entry: { seq: 1.5, tick: host.tick, op: { kind: "play", on: true } } },
      { t: "beacon", run, tick: 1e20, playing: true, speed: 1 },
      { t: "beacon", run, tick: 10, playing: true, speed: Infinity },
      { t: "log", run, entries: "all of them", done: true },
      { t: "log", run, entries: [], done: true },
      { t: "start", run, start: null },
      { t: "digest", run, tick: 1, seq: 1, hash: -1 },
      { t: "op", run: "../../x", entry: { seq: seq + 1, tick: 0, op: { kind: "play", on: true } } },
      { t: "op", run, entry: { seq: seq + 1, tick: host.tick, op: { kind: "props", node: "x", patch: deep(40) } } },
      { t: "nope" },
      null,
      [],
    ];
    for (const message of bad) {
      expect(parseMessage(message)).toBeUndefined();
      room.raw("host", textToBytes(JSON.stringify(message)));
    }
    room.raw("host", textToBytes("{not json"));
    room.raw("host", new Uint8Array([0, 1, 2]));
    expect(w.status.length).toBe(statuses);
    expect(w.follower.phase).toBe("following");
    for (let i = 0; i < 60; i++) frame(host, [w]);
    expect(w.status.slice(statuses).some((s) => s.phase !== "following")).toBe(false);
    sameAfterPause(host, w);
    driver.dispose();
  });

  it("a follower that can't get the run stops waiting: it watches on its own", () => {
    const room = new Room();
    const w = watcher(room, "guest");
    vi.advanceTimersByTime(ASK_MS * 8);
    expect(w.status.at(-1)?.phase).toBe("cant-follow");
    expect(w.local).toBe(0);
  });

  it("asks together get one answer, and a follower on the run ignores what it didn't ask for", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 600);
    const statuses = w.status.length;
    const starts = room.delivered.filter((d) => d.m.t === "start").length;
    const a = watcher(room, "a");
    const b = watcher(room, "b");
    frame(host, [w, a, b]);
    expect(room.delivered.filter((d) => d.m.t === "start").length).toBe(starts + 1);
    framesUntil(host, [w, a, b], () => a.follower.phase === "following" && b.follower.phase === "following");
    expect(w.status.length).toBe(statuses);
    driver.dispose();
  });

  it("a host on another engine version can't be followed: the follower is told why", () => {
    const room = new Room();
    const w = watcher(room, "guest");
    room.channel("host").send({
      t: "start",
      run: "x.1",
      start: { engine: "other", simulation: null, traffic: false, inputs: emptyInputs(), speed: 1, title: "" },
    });
    expect(w.status.at(-1)).toMatchObject({ phase: "cant-follow", version: true });
  });
});

describe("the host's view, for followers who choose to follow it", () => {
  it("is the host's centre and zoom, placed in the follower's own pane", () => {
    const host = viewOf([100, 50, 2], { width: 1000, height: 600 });
    expect(host).toEqual({ x: 200, y: 125, zoom: 2 });
    const follower = followViewport(host, { width: 500, height: 400 });
    // The same flow point sits at the follower's centre, at the same zoom.
    expect((250 - follower.x) / follower.zoom).toBe(200);
    expect((200 - follower.y) / follower.zoom).toBe(125);
    expect(follower.zoom).toBe(2);
  });
});
