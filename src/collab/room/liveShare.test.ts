import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { LiveController } from "../../live/controller";
import { effectiveSimulation, emptyInputs } from "../../live/capacityModel";
import { capacitySaveCandidate } from "../../live/capacityPersistence";
import { LiveSync } from "../../live/session/liveSync";
import { snapshotDigest } from "../../sim/digest";
import type { WatchedSession } from "../../live/watchBridge";
import type { LogEntry } from "../../live/controlLog";
import { textToBytes } from "../../interop/codec";
import { COLLAB_LIMITS } from "../limits";
import { encodeMessage, LiveDecoder, parseMessage } from "./liveWire";
import {
  ASK_MS,
  CATCH_UP_SLICE_MS,
  HOST_SILENT_MS,
  LIVE_PROTOCOL,
  MAX_DIGESTS,
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
  /** The room's diagram as every editor has it (the document syncs ahead of the run's ops). */
  doc: DiagramFile = diagram;
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

const session = (controller: LiveController, getDiagram: () => DiagramFile = () => diagram): WatchedSession => ({
  controller,
  getDiagram,
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

function watcher(room: Room, name: string, clock: LiveTimers = timers): Watcher {
  const controller = new LiveController(diagram);
  const w: Watcher = { controller, status: [], local: 0, follower: undefined as unknown as LiveFollower };
  w.follower = new LiveFollower(
    room.channel(name),
    session(controller, () => room.doc),
    "host",
    (s) => w.status.push(s),
    () => w.local++,
    clock,
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
      currentDiagram: diagram,
      settings: { simulation: null, traffic: false, inputs: emptyInputs(), speed: 1, playing: true },
      isPlaying: true,
      runNow: null,
      busy: false,
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
      { t: "start", v: LIVE_PROTOCOL, run, start: null },
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
      v: LIVE_PROTOCOL,
      run: "x.1",
      start: {
        engine: "other",
        simulation: null,
        traffic: false,
        inputs: emptyInputs(),
        speed: 1,
        title: "",
        props: {},
      },
    });
    expect(w.status.at(-1)).toMatchObject({ phase: "cant-follow", reason: "version" });
  });
});

/** The diagram with one node's props changed. */
const withNodeProps = (d: DiagramFile, id: string, props: Record<string, unknown>): DiagramFile => ({
  ...d,
  nodes: d.nodes.map((n) => (n.id === id ? { ...n, props: { ...n.props, ...props } } : n)),
});

/** A host playing `sim` (null: free play with traffic) and a guest following it. */
function hostAndGuest(sim: Simulation | null = steady, from = 500) {
  const room = new Room();
  const host = new LiveController(diagram);
  if (sim) host.selectSimulation(sim);
  else host.setTraffic(true);
  const driver = new LiveDriver(
    room.channel("host"),
    session(host, () => room.doc),
    () => {},
    undefined,
    timers,
  );
  host.setPlaying(true);
  const w = watcher(room, "guest");
  framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= from);
  return { room, host, driver, w };
}

const seenOf = (f: LiveFollower) => (f as unknown as { seen: number }).seen;
const rawFromHost = (room: Room, message: unknown) => room.raw("host", textToBytes(JSON.stringify(message)));

