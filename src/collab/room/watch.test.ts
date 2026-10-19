import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { bytesToText } from "../../interop/codec";
import { LiveController } from "../../live/controller";
import { snapshotDigest } from "../../sim/digest";
import { publishWatched, type WatchedSession } from "../../live/watchBridge";
import { publish, type CanvasHost } from "../../palette/host";
import type { EditorApi } from "../../editor/types";
import type { PeerPresence } from "../presence";
import type { CollabSession } from "../session";
import { sessionChannel, WatchTogether, type WatchNotices, type WatchRoom } from "./watch";
import { LiveDriver, LiveFollower, type LiveChannel, type LiveMessage } from "./liveShare";
import { encodeMessage, LiveDecoder } from "./liveWire";
import { RoomRoster } from "./roomRoster";

/** A tab's roster in a room: `member` its id (hex), hosting as a creator does. */
const roster = (role: "creator" | "joiner", member = "0123456789abcdef") =>
  new RoomRoster({ member, hosting: role === "creator", cohosts: [] }, () => {});
const memberOf = (sender: string) => (sender + sender).slice(0, 16);

// Watch together binds to the room's own diagram only: a Live session on any other diagram (a Private one here)
// is never attached, so nothing of it reaches the room: not its simulation's title in presence, not its definition
// on the live channel. And a watcher disposed while the live view's code loads never attaches.

const diagram = kafka as unknown as DiagramFile;
const secret: Simulation = {
  id: "secret",
  title: "Secret acquisition rehearsal",
  seed: 3,
  durationMs: 60_000,
  traffic: [
    {
      id: "t",
      node: "shopper",
      messageType: "OrderRequest",
      shape: { kind: "constant", ratePerSec: 50, durationMs: 60_000 },
    },
  ],
};
const shared: Simulation = { ...secret, id: "shared", title: "Steady checkouts" };

function fakeSession(initial: PeerPresence[] = []) {
  const sent: string[] = [];
  const presence: Record<string, unknown>[] = [];
  let peers = initial;
  const changes = new Set<() => void>();
  const session = {
    senderId: "aaaa0000",
    presenceRevision: 0,
    peers: () => peers,
    setPresence: (p: Record<string, unknown>) => presence.push(p),
    onChange: (fn: () => void) => {
      changes.add(fn);
      return () => changes.delete(fn);
    },
    sendLive: (payload: Uint8Array) => {
      sent.push(bytesToText(payload));
      return true;
    },
    onLive: () => () => {},
  };
  /** The room's people change (a presence update). */
  const setPeers = (next: PeerPresence[]) => {
    peers = next;
    session.presenceRevision++;
    for (const fn of changes) fn();
  };
  return { session: session as unknown as CollabSession, sent, presence, setPeers };
}

function live(documentId: string, isPrivate: boolean, sim: Simulation): WatchedSession {
  const controller = new LiveController(diagram);
  controller.selectSimulation(sim);
  return {
    controller,
    getDiagram: () => diagram,
    store: { getState: () => ({ transform: [0, 0, 1], width: 800, height: 600 }), subscribe: () => () => {} },
    camera: { dispatch: () => {}, state: { owner: "fit" }, subscribe: () => () => {} },
    documentId,
    isPrivate: () => isPrivate,
  };
}

const canvas = (documentId: string, isPrivate: boolean): CanvasHost => ({
  editor: {} as EditorApi,
  documentId,
  private: isPrivate,
  live: true,
  focusNode: () => {},
  addStencil: () => "",
});

const room = (show = vi.fn()): WatchRoom & { show: typeof show } => ({
  read: () => ({ documentId: "room-a", eligible: true }),
  show,
  subscribe: () => () => {},
});
const notices: WatchNotices = { offer: vi.fn(), told: vi.fn() };

