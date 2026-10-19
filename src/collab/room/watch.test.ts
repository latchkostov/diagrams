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

function fakeSession(peers: PeerPresence[] = []) {
  const sent: string[] = [];
  const presence: Record<string, unknown>[] = [];
  const session = {
    presenceRevision: 0,
    peers: () => peers,
    setPresence: (p: Record<string, unknown>) => presence.push(p),
    onChange: () => () => {},
    sendLive: (payload: Uint8Array) => {
      sent.push(bytesToText(payload));
      return true;
    },
    onLive: () => () => {},
  };
  return { session: session as unknown as CollabSession, sent, presence };
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