describe("Watch together: the host's ops through the controller", () => {
  it("an Inputs save (commit), then a newer Inputs edit: the follower keeps the saved baseline", () => {
    const { host, driver, w } = hostAndGuest();
    host.setInputs({ ...emptyInputs(), traffic: 2 });
    framesUntil(host, [w], () => tickOf(host) >= 700);
    const saved = effectiveSimulation(steady, host.getState().inputs);
    host.commitInputs(saved);
    framesUntil(host, [w], () => tickOf(host) >= 900);
    host.setInputs({ ...emptyInputs(), capacity: 2 });
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 1300);
    sameAfterPause(host, w);
    expect(w.controller.getState().simulation).toEqual(saved);
    expect(w.controller.getState().inputs).toEqual(host.getState().inputs);
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    expect(w.local).toBe(0);
    driver.dispose();
  });

  it("free play: 3 replicas in Inputs saved to the diagram, then edited to 5: the follower runs 5", () => {
    const { room, host, driver, w } = hostAndGuest(null);
    host.setInputs({ ...emptyInputs(), props: { inventory: { replicas: 3 } } });
    framesUntil(host, [w], () => tickOf(host) >= 700);
    const candidate = capacitySaveCandidate(room.doc, null, host.getState().inputs);
    room.doc = candidate.diagram;
    host.commitInputs(null, candidate.diagram);
    framesUntil(host, [w], () => tickOf(host) >= 900);
    room.doc = withNodeProps(room.doc, "inventory", { replicas: 5 });
    host.updateDiagram(room.doc);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 1200);
    sameAfterPause(host, w);
    expect(host.effectiveProps("inventory").replicas).toBe(5);
    expect(w.controller.effectiveProps("inventory").replicas).toBe(5);
    expect(w.controller.getState().inputs).toEqual(emptyInputs());
    driver.dispose();
  });

  it("two diagram edits within the playout delay both happen, each on its tick", () => {
    const { room, host, driver, w } = hostAndGuest();
    const rebuilds = w.status.filter((s) => s.phase === "catching-up").length;
    room.doc = withNodeProps(room.doc, "payments", { failureRate: 1 });
    host.updateDiagram(room.doc);
    // A quarter of a second later (the follower is half a second behind), the edit is undone.
    for (let i = 0; i < 15; i++) frame(host, [w]);
    room.doc = withNodeProps(room.doc, "payments", { failureRate: 0 });
    host.updateDiagram(room.doc);
    framesUntil(host, [w], () => tickOf(host) >= 1500);
    sameAfterPause(host, w);
    // The failure interval happened on the follower too: no drift, so no rebuild.
    expect(w.status.filter((s) => s.phase === "catching-up")).toHaveLength(rebuilds);
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    driver.dispose();
  });

  it("the host editing, then removing, the saved simulation while followed: the follower stays on", () => {
    const { host, driver, w } = hostAndGuest();
    const hostSync = new LiveSync(host);
    const guestSync = new LiveSync(w.controller);
    guestSync.setFollowing(true);
    hostSync.simulations([steady], () => undefined);
    guestSync.simulations([steady], () => undefined);
    // Edited (a faster entry rate): the document reaches both, the run's change comes as the host's op.
    const edited: Simulation = {
      ...steady,
      traffic: [{ ...steady.traffic[0], shape: { kind: "constant", ratePerSec: 450, durationMs: 120_000 } }],
    };
    guestSync.simulations([edited], () => undefined);
    hostSync.simulations([edited], () => undefined);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 900);
    sameAfterPause(host, w);
    expect(w.controller.getState().simulation).toEqual(edited);
    // Removed: the host goes to free play (a new run), and the follower with it.
    const before = driver.runId;
    guestSync.simulations([], () => undefined);
    hostSync.simulations([], () => undefined);
    expect(driver.runId).not.toBe(before);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 300);
    sameAfterPause(host, w);
    expect(w.controller.getState().simulation).toBeNull();
    expect(w.local).toBe(0);
    // Following ends: what waited is reconciled, and nothing's left to change.
    const ops = w.controller.controlLog().length;
    guestSync.setFollowing(false);
    expect(w.controller.controlLog()).toHaveLength(ops);
    driver.dispose();
  });

  it("an unsaved host draft: the guest's saved list doesn't have it, and following goes on", () => {
    const draft: Simulation = { ...steady, id: "draft", title: "A draft" };
    const { host, driver, w } = hostAndGuest(draft);
    const guestSync = new LiveSync(w.controller);
    guestSync.setFollowing(true);
    guestSync.simulations([steady], () => undefined);
    guestSync.simulations([steady, { ...steady, id: "other" }], () => undefined);
    framesUntil(host, [w], () => tickOf(host) >= 900);
    sameAfterPause(host, w);
    expect(w.local).toBe(0);
    expect(w.controller.getState().simulation?.id).toBe("draft");
    // Watching on their own from here: the draft they were shown stays theirs.
    guestSync.setFollowing(false);
    expect(w.controller.getState().simulation?.id).toBe("draft");
    driver.dispose();
  });

  it("a restart while the host's connection is down: its next beacon names a run the follower asks for", () => {
    const { room, host, driver, w } = hostAndGuest();
    const before = driver.runId;
    room.hostOnline = false;
    host.restart();
    for (let i = 0; i < 30; i++) frame(host, [w]);
    room.hostOnline = true;
    const asked = room.delivered.filter((d) => d.m.t === "hello").length;
    framesUntil(host, [w], () => room.delivered.filter((d) => d.m.t === "hello").length > asked);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 300);
    expect(driver.runId).not.toBe(before);
    sameAfterPause(host, w);
    driver.dispose();
  });

  it("restores the host's paused state after catching up (a simulation selected while paused)", () => {
    const { host, driver, w } = hostAndGuest();
    host.setPlaying(false);
    host.selectSimulation(short);
    framesUntil(host, [w], () => w.follower.phase === "following" && seenOf(w.follower) >= 1);
    for (let i = 0; i < 30; i++) frame(host, [w]);
    expect(host.getState().playing).toBe(false);
    expect(w.controller.getState().playing).toBe(false);
    host.setPlaying(true);
    framesUntil(host, [w], () => tickOf(host) >= 150);
    sameAfterPause(host, w);
    driver.dispose();
  });
});