/** The live view's code (a dynamic import), then what it set off. */
const settle = async () => {
  await import("../../live/watchBridge");
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const stops: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

/** Shows a diagram on the canvas, in Live with `session` (as the canvas and the live view publish themselves). */
function show(session: WatchedSession, isPrivate: boolean) {
  stops.push(
    publish("canvas", canvas(session.documentId ?? "", isPrivate)),
    publish("session", { run: () => {} }),
    publishWatched(session),
  );
}

it("the probe distinguishes a paused replay between frames from a settled run", async () => {
  const { session } = fakeSession();
  const watched = live("room-a", false, shared);
  show(watched, false);
  const watch = new WatchTogether(session, roster("creator"), room(), notices);
  await settle();
  const c = watched.controller;
  c.seek(20_000);
  const target = c.tick;
  const frames: FrameRequestCallback[] = [];
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 7));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try {
    c.setInputs({ props: {}, rates: { shopper: 75 } });
    vi.advanceTimersByTime(250);
    c.setPlaying(false);
    const held = watch.probe();
    expect(held).toMatchObject({ playing: false, busy: true });
    expect(held!.tick).toBeLessThan(target);
    // Equal tick samples prove nothing while the next replay frame is held.
    expect(watch.probe()?.tick).toBe(held!.tick);
    expect(watch.probe()?.busy).toBe(true);
    for (let i = 0; i < 1_000 && c.busy; i++) frames.shift()?.(0);
    expect(watch.probe()).toMatchObject({ playing: false, busy: false, tick: target });
  } finally {
    c.dispose();
    watch.dispose();
    vi.unstubAllGlobals();
    clock.mockRestore();
  }
});

describe("Watch together and privacy", () => {
  it("a Private diagram in Live while the room is on another: nothing of it is published or sent", async () => {
    const { session, sent, presence } = fakeSession();
    // The room is on A; this person opens Live on a Private diagram B.
    const b = live("private-b", true, secret);
    show(b, true);
    const watch = new WatchTogether(session, roster("creator"), room(), notices);
    await settle();
    b.controller.setPlaying(true);
    b.controller.setNodeProps("inventory", { replicas: 3 });
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
    expect(presence.every((p) => p.live === undefined && p.view === undefined)).toBe(true);
    expect(watch.getState().show).toBeUndefined();

    // Back on the room's diagram A: shared (what Watch together is for).
    const a = live("room-a", false, shared);
    show(a, false);
    vi.advanceTimersByTime(1_000);
    expect(presence.some((p) => (p.live as { title?: string } | undefined)?.title === "Steady checkouts")).toBe(true);
    expect(sent.length).toBeGreaterThan(0);

    // To B again: A's run is withdrawn at once, and nothing about B goes out.
    const before = sent.length;
    show(b, true);
    expect(presence.at(-1)?.live).toBeUndefined();
    b.controller.restart();
    b.controller.setNodeStatus("payments", "down");
    vi.advanceTimersByTime(5_000);
    const after = sent.slice(before);
    expect(after.every((m) => JSON.parse(m).t === "stop")).toBe(true);
    for (const m of sent) expect(m).not.toContain("Secret acquisition");
    for (const p of presence) expect(JSON.stringify(p)).not.toContain("Secret acquisition");
    watch.dispose();
  });

  it("an ordinary diagram that isn't the room's isn't shared either", async () => {
    const { session, sent, presence } = fakeSession();
    show(live("other", false, secret), false);
    const watch = new WatchTogether(session, roster("creator"), room(), notices);
    await settle();
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([]);
    expect(presence.every((p) => p.live === undefined)).toBe(true);
    watch.dispose();
  });

  it("the room's diagram made Private: sharing stops before anything else is sent", async () => {
    const { session, sent } = fakeSession();
    let isPrivate = false;
    const a: WatchedSession = { ...live("room-a", false, shared), isPrivate: () => isPrivate };
    show(a, false);
    const watch = new WatchTogether(session, roster("creator"), room(), notices);
    await settle();
    vi.advanceTimersByTime(1_000);
    expect(sent.length).toBeGreaterThan(0);
    // The canvas says so (its host republishes), and the live view's diagram too.
    isPrivate = true;
    stops.push(publish("canvas", canvas("room-a", true)));
    const before = sent.length;
    a.controller.setNodeProps("inventory", { replicas: 2 });
    vi.advanceTimersByTime(2_000);
    expect(sent.slice(before).every((m) => JSON.parse(m).t === "stop")).toBe(true);
    watch.dispose();
  });

  it("a follower asked to watch goes to the room's diagram first, and follows nothing else", async () => {
    const host: PeerPresence = {
      sender: "h",
      alias: "Heron",
      colour: 0,
      status: "here",
      host: true,
      live: { run: "r.1", title: "Steady checkouts", playing: true },
    } as unknown as PeerPresence;
    const { session, sent } = fakeSession([host]);
    show(live("private-b", true, secret), true);
    const r = room();
    const watch = new WatchTogether(session, roster("joiner"), r, notices);
    watch.watch();
    await settle();
    expect(r.show).toHaveBeenCalledTimes(1);
    expect(watch.getState().following).toBeUndefined();
    expect(sent).toEqual([]);
    watch.dispose();
  });
});

