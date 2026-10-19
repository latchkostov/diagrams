import { bytesToText, textToBytes } from "../../interop/codec";
import { paletteHost } from "../../palette/host";
import type { PeerPresence } from "../presence";
import type { CollabSession } from "../session";
import type { RoomRole } from "./tabRoom";
import { snapshotDigest } from "../../sim/digest";
import {
  followViewport,
  LiveDriver,
  LiveFollower,
  viewOf,
  type DriverShow,
  type FollowStatus,
  type LiveChannel,
  type LiveMessage,
} from "./liveShare";

// Watch together in a room: who the host is, what they show, and this person's following. One per open room session
// (the chip's hook attaches to it). The live view is reached through src/live/watchBridge.ts, loaded only once the
// page is in Live (the palette's host registry says so) or this person asks to watch.

type Bridge = typeof import("../../live/watchBridge");

export interface WatchState {
  /** The room's host (the one who drives Live), when someone's presence says so. */
  host?: PeerPresence;
  /** What the host shows: a run to watch. */
  show?: { run: string; title: string; playing: boolean };
  /** This person's following, while they follow. */
  following?: FollowStatus;
  /** Follow the host's view (pans and zooms with theirs); off by default, and your own pan or zoom ends it. */
  followView: boolean;
  /** This person is the host. */
  hosting: boolean;
}

const MESSAGE_KINDS = new Set(["start", "log", "op", "beacon", "digest", "stop", "hello"]);

/** The room's live channel over its session: JSON, and nothing that isn't one of the known messages. */
export function sessionChannel(session: CollabSession): LiveChannel {
  return {
    send(message, to) {
      session.sendLive(textToBytes(JSON.stringify(message)), to);
    },
    onMessage(listener) {
      return session.onLive((sender, from, payload) => {
        let message: unknown;
        try {
          message = JSON.parse(bytesToText(payload));
        } catch {
          return;
        }
        if (!message || typeof message !== "object" || !MESSAGE_KINDS.has((message as { t?: string }).t ?? "")) return;
        listener(sender, from, message as LiveMessage);
      });
    },
  };
}

/** The host among peers: whoever says so (cooperative), the lowest sender id if more than one does. */
export function hostOf(peers: readonly PeerPresence[]): PeerPresence | undefined {
  return peers.filter((p) => p.host).sort((a, b) => (a.sender < b.sender ? -1 : 1))[0];
}

export class WatchTogether {
  private state: WatchState;
  private readonly listeners = new Set<() => void>();
  private bridge?: Bridge;
  private driver?: LiveDriver;
  private follower?: LiveFollower;
  /** This person asked to watch (the live view may still be on its way). */
  private wanted = false;
  private readonly channel: LiveChannel;
  private readonly stops: (() => void)[] = [];
  private viewStop?: () => void;
  /** The camera has the host's view (since the last opt-in). */
  private viewing = false;
  private offered?: string;
  private revision = -1;
  private followStop?: () => void;

  constructor(
    readonly session: CollabSession,
    role: RoomRole,
    private readonly announce: (show: { alias: string; title: string }, watch: () => void) => void,
    private readonly told: (message: "own" | "cant-follow" | "version") => void,
  ) {
    this.channel = sessionChannel(session);
    const hosting = role === "creator";
    this.state = { followView: false, hosting };
    if (hosting) session.setPresence({ host: true });
    this.stops.push(
      session.onChange(() => {
        if (session.presenceRevision !== this.revision) this.peersChanged();
      }),
      paletteHost.subscribe(() => this.liveChanged()),
    );
    this.liveChanged();
    this.peersChanged();
  }

  dispose(): void {
    this.stopFollowing();
    this.driver?.dispose();
    this.driver = undefined;
    this.viewStop?.();
    for (const stop of this.stops.splice(0)) stop();
  }

  getState = (): WatchState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<WatchState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Follow the host's run: into Live first if needed. */
  watch(): void {
    this.wanted = true;
    if (!paletteHost.get().session) paletteHost.get().live?.goLive();
    void this.loadBridge().then(() => this.attach());
  }

  /** Watch on my own: this person's run goes on from where it is, theirs to change. */
  watchOnMyOwn(): void {
    this.wanted = false;
    this.stopFollowing();
  }

  /** For tests (e2e builds): this person's run, its tick and digest. */
  probe(): { tick: number; digest: number; playing: boolean } | undefined {
    const c = this.bridge?.watchBridge.session()?.controller;
    if (!c) return undefined;
    const { snapshot, draws } = c.digestInputs();
    return { tick: c.tick, digest: snapshotDigest(snapshot, draws), playing: c.getState().playing };
  }