describe("Watch together: catching up", () => {
  const long: Simulation = {
    ...steady,
    id: "long",
    durationMs: 600_000,
    traffic: [{ ...steady.traffic[0], shape: { kind: "constant", ratePerSec: 2, durationMs: 600_000 } }],
  };

  it("ten minutes of catch-up log no synthetic ops and publish no state per step", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(long);
    host.seek(590_000);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    const late = watcher(room, "late");
    let publishes = 0;
    late.controller.subscribe(() => publishes++);
    framesUntil(host, [late], () => late.follower.phase === "following");
    expect(tickOf(late.controller)).toBe(tickOf(host));
    expect(digestOf(late.controller)).toBe(digestOf(host));
    // The host's own ops (the rebuild's few, and the seek), not one per stretch of ten ticks.
    expect(late.controller.controlLog().length).toBeLessThanOrEqual(6);
    expect(publishes).toBeLessThan(40);
    driver.dispose();
  });

  it("catch-up yields at its deadline, and a follower disposed between slices replays no more", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(long);
    host.seek(300_000);
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    // A clock that moves with the work done: each stretch of catch-up costs 3 ms.
    let now = 0;
    const clock: LiveTimers = { ...timers, now: () => now };
    const late = watcher(room, "late", clock);
    const advance = late.controller.advanceTo.bind(late.controller);
    let calls = 0;
    late.controller.advanceTo = (tick: number) => {
      calls++;
      now += 3;
      advance(tick);
    };
    // The host's answer (start, log, clock), then the first slice.
    vi.advanceTimersToNextTimer();
    expect(calls).toBe(Math.ceil(CATCH_UP_SLICE_MS / 3));
    expect(tickOf(late.controller)).toBeLessThan(tickOf(host));
    expect(late.status.at(-1)?.phase).toBe("catching-up");
    // The next slice is queued; disposed, it never runs.
    late.follower.dispose();
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(Math.ceil(CATCH_UP_SLICE_MS / 3));
    driver.dispose();
  });
});