describe("Watch together's lifetime", () => {
  it("a follower on the room's diagram follows: it asks the host for the run", async () => {
    const host = {
      sender: "h",
      alias: "Heron",
      host: true,
      live: { run: "r.1", title: "Steady checkouts", playing: true },
    } as unknown as PeerPresence;
    const { session, sent } = fakeSession([host]);
    show(live("room-a", false, shared), false);
    const r = room();
    const watch = new WatchTogether(session, roster("joiner"), r, notices);
    watch.watch();
    await settle();
    expect(r.show).not.toHaveBeenCalled();
    expect(watch.getState().following?.phase).toBe("joining");
    expect(sent.map((m) => JSON.parse(m).t)).toEqual(["hello"]);
    watch.watchOnMyOwn();
    expect(watch.getState().following).toBeUndefined();
    watch.dispose();
  });

  it("the host stops showing Live (still here): following ends, told so, not as a dropped connection", async () => {
    const host = {
      sender: "h",
      alias: "Heron",
      host: true,
      live: { run: "r.1", title: "Steady checkouts", playing: true },
    } as unknown as PeerPresence;
    const { session, setPeers } = fakeSession([host]);
    show(live("room-a", false, shared), false);
    const told = vi.fn();
    const watch = new WatchTogether(session, roster("joiner"), room(), { offer: vi.fn(), told });
    watch.watch();
    await settle();
    expect(watch.getState().following).toBeDefined();
    setPeers([{ ...host, live: undefined }]);
    expect(told).toHaveBeenCalledWith("ended", "Heron");
    expect(watch.getState().following).toBeUndefined();
    watch.dispose();
  });

  it("disposed while the live view's code loads (StrictMode's remount, the room left): it never attaches", async () => {
    const { session, sent, presence } = fakeSession();
    show(live("room-a", false, shared), false);
    const watch = new WatchTogether(session, roster("creator"), room(), notices);
    watch.dispose();
    await settle();
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([]);
    expect(presence.every((p) => p.live === undefined)).toBe(true);
  });
});

/** A room of fake sessions: presence and the live channel between them, delivered at once. */
class FakeRoom {
  private sessions: {
    me: { sender: string; state: Record<string, unknown> };
    changes: Set<() => void>;
    live: Set<(sender: string, from: string, payload: Uint8Array) => void>;
    session: { presenceRevision: number };
  }[] = [];

  join(sender: string, alias: string): CollabSession {
    const entry = {
      me: { sender, state: { alias, colour: 0, status: "active" } as Record<string, unknown> },
      changes: new Set<() => void>(),
      live: new Set<(sender: string, from: string, payload: Uint8Array) => void>(),
      session: undefined as unknown as { presenceRevision: number },
    };
    const others = () => this.sessions.filter((s) => s !== entry);
    const notifyOthers = () => {
      for (const s of others()) {
        s.session.presenceRevision++;
        for (const fn of s.changes) fn();
      }
    };
    const session = {
      senderId: sender,
      presenceRevision: 0,
      peers: () => others().map((s) => ({ ...s.me.state, sender: s.me.sender, seen: 0 }) as unknown as PeerPresence),
      setPresence: (p: Record<string, unknown>) => {
        entry.me.state = { ...entry.me.state, ...p };
        notifyOthers();
      },
      onChange: (fn: () => void) => {
        entry.changes.add(fn);
        return () => entry.changes.delete(fn);
      },
      sendLive: (payload: Uint8Array) => {
        for (const s of others()) for (const fn of s.live) fn(sender, sender, payload);
        return true;
      },
      onLive: (fn: (sender: string, from: string, payload: Uint8Array) => void) => {
        entry.live.add(fn);
        return () => entry.live.delete(fn);
      },
      get me() {
        return entry.me.state;
      },
    };
    entry.session = session;
    this.sessions.push(entry);
    notifyOthers();
    return session as unknown as CollabSession;
  }

