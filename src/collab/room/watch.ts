import { paletteHost } from "../../palette/host";
import type { PeerPresence } from "../presence";
import type { CollabSession } from "../session";
import type { RoomRole } from "./tabRoom";
import { snapshotDigest } from "../../sim/digest";
import type { WatchedSession } from "../../live/watchBridge";
import {
  followViewport,
  LiveDriver,
  LiveFollower,
  viewOf,
  type DriverShow,
  type FollowStatus,
  type LiveChannel,
  type SendResult,
} from "./liveShare";
import { encodeMessage, LiveDecoder } from "./liveWire";

// Watch together in a room: who the host is, what they show, and this person's following. One per open room session,
// owned by the room (bindWatch, from ./index.ts), so it lasts as long as the session whatever's on screen; the chip
// only shows it. The live view is reached through src/live/watchBridge.ts, loaded only once the page is in Live (the
// palette's host registry says so) or this person asks to watch.
//
// Only the room's own diagram is shared or followed: a Live session on any other diagram (a Private one, say) is
// never attached, so nothing of it (its simulation's title, its definition) reaches the room.

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

/** The room's diagram, as Watch together needs it. */
export interface WatchRoom {
  /** Its identity in Your diagrams (absent while a joiner waits for it), and whether it may be shared now. */
  read(): { documentId?: string; eligible: boolean };
  /** Shows the room's diagram (Watch goes there first). */
  show(): void;
  /** Calls `fn` when the room's diagram, or its privacy, may have changed. */
  subscribe(fn: () => void): () => void;
}

export type WatchMessage = "own" | "cant-follow" | "version" | "too-large";

export interface WatchNotices {
  /** A run to watch: offered once (never automatic). */
  offer(show: { alias: string; title: string }, watch: () => void): void;
  /** Something this person should know (they watch on their own now; the run couldn't be shared). */
  told(message: WatchMessage, alias: string): void;
}

/**
 * The room's live channel over its session: JSON, split into parts when it's larger than a frame, and checked in
 * full as it arrives (./liveWire.ts). Nothing is sent while `allowed` says no.
 */
