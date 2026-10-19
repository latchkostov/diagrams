import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { LiveController } from "../../live/controller";
import { emptyInputs } from "../../live/capacityModel";
import { snapshotDigest } from "../../sim/digest";
import type { WatchedSession } from "../../live/watchBridge";
import {
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

/** A room's live channel between named senders: every message reaches everyone else (or one), as JSON. */
class Room {
  private members = new Map<string, (sender: string, from: string, m: LiveMessage) => void>();
  delivered: { from: string; m: LiveMessage }[] = [];
  /** While false, the host's frames are lost (their connection dropped). */
  hostOnline = true;
  channel(sender: string): LiveChannel {
    return {
      send: (message, to) => {
        if (sender === "host" && !this.hostOnline) return;
        const copy = JSON.parse(JSON.stringify(message)) as LiveMessage;
        this.delivered.push({ from: sender, m: copy });
        for (const [other, listener] of this.members)
          if (other !== sender && (!to || to === other)) listener(sender, sender, copy);
      },
      onMessage: (listener) => {
        this.members.set(sender, listener);
        return () => this.members.delete(sender);
      },
    };
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Watch together", () => {
  it("a follower lands on the host's state on the same tick, through live tweaks and a rate change", () => {
    const room = new Room();
    const host = new LiveController(diagram);
    host.selectSimulation(steady);
    const shows: unknown[] = [];
    const driver = new LiveDriver(room.channel("host"), session(host), (s) => shows.push(s), timers);
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
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, timers);
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
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, timers);
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
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, timers);
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
    const driver = new LiveDriver(room.channel("host"), session(host), () => {}, timers);
    host.setPlaying(true);
    const w = watcher(room, "guest");
    framesUntil(host, [w], () => w.follower.phase === "following");
    expect(w.local).toBe(0);
    w.controller.setNodeProps("inventory", { replicas: 9 });
    expect(w.local).toBe(1);
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