  leave(session: CollabSession): void {
    this.sessions = this.sessions.filter((s) => (s.session as unknown) !== session);
    for (const s of this.sessions) {
      s.session.presenceRevision++;
      for (const fn of s.changes) fn();
    }
  }
}

describe("Hosts and requests (P3)", () => {
  const [H, A, B] = ["00aa00aa", "11bb11bb", "22cc22cc"];
  const people = () => {
    const r = new FakeRoom();
    const told = { host: vi.fn(), a: vi.fn(), b: vi.fn() };
    const rosters = {
      host: roster("creator", memberOf(H)),
      a: roster("joiner", memberOf(A)),
      b: roster("joiner", memberOf(B)),
    };
    const host = new WatchTogether(r.join(H, "Sam"), rosters.host, room(), { offer: vi.fn(), told: told.host });
    const a = new WatchTogether(r.join(A, "Heron"), rosters.a, room(), { offer: vi.fn(), told: told.a });
    vi.advanceTimersByTime(10);
    const b = new WatchTogether(r.join(B, "Lynx"), rosters.b, room(), { offer: vi.fn(), told: told.b });
    const all = [host, a, b];
    stops.push(() => all.forEach((w) => w.dispose()));
    /** A reload: the tab's session goes, and comes back with a new sender id and the same roster record. */
    const reload = (w: WatchTogether, tab: RoomRoster, sender: string, alias: string) => {
      w.dispose();
      r.leave(w.session);
      const again = new WatchTogether(r.join(sender, alias), tab, room(), { offer: vi.fn(), told: vi.fn() });
      all.push(again);
      return again;
    };
    return { r, host, a, b, told, rosters, reload };
  };

  it("asking to drive: the host's card; Not now tells the asker, and nothing changes", () => {
    const { host, a, told } = people();
    a.askToDrive();
    expect(a.getState().asked).toBe("drive");
    expect(host.getState().prompts).toEqual([{ from: A, alias: "Heron", what: "drive" }]);
    host.answer(host.getState().prompts[0], false);
    expect(host.getState().prompts).toEqual([]);
    expect(a.getState().asked).toBeUndefined();
    expect(told.a).toHaveBeenCalledWith("declined", "Sam");
    expect(host.getState().roster.driver).toBe(H);
  });

  it("Let them: the host's roster names the new driver, for everyone; Take back returns it", () => {
    const { host, a, b } = people();
    a.askToDrive();
    host.answer(host.getState().prompts[0], true);
    expect(a.getState().asked).toBeUndefined();
    for (const w of [host, a, b]) expect(w.getState().roster.driver).toBe(A);
    host.takeBack();
    for (const w of [host, a, b]) expect(w.getState().roster.driver).toBe(H);
  });

  it("an unanswered request counts as declined after a minute", () => {
    const { host, a, told } = people();
    a.askToDrive();
    vi.advanceTimersByTime(60_000);
    expect(host.getState().prompts).toEqual([]);
    expect(a.getState().asked).toBeUndefined();
    expect(told.a).toHaveBeenCalledWith("declined", expect.any(String));
  });

  it("a host leaving on purpose hands the room to the earliest co-host", () => {
    const { r, host, a, b, told } = people();
    host.setCohost(B, true);
    expect(a.getState().roster.cohosts).toEqual([B]);
    host.leaving();
    r.leave(host.session);
    expect(b.getState().hosting).toBe(true);
    expect(a.getState().hosting).toBe(false);
    expect(told.b).toHaveBeenCalledWith("host", "");
    expect(a.getState().roster.host).toBe(B);
  });

  it("with no co-host, to whoever has been here longest", () => {
    const { r, host, a, b } = people();
    host.leaving();
    r.leave(host.session);
    expect(a.getState().hosting).toBe(true);
    expect(b.getState().hosting).toBe(false);
  });

  it("Make host: the old host becomes the first co-host, and who drives stays as it was", () => {
    const { host, a, b } = people();
    host.makeHost(B);
    expect(b.getState().hosting).toBe(true);
    expect(host.getState().hosting).toBe(false);
    expect(a.getState().roster).toMatchObject({ host: B, cohosts: [H], driver: H });
  });

  it("Show my Live to the room: the host's card names the simulation; Show everyone makes the asker drive it", async () => {
    const r = new FakeRoom();
    // The host's own canvas is elsewhere (this test's one live view is the asker's).
    const elsewhere: WatchRoom = { ...room(), read: () => ({ documentId: "room-b", eligible: true }) };
    const host = new WatchTogether(r.join(H, "Sam"), roster("creator", memberOf(H)), elsewhere, notices);
    const draft: Simulation = { ...shared, id: "draft-storm", title: "Retry storm (unsaved)" };
    show(live("room-a", false, draft), false);
    const a = new WatchTogether(r.join(A, "Heron"), roster("joiner", memberOf(A)), room(), notices);
    stops.push(() => [host, a].forEach((w) => w.dispose()));
    await settle();
    expect(a.canShow).toBe(true);
    a.showToRoom();
    expect(host.getState().prompts).toEqual([
      { from: A, alias: "Heron", what: "show", title: "Retry storm (unsaved)" },
    ]);
    host.answer(host.getState().prompts[0], true);
    expect(a.getState().driving).toBe(true);
    expect(a.getState().show).toMatchObject({ title: "Retry storm (unsaved)" });
    expect(host.getState().roster.driver).toBe(A);
  });

  it("a host already in Live with a run it can't describe from its start: it starts over at the same moment", async () => {
    const r = new FakeRoom();
    const told = vi.fn();
    const a = live("room-a", false, shared);
    a.controller.setPlaying(true);
    for (let i = 0; i < 300; i++) a.controller.advance(16);
    // Two Inputs changes: the log keeps only the latest, so the run's start can't be told.
    a.controller.setInputs({ props: {}, rates: {}, traffic: 2 });
    a.controller.setInputs({ props: {}, rates: {}, traffic: 3 });
    a.controller.flush();
    const run = a.controller.runId;
    const tick = a.controller.tick;
    show(a, false);
    const host = new WatchTogether(r.join(H, "Sam"), roster("creator", memberOf(H)), room(), { offer: vi.fn(), told });
    await settle();
    expect(told).toHaveBeenCalledWith("rebased", "");
    expect(a.controller.runId).not.toBe(run);
    expect(a.controller.tick).toBe(tick);
    expect(host.getState().driving).toBe(true);
    expect(host.getState().show).toMatchObject({ title: "Steady checkouts" });
    host.dispose();
  });

  it("a promoted host who reloads still hosts; the creator who handed it on doesn't take it back", () => {
    const { host, a, b, rosters, reload } = people();
    host.makeHost(B);
    expect(b.getState().hosting).toBe(true);
    const b2 = reload(b, rosters.b, "33dd33dd", "Lynx");
    expect(b2.getState().hosting).toBe(true);
    expect(a.getState().roster).toMatchObject({ host: "33dd33dd", cohosts: [H], driver: H });
    const host2 = reload(host, rosters.host, "44ee44ee", "Sam");
    expect(host2.getState().hosting).toBe(false);
    expect(a.getState().roster).toMatchObject({ host: "33dd33dd", cohosts: ["44ee44ee"], driver: "44ee44ee" });
  });

  it("co-host and driver assignments survive the host's reload", () => {
    const { host, a, b, rosters, reload } = people();
    host.setCohost(B, true);
    host.letDrive(A);
    reload(host, rosters.host, "44ee44ee", "Sam");
    for (const w of [a, b]) expect(w.getState().roster).toMatchObject({ host: "44ee44ee", cohosts: [B], driver: A });
  });

  it("with the host's presence gone (expired, no handover), a co-host still gets requests and can say yes", () => {
    const { r, host, a, b } = people();
    host.setCohost(B, true);
    host.dispose();
    r.leave(host.session);
    expect(b.getState().cohosting).toBe(true);
    a.askToDrive();
    expect(b.getState().prompts).toEqual([{ from: A, alias: "Heron", what: "drive" }]);
    b.answer(b.getState().prompts[0], true);
    for (const w of [a, b]) expect(w.getState().roster.driver).toBe(A);
  });

  it("a handoff asked for mid-replay waits for the replay: the run is handed over at its ops' tick", async () => {
    const r = new FakeRoom();
    const mine = live("room-a", false, shared);
    show(mine, false);
    const host = new WatchTogether(r.join(H, "Sam"), roster("creator", memberOf(H)), room(), notices);
    const elsewhere: WatchRoom = { ...room(), read: () => ({ documentId: "room-b", eligible: true }) };
    const a = new WatchTogether(r.join(A, "Heron"), roster("joiner", memberOf(A)), elsewhere, notices);
    stops.push(() => [host, a].forEach((w) => w.dispose()));
    await settle();
    expect(host.getState().driving).toBe(true);
    const c = mine.controller;
    c.setPlaying(true);
    for (let i = 0; i < 300; i++) c.advance(16);
    c.setInputs({ props: {}, rates: { shopper: 450 } });
    expect(c.busy).toBe(true);
    host.letDrive(A);
    // Still driving: the replay's tick isn't the run's yet.
    expect(host.getState().driving).toBe(true);
    for (let i = 0; i < 200 && c.busy; i++) {
      vi.advanceTimersByTime(16);
      c.advance(16);
    }
    expect(c.busy).toBe(false);
    await Promise.resolve();
    expect(host.getState().driving).toBe(false);
  });

  it("a duplicated tab (the same member id, a higher sender): everyone agrees on one driver, the copy takes its own id", () => {
    const { r, host, a, b, rosters } = people();
    host.letDrive(A);
    // The copy of A's tab: its record, member id and all, under a new sender.
    const copyRoster = new RoomRoster({ ...rosters.a.get() }, () => {});
    const copy = new WatchTogether(r.join("33dd33dd", "Heron"), copyRoster, room(), notices);
    stops.push(() => copy.dispose());
    expect(copyRoster.get().member).not.toBe(rosters.a.get().member);
    for (const w of [host, a, b, copy]) expect(w.getState().roster.driver).toBe(A);
  });

  it("handoff after an Inputs replay preserves the shared run: the next driver adopts it, the old host follows", async () => {
    const r = new FakeRoom();
    const mine = live("room-a", false, shared);
    show(mine, false);
    const host = new WatchTogether(r.join(H, "Sam"), roster("creator", memberOf(H)), room(), notices);
    const G = "55ff55ff";
    const guestSession = r.join(G, "Heron");
    guestSession.setPresence({ member: memberOf(G) });
    const gc = new LiveController(diagram);
    const guestWatched = { ...live("room-a", false, shared), controller: gc };
    const follower = new LiveFollower(
      sessionChannel(guestSession),
      guestWatched,
      H,
      () => {},
      () => {},
    );
    stops.push(() => {
      host.dispose();
      follower.dispose();
    });
    await settle();
    const c = mine.controller;
    c.setPlaying(true);
    const bridge = (await import("../../live/watchBridge")).watchBridge;
    const frame = () => {
      vi.advanceTimersByTime(16);
      c.advance(bridge.follower ? bridge.follower.pace(16) : 16);
      gc.advance(follower.pace(16));
    };
    for (let i = 0; i < 2_000 && !(follower.phase === "following" && c.tick >= 300); i++) frame();
    const run = host.probe()?.run;
    expect(run).toBeDefined();
    c.setInputs({ props: {}, rates: { shopper: 450 } });
    host.letDrive(G);
    // Mid-replay: nothing handed over yet.
    expect(host.getState().driving).toBe(true);
    expect(follower.driver).toBe(H);
    for (let i = 0; i < 400 && host.getState().driving; i++) {
      frame();
      await Promise.resolve();
    }
    expect(host.getState().driving).toBe(false);
    expect(follower.driver).toBe(G);
    // The guest comes level with the handoff (its tick, every op it holds applied) and drives the same run on.
    let level: ReturnType<LiveFollower["levelWith"]>;
    const at = c.tick;
    for (let i = 0; i < 2_000 && !(level = follower.levelWith(at, 0)); i++) frame();
    expect(level?.id).toBe(run);
    if (!level) return;
    follower.dispose();
    const driver = new LiveDriver(sessionChannel(guestSession), guestWatched, () => {}, undefined, undefined, level);
    stops.push(() => driver.dispose());
    for (let i = 0; i < 300; i++) {
      vi.advanceTimersByTime(16);
      gc.advance(16);
      c.advance(bridge.follower ? bridge.follower.pace(16) : 0);
    }
    gc.setPlaying(false);
    for (let i = 0; i < 2_000 && c.tick !== gc.tick; i++) {
      vi.advanceTimersByTime(16);
      c.advance(bridge.follower ? bridge.follower.pace(16) : 0);
    }
    expect(host.getState().following?.phase).toBe("following");
    expect(c.tick).toBe(gc.tick);
    const digest = (x: LiveController) => {
      const { snapshot, draws } = x.digestInputs();
      return snapshotDigest(snapshot, draws);
    };
    expect(digest(c)).toBe(digest(gc));
  });

  it("a co-host sees requests too, and the host applies a co-host's yes", () => {
    const { host, a, b } = people();
    host.setCohost(B, true);
    a.askToDrive();
    expect(b.getState().prompts).toHaveLength(1);
    b.answer(b.getState().prompts[0], true);
    expect(host.getState().prompts).toEqual([]);
    expect(a.getState().roster.driver).toBe(A);
  });
});