export function sessionChannel(session: CollabSession, allowed: () => boolean = () => true): LiveChannel {
  let id = 0;
  const decoder = new LiveDecoder();
  return {
    send(message, to): SendResult {
      if (!allowed()) return "refused";
      const parts = encodeMessage(message, ++id);
      if (!parts) return "too-large";
      for (const part of parts) if (!session.sendLive(part, to)) return "too-large";
      return "sent";
    },
    onMessage(listener) {
      return session.onLive((sender, from, payload) => {
        const message = decoder.push(sender, payload);
        if (message) listener(sender, from, message);
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
  /** The live session the driver or follower is on: the room's diagram's, and allowed. */
  private attached?: WatchedSession;
  /** This person asked to watch (the room's diagram and its live view may still be on their way). */
  private wanted = false;
  private navigated = false;
  private wentLive = false;
  private disposed = false;
  private target: { documentId?: string; eligible: boolean };
  private readonly channel: LiveChannel;
  private readonly stops: (() => void)[] = [];
  private viewStop?: () => void;
  /** The camera has the host's view (since the last opt-in). */
  private viewing = false;
  private offered?: string;
  private revision = -1;
  private followStop?: () => void;
  private recheck = false;

  constructor(
    readonly session: CollabSession,
    role: RoomRole,
    private readonly room: WatchRoom,
    private readonly notices: WatchNotices,
  ) {
    this.target = room.read();
    this.channel = sessionChannel(session, () => this.mayShare());
    const hosting = role === "creator";
    this.state = { followView: false, hosting };
    if (hosting) session.setPresence({ host: true });
    this.stops.push(
      session.onChange(() => {
        if (session.presenceRevision !== this.revision) this.peersChanged();
      }),
      paletteHost.subscribe(() => this.liveChanged()),
      room.subscribe(() => {
        this.target = room.read();
        this.attach();
      }),
    );
    this.liveChanged();
    this.peersChanged();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopFollowing();
    this.detachDriver();
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.listeners.clear();
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

  /** Follow the host's run: the room's diagram first, then into Live, if needed. */
  watch(): void {
    if (this.disposed) return;
    this.wanted = true;
    this.target = this.room.read();
    this.navigated = false;
    this.wentLive = false;
    this.toLive();
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
    else this.attached?.camera.dispatch({ type: "host.view", view: null });
  }

  // -------------------------------------------------------------- the room's diagram, in Live

  /** The live session, if it's the room's diagram's and nothing says it stays on this device. */
  private eligible(watched: WatchedSession | null | undefined): watched is WatchedSession {
    const { documentId, eligible } = this.target;
    return !!watched && !!documentId && eligible && watched.documentId === documentId && !watched.isPrivate();
  }

  /**
   * Checked before anything is sent: the attached session is still the live view's, on the room's diagram, and it
   * may still be shared. Not so: nothing is sent, and the driver or follower is detached at once.
   */
  private mayShare(): boolean {
    const ok = !this.disposed && this.attached === this.bridge?.watchBridge.session() && this.eligible(this.attached);
    if (!ok && !this.recheck) {
      this.recheck = true;
      queueMicrotask(() => {
        this.recheck = false;
        this.attach();
      });
    }
    return ok;
  }

  /** Watch asked for: the room's diagram on screen, then Live on (once each per ask). */
  private toLive(): void {
    if (!this.wanted || this.follower || this.disposed) return;
    const documentId = this.target.documentId;
    const host = paletteHost.get();
    // Nothing on screen yet (it's on its way): what shows next says.
    if (!documentId || !host.canvas) return;
    if (host.canvas.documentId !== documentId) {
      if (!this.navigated) {
        this.navigated = true;
        this.room.show();
      }
      return;
    }
    if (!host.session && host.live && !this.wentLive) {
      this.wentLive = true;
      host.live.goLive();
    }
  }

  private loadBridge(): Promise<Bridge | undefined> {
    if (this.bridge) return Promise.resolve(this.bridge);
    return import("../../live/watchBridge").then((bridge) => {
      // Disposed while it loaded (the room left; React's StrictMode remounting): nothing attaches.
      if (this.disposed) return undefined;
      if (!this.bridge) {
        this.bridge = bridge;
        this.stops.push(bridge.watchBridge.subscribe(() => this.attach()));
      }
      return bridge;
    });
  }

  /** The page went into Live, or left it, or to another diagram: the host shares (or stops), a follower follows. */
  private liveChanged(): void {
    if (this.disposed) return;
    this.toLive();
    if (paletteHost.get().session) void this.loadBridge().then(() => this.attach());
    else this.attach();
  }

  private attach(): void {
    if (this.disposed) return;
    const live = this.bridge?.watchBridge.session() ?? null;
    const watched = this.eligible(live) ? live : null;
    // Another session (another diagram, a remount), or not allowed any more: what was attached goes first.
    if (this.attached && this.attached !== watched) {
      this.stopFollowing();
      this.detachDriver();
    }
    if (this.state.hosting) {
      if (watched && !this.driver) {
        this.attached = watched;
        this.driver = new LiveDriver(
          this.channel,
          watched,
          (show) => this.shown(show),
          () => this.notices.told("too-large", ""),
        );
        this.watchView(watched);
      }
      return;
    }
    if (!watched) return;
    const host = this.state.host;
    if (this.wanted && host && !this.follower) this.startFollowing(watched, host.sender);
  }

  private detachDriver(): void {
    if (this.driver) {
      this.driver.dispose();
      this.driver = undefined;
    }
    if (this.state.hosting && this.attached) this.watchView(null);
    if (!this.follower) this.attached = undefined;
  }

  private shown(show: DriverShow | null): void {
    // What the room's presence says is only ever the room's own diagram's run.
    const live = show && this.attached && this.eligible(this.attached) ? show : undefined;
    this.session.setPresence({ live });
    this.set({ show: live });
  }

  /** The host shares its view while in Live (presence's view: centre and zoom), at most four times a second. */
  private watchView(watched: WatchedSession | null): void {
    this.viewStop?.();
    this.viewStop = undefined;
    if (!watched) {
      this.session.setPresence({ view: undefined });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      timer = undefined;
      if (this.attached !== watched || !this.mayShare()) return;
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

  private startFollowing(watched: WatchedSession, host: string): void {
    const bridge = this.bridge;
    if (!bridge) return;
    this.attached = watched;
    const alias = () => this.state.host?.alias ?? "";
    // Told its first status as it's made: only this follower's, once it's this watcher's, counts.
    const made: { follower?: LiveFollower } = {};
    const follower = new LiveFollower(
      this.channel,
      watched,
      host,
      (status) => {
        if (!made.follower || this.follower !== made.follower) return;
        this.set({ following: status });
        if (status.phase === "cant-follow") {
          this.notices.told(status.version ? "version" : "cant-follow", alias());
          this.watchOnMyOwn();
        }
      },
      () => {
        this.notices.told("own", alias());
        this.watchOnMyOwn();
      },
    );
    made.follower = follower;
    this.follower = follower;
    bridge.watchBridge.follower = { pace: (ms) => follower.pace(ms) };
    // The view taken back (their own pan or zoom, a note's focus): following the host's view ends there.
    this.followStop = watched.camera.subscribe(() => {
      if (this.state.followView && this.viewing && watched.camera.state.owner !== "host")
        this.set({ followView: false });
    });
    this.set({ following: { phase: follower.phase } });
    this.applyView();
  }

  private stopFollowing(): void {
    if (!this.follower) return;
    const watched = this.attached;
    this.follower.dispose();
    this.follower = undefined;
    this.followStop?.();
    this.followStop = undefined;
    if (this.bridge) this.bridge.watchBridge.follower = null;
    if (this.state.followView) watched?.camera.dispatch({ type: "host.view", view: null });
    if (!this.driver) this.attached = undefined;
    this.viewing = false;
    this.set({ following: undefined, followView: false });
  }

  /** While following the host's view: this pane shows the host's centre at the host's zoom (the camera moves it). */
  private applyView(): void {
    const view = this.state.host?.view;
    const watched = this.attached;
    if (!this.state.followView || !this.follower || !view || !watched) return;
    this.viewing = true;
    watched.camera.dispatch({ type: "host.view", view: followViewport(view, watched.store.getState()) });
  }

  // -------------------------------------------------------------- the room's people

  private peersChanged(): void {
    if (this.disposed) return;
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
      this.notices.offer({ alias: host.alias, title: show.title }, () => this.watch());
    }
    this.attach();
  }
}

// ---------------------------------------------------------------- one per open room

let current: WatchTogether | undefined;
const currentListeners = new Set<() => void>();

/** The open room's Watch together (the chip subscribes to it). */
export const roomWatch = {
  get: (): WatchTogether | undefined => current,
  subscribe(listener: () => void): () => void {
    currentListeners.add(listener);
    return () => currentListeners.delete(listener);
  },
};

/**
 * Keeps one WatchTogether for the room's open session, for as long as it's open (a new session, a new one; the
 * room left, none). Returns an unbind.
 */
export function bindWatch(
  room: { subscribe(fn: () => void): () => void; getSnapshot(): { open?: { session: CollabSession; role: RoomRole } } },
  target: WatchRoom,
  notices: WatchNotices,
): () => void {
  const update = () => {
    const open = room.getSnapshot().open;
    if (current?.session === open?.session) return;
    current?.dispose();
    current = open ? new WatchTogether(open.session, open.role, target, notices) : undefined;
    if (import.meta.env.VITE_E2E === "1") (window as unknown as { __watch?: WatchTogether }).__watch = current;
    for (const l of currentListeners) l();
  };
  const stop = room.subscribe(update);
  update();
  return () => {
    stop();
    current?.dispose();
    current = undefined;
    for (const l of currentListeners) l();
  };
}