  setFollowView(on: boolean): void {
    this.set({ followView: on });
    if (on) this.applyView();
    else this.bridge?.watchBridge.session()?.camera.dispatch({ type: "host.view", view: null });
  }

  // -------------------------------------------------------------- the live view

  private loadBridge(): Promise<Bridge> {
    if (this.bridge) return Promise.resolve(this.bridge);
    return import("../../live/watchBridge").then((bridge) => {
      if (!this.bridge) {
        this.bridge = bridge;
        this.stops.push(bridge.watchBridge.subscribe(() => this.attach()));
      }
      return bridge;
    });
  }

  /** The page went into Live, or left it: the host shares (or stops), a follower who asked follows. */
  private liveChanged(): void {
    if (paletteHost.get().session) void this.loadBridge().then(() => this.attach());
    else this.attach();
  }

  private attach(): void {
    const watched = this.bridge?.watchBridge.session() ?? null;
    if (this.state.hosting) {
      if (watched && !this.driver) this.driver = new LiveDriver(this.channel, watched, (show) => this.shown(show));
      if (!watched && this.driver) {
        this.driver.dispose();
        this.driver = undefined;
      }
      this.watchView(watched);
      return;
    }
    if (!watched) {
      if (this.follower) this.stopFollowing();
      return;
    }
    const host = this.state.host;
    if (this.wanted && host && !this.follower) this.startFollowing(host.sender);
  }

  private shown(show: DriverShow | null): void {
    this.session.setPresence({ live: show ?? undefined });
    this.set({ show: show ?? undefined });
  }

  /** The host shares its view while in Live (presence's view: centre and zoom), at most four times a second. */
  private watchView(watched: ReturnType<Bridge["watchBridge"]["session"]>): void {
    this.viewStop?.();
    this.viewStop = undefined;
    if (!watched) {
      this.session.setPresence({ view: undefined });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      timer = undefined;
      const s = watched.store.getState();
      this.session.setPresence({ view: viewOf(s.transform, s) });
    };
    send();
    const stop = watched.store.subscribe(() => {
      timer ??= setTimeout(send, 250);
    });
    this.viewStop = () => {
      stop();
      clearTimeout(timer);
    };
  }

  // -------------------------------------------------------------- following

  private startFollowing(host: string): void {
    const watched = this.bridge?.watchBridge.session();
    if (!watched || !this.bridge) return;
    const follower = new LiveFollower(
      this.channel,
      watched,
      host,
      (status) => {
        this.set({ following: status });
        if (status.phase === "cant-follow") {
          this.told(status.version ? "version" : "cant-follow");
          this.watchOnMyOwn();
        }
      },
      () => {
        this.told("own");
        this.watchOnMyOwn();
      },
    );
    this.follower = follower;
    this.bridge.watchBridge.follower = { pace: (ms) => follower.pace(ms) };
    // The view taken back (their own pan or zoom, a note's focus): following the host's view ends there.
    this.followStop = watched.camera.subscribe(() => {
      if (this.state.followView && this.viewing && watched.camera.state.owner !== "host")
        this.set({ followView: false });
    });
    this.applyView();
  }

  private stopFollowing(): void {
    if (!this.follower) return;
    this.follower.dispose();
    this.follower = undefined;
    this.followStop?.();
    this.followStop = undefined;
    if (this.bridge) this.bridge.watchBridge.follower = null;
    if (this.state.followView) this.bridge?.watchBridge.session()?.camera.dispatch({ type: "host.view", view: null });
    this.set({ following: undefined, followView: false });
    this.viewing = false;
  }

  /** While following the host's view: this pane shows the host's centre at the host's zoom (the camera moves it). */
  private applyView(): void {
    const view = this.state.host?.view;
    const watched = this.bridge?.watchBridge.session();
    if (!this.state.followView || !this.follower || !view || !watched) return;
    this.viewing = true;
    watched.camera.dispatch({ type: "host.view", view: followViewport(view, watched.store.getState()) });
  }

  // -------------------------------------------------------------- the room's people

  private peersChanged(): void {
    this.revision = this.session.presenceRevision;
    if (this.state.hosting) return;
    const host = hostOf(this.session.peers());
    const show = host?.live;
    const previous = this.state.host;
    this.set({ host, show });
    if (this.follower && (!host || host.sender !== previous?.sender)) {
      // The host left (not a dropped connection: their presence is gone). Their run stays with this person.
      this.watchOnMyOwn();
      return;
    }
    if (host?.view && host.view !== previous?.view) this.applyView();
    // A new run to watch: offer it once (never automatic).
    if (show && !this.follower && show.run !== this.offered) {
      this.offered = show.run;
      this.announce({ alias: host.alias, title: show.title }, () => this.watch());
    }
    this.attach();
  }
}