/**
 * A guest's Watch together (its live view on the bridge) and a host's real driver, linked: the host's frames reach
 * the guest's session as the room would deliver them, the guest's go to the host's driver.
 */
async function linked(opts: { deliver?: () => boolean } = {}) {
  const [HS, GS] = ["00aa00aa", "aaaa0000"];
  const hostC = new LiveController(diagram);
  hostC.selectSimulation(shared);
  const hostListeners = new Set<(sender: string, from: string, m: LiveMessage) => void>();
  const guestLive = new Set<(sender: string, from: string, payload: Uint8Array) => void>();
  let id = 0;
  const hostChannel: LiveChannel = {
    send(message) {
      if (opts.deliver && !opts.deliver()) return "sent";
      for (const part of encodeMessage(message, ++id) ?? []) for (const fn of guestLive) fn(HS, HS, part);
      return "sent";
    },
    onMessage(listener) {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
  };
  const hostWatched: WatchedSession = { ...live("room-a", false, shared), controller: hostC };
  const driver = new LiveDriver(hostChannel, hostWatched, () => {});
  hostC.setPlaying(true);
  const decoder = new LiveDecoder();
  let peers: PeerPresence[] = [];
  const changes = new Set<() => void>();
  const session = {
    senderId: GS,
    presenceRevision: 0,
    peers: () => peers,
    setPresence: () => {},
    onChange: (fn: () => void) => (changes.add(fn), () => changes.delete(fn)),
    sendLive: (payload: Uint8Array) => {
      const m = decoder.push(GS, payload);
      if (m) for (const fn of hostListeners) fn(GS, GS, m);
      return true;
    },
    onLive: (fn: (sender: string, from: string, payload: Uint8Array) => void) => (
      guestLive.add(fn),
      () => guestLive.delete(fn)
    ),
  } as unknown as CollabSession;
  const setHost = (extra: Partial<PeerPresence> = {}) => {
    peers = [
      {
        sender: HS,
        member: memberOf(HS),
        alias: "Sam",
        colour: 0,
        status: "active",
        seen: 0,
        host: true,
        live: { run: driver.runId ?? "x", title: "Steady checkouts", playing: true },
        ...extra,
      } as PeerPresence,
    ];
    (session as unknown as { presenceRevision: number }).presenceRevision++;
    for (const fn of changes) fn();
  };
  setHost();
  const guestLiveSession = live("room-a", false, shared);
  show(guestLiveSession, false);
  const told = vi.fn();
  const guest = new WatchTogether(session, roster("joiner", memberOf(GS)), room(), { offer: vi.fn(), told });
  stops.push(() => {
    guest.dispose();
    driver.dispose();
  });
  guest.watch();
  await settle();
  const g = guestLiveSession.controller;
  /** One 16 ms frame: the host as its clock says; the guest at its follower's pace, if it follows (`guestToo`). */
  const frame = async (guestToo = true) => {
    vi.advanceTimersByTime(16);
    hostC.advance(16);
    const pace = (await import("../../live/watchBridge")).watchBridge.follower;
    if (guestToo) g.advance(pace ? pace.pace(16) : 16);
    await Promise.resolve();
  };
  const until = async (done: () => boolean, max = 4_000, guestToo = true) => {
    for (let i = 0; i < max && !done(); i++) await frame(guestToo);
    expect(done()).toBe(true);
  };
  return { HS, GS, hostC, driver, guest, g, setHost, frame, until, told, guestLiveSession };
}

describe("Hosts and requests: the handoff coordinator", () => {
  it("a follower twelve seconds behind is handed the run: it catches up to the handoff and drives the same run on", async () => {
    const { GS, hostC, driver, guest, g, setHost, until } = await linked();
    await until(() => guest.getState().following?.phase === "following" && hostC.tick >= 200);
    const run = driver.runId;
    // The guest's page stalls while the host plays on, twelve seconds.
    await until(() => hostC.tick >= g.tick + 1_200, 4_000, false);
    setHost({ driver: memberOf(GS) });
    const at = hostC.tick;
    driver.handoff(GS);
    await until(() => guest.getState().driving);
    expect(g.tick).toBe(at);
    expect(guest.probe()?.run).toBe(run);
    expect(guest.getState().following).toBeUndefined();
  });

  it("handed the run while still joining (it doesn't hold that run): it starts a run of its own", async () => {
    let deliver = false;
    const { GS, driver, guest, setHost, until } = await linked({ deliver: () => deliver });
    expect(guest.getState().following?.phase).toBe("joining");
    setHost({ driver: memberOf(GS) });
    deliver = true;
    driver.handoff(GS);
    await until(() => guest.getState().driving);
    expect(guest.probe()?.run).not.toBe(undefined);
  });

  it("the next driver leaves Live mid-catch-up: the handoff is dropped, and back in Live it drives", async () => {
    const { GS, hostC, driver, guest, setHost, until, guestLiveSession } = await linked();
    await until(() => guest.getState().following?.phase === "following" && hostC.tick >= 200);
    setHost({ driver: memberOf(GS) });
    driver.handoff(GS);
    // Out of Live (the live view withdraws itself), then back.
    const [, sessionOff, bridgeOff] = stops.slice(-4, -1);
    bridgeOff();
    sessionOff();
    await Promise.resolve();
    expect(guest.getState().following).toBeUndefined();
    expect(guest.getState().driving).toBe(false);
    show(guestLiveSession, false);
    await settle();
    expect(guest.getState().driving).toBe(true);
  });

  it("slow motion while following pauses and gives playback back without a driving warning", async () => {
    const { hostC, guest, g, until } = await linked();
    await until(() => guest.getState().following?.phase === "following" && hostC.tick >= 200);
    const playing = g.isPlaying;
    // As SlowMotion does: pause, hold; later release the hold, and play as it was.
    g.setPlaying(false);
    g.hold(true);
    await Promise.resolve();
    g.hold(false);
    g.setPlaying(playing);
    await Promise.resolve();
    expect(guest.getState().inert).toBeUndefined();
    expect(g.isPlaying).toBe(playing);
    expect(guest.getState().following?.phase).toBe("following");
  });

  it("a follower's own change (Space) is turned away before it reaches the run: no rebuild, who drives is said", async () => {
    const { hostC, guest, g, until } = await linked();
    await until(() => guest.getState().following?.phase === "following" && hostC.tick >= 200);
    const playing = g.isPlaying;
    const log = g.controlLog().length;
    const run = g.runId;
    g.togglePlaying();
    g.setNodeStatus("payments", "down");
    await Promise.resolve();
    expect(g.isPlaying).toBe(playing);
    expect(g.controlLog()).toHaveLength(log);
    // Nothing to put back: the run wasn't rebuilt.
    expect(g.runId).toBe(run);
    expect(guest.getState().inert).toBeDefined();
    expect(guest.getState().following?.phase).toBe("following");
  });
});