describe("Watch together: what a follower takes, and what it keeps", () => {
  it("a seek whose target says more than its tick does no more work than its tick says", () => {
    const { room, host, driver, w } = hostAndGuest();
    host.setPlaying(false);
    framesUntil(host, [w], () => tickOf(w.controller) === tickOf(host));
    const at = tickOf(w.controller);
    rawFromHost(room, {
      t: "op",
      run: driver.runId,
      entry: { seq: seenOf(w.follower) + 1, tick: at, op: { kind: "seek", targetMs: 600_000 } },
    });
    for (let i = 0; i < 5; i++) frame(host, [w]);
    expect(tickOf(w.controller)).toBeLessThanOrEqual(at + 1);
    // And one whose tick is past its target isn't taken at all.
    expect(
      parseMessage({
        t: "op",
        run: driver.runId,
        entry: { seq: 9, tick: 60_000, op: { kind: "seek", targetMs: 1_000 } },
      }),
    ).toBeUndefined();
    driver.dispose();
  });

  it("a run past the receive bounds ends following, saying why; waiting digests are bounded and kept once", () => {
    const { room, host, driver, w } = hostAndGuest();
    host.setPlaying(false);
    framesUntil(host, [w], () => tickOf(w.controller) === tickOf(host));
    const run = driver.runId;
    const ahead = tickOf(w.controller) + 10_000;
    for (let i = 0; i < 100; i++) {
      const digest = { t: "digest", run, tick: ahead + i, seq: 1, hash: 1 };
      rawFromHost(room, digest);
      rawFromHost(room, digest);
    }
    expect((w.follower as unknown as { digests: unknown[] }).digests).toHaveLength(MAX_DIGESTS);
    const first = seenOf(w.follower) + 1;
    for (let i = 0; i < 130; i++)
      rawFromHost(room, {
        t: "op",
        run,
        entry: {
          seq: first + i,
          tick: ahead,
          op: { kind: "props", node: "payments", patch: { note: "x".repeat(9_000) } },
        },
      });
    expect(w.status.at(-1)).toMatchObject({ phase: "cant-follow", reason: "too-large" });
    driver.dispose();
  });

  it("rebuilds after one digest mismatch, and stops after a second on the same run", () => {
    const { room, host, driver, w } = hostAndGuest();
    const wrong = () =>
      rawFromHost(room, {
        t: "digest",
        run: driver.runId,
        tick: tickOf(w.controller) + 20,
        seq: seenOf(w.follower),
        hash: (digestOf(w.controller) + 1) % 2 ** 32,
      });
    const before = w.status.length;
    wrong();
    framesUntil(host, [w], () => w.status.slice(before).some((s) => s.phase === "catching-up"));
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 900);
    sameAfterPause(host, w);
    wrong();
    framesUntil(host, [w], () => w.follower.phase === "cant-follow");
    driver.dispose();
  });

  it("a new run starts the mismatch count over", () => {
    const { room, host, driver, w } = hostAndGuest();
    const wrong = () =>
      rawFromHost(room, {
        t: "digest",
        run: driver.runId,
        tick: tickOf(w.controller) + 20,
        seq: seenOf(w.follower),
        hash: (digestOf(w.controller) + 1) % 2 ** 32,
      });
    let before = w.status.length;
    wrong();
    framesUntil(host, [w], () => w.status.slice(before).some((s) => s.phase === "catching-up"));
    framesUntil(host, [w], () => w.follower.phase === "following");
    host.restart();
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 300);
    before = w.status.length;
    wrong();
    framesUntil(host, [w], () => w.status.slice(before).some((s) => s.phase === "catching-up"));
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 600);
    expect(w.status.some((s) => s.phase === "cant-follow")).toBe(false);
    sameAfterPause(host, w);
    driver.dispose();
  });
});

