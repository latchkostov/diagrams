import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../../model/types";
import kafka from "../../examples/kafka-order-pipeline.json";
import { bytesToText } from "../../interop/codec";
import { LiveController } from "../../live/controller";
import { publishWatched, type WatchedSession } from "../../live/watchBridge";
import { publish, type CanvasHost } from "../../palette/host";
import type { EditorApi } from "../../editor/types";
import type { PeerPresence } from "../presence";
import type { CollabSession } from "../session";
import { WatchTogether, type WatchNotices, type WatchRoom } from "./watch";

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

describe("Watch together and privacy", () => {
  it("a Private diagram in Live while the room is on another: nothing of it is published or sent", async () => {
    const { session, sent, presence } = fakeSession();
    // The room is on A; this person opens Live on a Private diagram B.
    const b = live("private-b", true, secret);
    show(b, true);
    const watch = new WatchTogether(session, "creator", room(), notices);
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
    const watch = new WatchTogether(session, "creator", room(), notices);
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
    const watch = new WatchTogether(session, "creator", room(), notices);
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
    const watch = new WatchTogether(session, "joiner", r, notices);
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
    const watch = new WatchTogether(session, "joiner", r, notices);
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
    const watch = new WatchTogether(session, "joiner", room(), { offer: vi.fn(), told });
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
    const watch = new WatchTogether(session, "creator", room(), notices);
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
    const host = new WatchTogether(r.join(H, "Sam"), "creator", room(), { offer: vi.fn(), told: told.host });
    const a = new WatchTogether(r.join(A, "Heron"), "joiner", room(), { offer: vi.fn(), told: told.a });
    vi.advanceTimersByTime(10);
    const b = new WatchTogether(r.join(B, "Lynx"), "joiner", room(), { offer: vi.fn(), told: told.b });
    stops.push(() => [host, a, b].forEach((w) => w.dispose()));
    return { r, host, a, b, told };
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

  it("Show my Live to the room: the host's card names the simulation", () => {
    const { host, a } = people();
    show(live("room-a", false, shared), false);
    a.showToRoom();
    expect(a.getState().asked).toBe("show");
    expect(host.getState().prompts[0]).toMatchObject({ from: A, what: "show" });
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
    const host = new WatchTogether(r.join(H, "Sam"), "creator", room(), { offer: vi.fn(), told });
    await settle();
    expect(told).toHaveBeenCalledWith("rebased", "");
    expect(a.controller.runId).not.toBe(run);
    expect(a.controller.tick).toBe(tick);
    expect(host.getState().driving).toBe(true);
    expect(host.getState().show).toMatchObject({ title: "Steady checkouts" });
    host.dispose();
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