describe("Watch together: the final round", () => {
  /** Steady checkouts, with a pausing note at one second. */
  const noted: Simulation = {
    ...steady,
    id: "noted",
    timeline: [{ atMs: 1_000, action: { do: "note", text: "Watch the order service.", pause: true } }],
  };

  it("a commit logs only the nodes the save changed, each whole; none when it changed none", () => {
    const many: DiagramFile = {
      ...diagram,
      nodes: [
        ...diagram.nodes,
        ...Array.from({ length: 2_000 }, (_, i) => ({
          ...diagram.nodes[1],
          id: `extra-${i}`,
          props: { messageType: `OrderRequest${"x".repeat(200)}` },
        })),
      ],
    };
    const c = new LiveController(many);
    c.setInputs({ ...emptyInputs(), props: { inventory: { replicas: 3 } } });
    const candidate = capacitySaveCandidate(many, null, c.getState().inputs);
    c.commitInputs(null, candidate.diagram);
    const commit = c.controlLog().at(-1);
    expect(commit?.op.kind).toBe("commit");
    if (commit?.op.kind !== "commit") return;
    expect(Object.keys(commit.op.props ?? {})).toEqual(["inventory"]);
    expect(commit.op.props?.inventory).toEqual(candidate.diagram.nodes.find((n) => n.id === "inventory")?.props);
    expect(JSON.stringify(commit).length).toBeLessThan(2_000);
    // A saved simulation's commit changes no node: no props at all.
    c.selectSimulation(steady);
    c.setInputs({ ...emptyInputs(), traffic: 2 });
    const saved = capacitySaveCandidate(candidate.diagram, steady, c.getState().inputs);
    c.commitInputs(saved.saved, saved.diagram);
    const second = c.controlLog().at(-1);
    expect(second?.op.kind === "commit" && second.op.props).toBeUndefined();
  });

  it("a host's seek past a pausing note: the follower passes it too, live and as a late joiner", () => {
    const { room, host, driver, w } = hostAndGuest(noted, 0);
    framesUntil(host, [w], () => !!host.runNow?.waiting && !!w.controller.runNow?.waiting);
    host.seek(25_000);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(w.controller) >= 2_500);
    sameAfterPause(host, w);
    const late = watcher(room, "late");
    framesUntil(host, [late], () => late.follower.phase === "following" && tickOf(late.controller) >= 2_500);
    sameAfterPause(host, late);
    driver.dispose();
  });

  it("a seek back past a diagram edit: shared afresh, so a late joiner lands on the host's state", () => {
    const { room, host, driver, w } = hostAndGuest(steady, 1_000);
    room.doc = withNodeProps(room.doc, "inventory", { replicas: 5 });
    host.updateDiagram(room.doc);
    framesUntil(host, [w], () => tickOf(host) >= 1_200);
    const before = driver.runId;
    host.seek(5_000);
    expect(driver.runId).not.toBe(before);
    framesUntil(host, [w], () => w.follower.phase === "following" && tickOf(host) >= 700);
    sameAfterPause(host, w);
    const late = watcher(room, "late");
    framesUntil(host, [late], () => late.follower.phase === "following" && tickOf(host) >= 900);
    sameAfterPause(host, late);
    expect(late.controller.effectiveProps("inventory").replicas).toBe(5);
    expect(late.status.some((s) => s.phase === "cant-follow")).toBe(false);
    driver.dispose();
  });

  it("catch-up yields while applying same-tick operations, and disposal cancels the rest", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    for (let i = 0; i < 60; i++) host.setNodeStatus("payments", i % 2 ? "up" : "down");
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, undefined, timers);
    let now = 0;
    const clock: LiveTimers = { ...timers, now: () => now };
    const late = watcher(room, "late", clock);
    const apply = late.controller.applyRemote.bind(late.controller);
    let calls = 0;
    late.controller.applyRemote = (entry) => {
      calls++;
      now += 3;
      apply(entry);
    };
    vi.advanceTimersToNextTimer();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(Math.ceil(CATCH_UP_SLICE_MS / 3));
    expect(late.status.at(-1)?.phase).toBe("catching-up");
    const at = calls;
    late.follower.dispose();
    vi.advanceTimersByTime(1_000);
    expect(calls).toBe(at);
    driver.dispose();
  });

  it("a host on another protocol version is told apart before its start is read: reload, not ask again", () => {
    const room = new Room();
    const w = watcher(room, "guest");
    // An older page's start: no protocol version, no start props.
    const old = { t: "start", run: "old.1", start: { engine: "x", simulation: null, traffic: false, speed: 1 } };
    expect(parseMessage(old)).toEqual({ t: "incompatible", run: "old.1" });
    rawFromHost(room, old);
    expect(w.status.at(-1)).toMatchObject({ phase: "cant-follow", reason: "version" });
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
