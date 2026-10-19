import { paletteHost } from "../../palette/host";
import type { PeerPresence } from "../presence";
import type { CollabSession } from "../session";
import type { RoomRole } from "./tabRoom";
import { snapshotDigest } from "../../sim/digest";
import { TICK_MS } from "../../live/simClock";
import type { WatchedSession } from "../../live/watchBridge";
import {
  followViewport,
  LiveDriver,
  LiveFollower,
  runOrigin,
  viewOf,
  type DriverShow,
  type FollowStatus,
  type LiveChannel,
  type LiveMessage,
  type RunSnapshot,
  type SendResult,
} from "./liveShare";
import { encodeMessage, LiveDecoder } from "./liveWire";
import { driverOf, rosterOf, successor, type Roster } from "./roles";

// Watch together in a room, and its hosts and requests (P3): who hosts, who drives Live, what they show, and this
// person's following. One per open room session, owned by the room (bindWatch, from ./index.ts), so it lasts as long
// as the session whatever's on screen; the chip and the room's layer only show it. The live view is reached through
// src/live/watchBridge.ts, loaded only once the page is in Live (the palette's host registry says so) or this person
// asks to watch.
//
// Only the room's own diagram is shared or followed: a Live session on any other diagram (a Private one, say) is
// never attached, so nothing of it (its simulation's title, its definition) reaches the room.
//
// The driver role moves at a tick: the old driver hands its run over (a handoff), goes on following it, and the new
// driver, once its own run is level with the handoff, drives the same run on. Asking to show your own Live instead
// starts a new run, from your simulation.

type Bridge = typeof import("../../live/watchBridge");

/** A request waiting for the host's or a co-host's answer. */
export interface Prompt {
  from: string;
  alias: string;
  what: "drive" | "show";
  title?: string;
}

export interface WatchState {
  /** The room's host, when it's someone else. */
  host?: PeerPresence;
  /** Who drives what's shown (the run to watch comes from them), when it's someone else. */
  driver?: PeerPresence;
  /** What the driver shows: a run to watch. */
  show?: { run: string; title: string; playing: boolean };
  /** This person's following, while they follow. */
  following?: FollowStatus;
  /** Follow the driver's view (pans and zooms with theirs); off by default, and your own pan or zoom ends it. */
  followView: boolean;
  /** This person is the host, a co-host, the driver. */
  hosting: boolean;
  cohosting: boolean;
  driving: boolean;
  /** The roster, as presence says it. */
  roster: Roster;
  /** This person's sender id. */
  me: string;
  /** Requests waiting for this person's answer (the host and co-hosts). */
  prompts: Prompt[];
  /** This person asked, and waits for the answer. */
  asked?: "drive" | "show";
  /** "Sam is driving": the live bar was used while following (where, on screen). */
  inert?: { x: number; y: number };
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

export type WatchMessage =
  | "own"
  | "cant-follow"
  | "version"
  | "too-large"
  | "follow-too-large"
  | "ended"
  | "declined"
  | "driving"
  | "host"
  | "rebased";

export interface WatchNotices {
  /** A run to watch: offered once (never automatic). */
  offer(show: { alias: string; title: string }, watch: () => void): void;
  /** Something this person should know (they watch on their own now; the run couldn't be shared). */
  told(message: WatchMessage, alias: string): void;
}

/** How long a request waits for its answer before it counts as declined. */
export const ASK_TIMEOUT_MS = 60_000;
/** How long the next driver waits for the last one's handoff before it starts a run of its own. */
const HANDOFF_WAIT_MS = 10_000;

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

const LIVE_BAR = '[data-testid="live-controls"]';

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
  /** A channel that's never refused: requests and answers say nothing about anyone's Live. */
  private readonly control: LiveChannel;
  private readonly stops: (() => void)[] = [];
  private viewStop?: () => void;
  /** The camera has the driver's view (since the last opt-in). */
  private viewing = false;
  private offered?: string;
  private revision = -1;
  private followStop?: () => void;
  private recheck = false;
  /** The host's roster, while this person is the host: co-hosts (earliest first), and who drives (absent: the host). */
  private cohosts: string[] = [];
  private driverWanted?: string;
  /** The last roster a host said (a co-host's answer counts while the host is away). */
  private lastRoster: Roster = { cohosts: [] };
  /** A co-host's yes while no host is here: who drives next. */
  private override?: string;
  /** When this person first saw each peer here (who's been here longest). */
  private readonly since = new Map<string, number>();
  private readonly promptTimers = new Map<string, () => void>();
  private askTimer?: ReturnType<typeof setTimeout>;
  /** The last driver handed its run to this person: level with it at this tick and seq, then drive it on. */
  private takeover?: { tick: number; seq: number };
  private handoffWait?: ReturnType<typeof setTimeout>;
  /** A driver handed over not long ago: its show going away isn't the run ending. */
  private handedAt = -Infinity;
  private inertStop?: () => void;

  constructor(
    readonly session: CollabSession,
    role: RoomRole,
    private readonly room: WatchRoom,
    private readonly notices: WatchNotices,
  ) {
    this.target = room.read();
    this.channel = sessionChannel(session, () => this.mayShare());
    this.control = sessionChannel(session);
    const hosting = role === "creator";
    const me = session.senderId;
    this.state = {
      followView: false,
      hosting,
      cohosting: false,
      driving: false,
      roster: { cohosts: [] },
      me,
      prompts: [],
    };
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
      this.control.onMessage((sender, _from, message) => this.received(sender, message)),
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
    for (const stop of this.promptTimers.values()) stop();
    this.promptTimers.clear();
    clearTimeout(this.askTimer);
    clearTimeout(this.handoffWait);
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

  private get me(): string {
    return this.state.me;
  }

  private alias(sender: string): string {
    return this.session.peers().find((p) => p.sender === sender)?.alias ?? "";
  }

  /** Follow the driver's run: the room's diagram first, then into Live, if needed. */
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
    this.set({ inert: undefined });
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

  // -------------------------------------------------------------- roles and requests

  /** The roster as presence says it, this person's own claim included. */
  private roster(): Roster {
    const mine = this.state.hosting
      ? { sender: this.me, host: true as const, cohosts: this.cohosts, driver: this.driverWanted }
      : { sender: this.me };
    const r = rosterOf(mine, this.session.peers());
    if (r.host) this.lastRoster = r;
    return r;
  }

  /** Who should drive now: the roster's driver; with no host here, a co-host's yes, else whoever drives already. */
  private wantDriver(r = this.roster()): string | undefined {
    if (r.host) return r.driver;
    return this.override ?? (this.driver ? this.me : undefined);
  }

  /** Ask the host (and co-hosts) to drive the run this person follows. */
  askToDrive(): void {
    this.ask("drive");
  }

  /** Ask the host (and co-hosts) to show this person's own Live to the room (a new run, from their simulation). */
  showToRoom(): void {
    const title = this.bridge?.watchBridge.session()?.controller.getState().simulation?.title;
    this.ask("show", title);
  }

  private ask(what: "drive" | "show", title?: string): void {
    if (this.state.asked) return;
    this.control.send({ t: "ask", what, ...(title ? { title } : {}) });
    this.set({ asked: what, inert: undefined });
    clearTimeout(this.askTimer);
    // Not answered in a minute: it counts as declined.
    this.askTimer = setTimeout(() => {
      if (!this.state.asked) return;
      this.set({ asked: undefined });
      this.notices.told("declined", this.state.host?.alias ?? "");
    }, ASK_TIMEOUT_MS);
  }

  /** The host's or a co-host's answer to a request. */
  answer(prompt: Prompt, yes: boolean): void {
    this.dropPrompt(prompt.from);
    this.control.send({ t: "answer", to: prompt.from, what: prompt.what, yes });
    if (yes) this.granted(prompt.from, this.me);
  }

  /** A request was granted (by this person, or a co-host): the host's roster says so; with no host, the driver acts. */
  private granted(to: string, by: string): void {
    const r = this.roster();
    if (this.state.hosting) {
      this.driverWanted = to === this.me ? undefined : to;
      this.publishRoster();
    } else if (!r.host && this.driver && (by === this.me || this.lastRoster.cohosts.includes(by))) {
      this.override = to;
    }
    this.attach();
  }

  /** The host's people menu: who drives, co-hosts, who hosts. */
  letDrive(sender: string): void {
    if (!this.state.hosting) return;
    this.driverWanted = sender === this.me ? undefined : sender;
    this.publishRoster();
    this.attach();
  }

  takeBack(): void {
    this.letDrive(this.me);
  }

  setCohost(sender: string, on: boolean): void {
    if (!this.state.hosting || sender === this.me) return;
    this.cohosts = on
      ? [...this.cohosts.filter((s) => s !== sender), sender]
      : this.cohosts.filter((s) => s !== sender);
    this.publishRoster();
    this.peersChanged();
  }

  /** Make someone the host: they get the roster, this person becomes their first co-host. Live stays as it is. */
  makeHost(sender: string): void {
    if (!this.state.hosting || sender === this.me) return;
    const driver = this.driverWanted ?? this.me;
    this.control.send({
      t: "host",
      to: sender,
      cohosts: [this.me, ...this.cohosts.filter((s) => s !== sender)],
      ...(driver !== sender ? { driver } : {}),
    });
    this.resign();
  }

  private resign(): void {
    this.cohosts = [];
    this.driverWanted = undefined;
    for (const stop of this.promptTimers.values()) stop();
    this.promptTimers.clear();
    this.session.setPresence({ host: undefined, cohosts: undefined, driver: undefined });
    this.set({ hosting: false, prompts: [] });
    this.peersChanged();
  }

  private publishRoster(): void {
    this.session.setPresence({
      host: true,
      cohosts: this.cohosts.length ? this.cohosts : undefined,
      driver: this.driverWanted,
    });
    this.set({ roster: this.roster() });
  }

  /**
   * Leave room, on purpose: the host hands the room to the earliest co-host, else to whoever has been here longest,
   * and a driver hands the run to whoever drives next. (A dropped connection hands nothing over: followers wait.)
   */
  leaving(): void {
    if (this.disposed) return;
    const r = this.roster();
    let next = r.driver === this.me ? undefined : r.driver;
    if (this.state.hosting) {
      const host = successor(
        { ...r, host: this.me },
        this.session.peers().map((p) => p.sender),
        this.since,
      );
      if (host) {
        const driver = this.driverWanted && this.driverWanted !== host ? this.driverWanted : undefined;
        this.control.send({
          t: "host",
          to: host,
          cohosts: this.cohosts.filter((s) => s !== host),
          ...(driver ? { driver } : {}),
        });
        next = driver ?? host;
      }
    } else if (this.driver) next = r.host;
    if (this.driver && next && next !== this.me) {
      this.driver.handoff(next);
      this.driver = undefined;
    }
  }

  /** The room's control messages: requests, answers, a handover, a handoff to this person. */
  private received(sender: string, m: LiveMessage): void {
    if (this.disposed) return;
    const r = this.roster();
    switch (m.t) {
      case "ask":
        if (r.host === this.me || r.cohosts.includes(this.me))
          this.addPrompt({ from: sender, alias: this.alias(sender), what: m.what, title: m.title });
        return;
      case "answer":
        this.dropPrompt(m.to);
        if (m.to === this.me && this.state.asked) {
          clearTimeout(this.askTimer);
          this.set({ asked: undefined });
          if (!m.yes) this.notices.told("declined", this.alias(sender));
        }
        if (m.yes && (sender === r.host || r.cohosts.includes(sender) || this.lastRoster.cohosts.includes(sender)))
          this.granted(m.to, sender);
        return;
      case "host":
        // The host hands the room over (Make host, or leaving): this person is the host now. (The old host's presence
        // may already say otherwise: the last roster's host counts.)
        if (m.to !== this.me || (sender !== r.host && !(r.host === undefined && sender === this.lastRoster.host)))
          return;
        this.cohosts = m.cohosts.filter((s) => s !== this.me);
        this.driverWanted = m.driver === this.me ? undefined : m.driver;
        this.set({ hosting: true });
        this.publishRoster();
        this.notices.told("host", "");
        this.peersChanged();
        return;
      case "handoff":
        this.handedAt = performance.now();
        if (m.to !== this.me) return;
        // The last driver handed its run to this person: drive it on once level with it (its follower holds there).
        if (this.follower) {
          clearTimeout(this.handoffWait);
          this.takeover = { tick: m.tick, seq: m.seq };
        }
        this.attach();
        return;
      default:
        return;
    }
  }

  private addPrompt(prompt: Prompt): void {
    this.dropPrompt(prompt.from);
    this.set({ prompts: [...this.state.prompts, prompt] });
    // A minute without an answer: declined (the host says so; a co-host's card just goes).
    const timer = setTimeout(() => {
      if (!this.state.prompts.some((p) => p.from === prompt.from)) return;
      if (this.state.hosting) this.answer(prompt, false);
      else this.dropPrompt(prompt.from);
    }, ASK_TIMEOUT_MS);
    this.promptTimers.set(prompt.from, () => clearTimeout(timer));
  }

  private dropPrompt(from: string): void {
    this.promptTimers.get(from)?.();
    this.promptTimers.delete(from);
    if (this.state.prompts.some((p) => p.from === from))
      this.set({ prompts: this.state.prompts.filter((p) => p.from !== from) });
  }

  /** "Sam is driving" put away (Esc, a click elsewhere). */
  dismissInert(): void {
    this.set({ inert: undefined });
  }

  // -------------------------------------------------------------- the room's diagram, in Live

  /** The live session, if it's the room's diagram's and nothing says it stays on this device. */
  private eligible(watched: WatchedSession | null | undefined): watched is WatchedSession {
    const { documentId, eligible } = this.target;
    return !!watched && !!documentId && eligible && watched.documentId === documentId && !watched.isPrivate();
  }

  /** This person's own Live on the room's diagram, not following anyone: what Show to the room offers. */
  get canShow(): boolean {
    const live = this.bridge?.watchBridge.session() ?? null;
    return this.eligible(live) && !this.follower && !this.driver;
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

  /** The page went into Live, or left it, or to another diagram: the driver shares (or stops), a follower follows. */
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
    const r = this.roster();
    const want = this.wantDriver(r);
    if (this.driver && want && want !== this.me) return this.handOff(want, watched);
    if (!watched) return this.set({ driving: !!this.driver });
    if (want === this.me && !this.driver) {
      if (this.takeover) return;
      // Following the run it's to drive: the last driver hands it over (a while at most), else it starts its own.
      if (this.follower && this.follower.driver !== this.me && this.follower.phase !== "cant-follow") {
        this.handoffWait ??= setTimeout(() => {
          this.handoffWait = undefined;
          if (this.wantDriver() !== this.me || this.driver || this.takeover) return;
          this.stopFollowing();
          this.attach();
        }, HANDOFF_WAIT_MS);
        return;
      }
      if (!this.follower) return this.startDriving(watched);
    }
    if (want !== this.me && this.wanted && !this.follower) {
      const d = driverOf(r, this.session.peers());
      if (d) this.startFollowing(watched, d.sender);
    }
  }

  /** This person drives: the run as it is shared from its start (one that can't be told is started over first). */
  private startDriving(watched: WatchedSession, adopt?: RunSnapshot): void {
    const c = watched.controller;
    if (!adopt && !runOrigin(c)) {
      // A run this page can't describe from its start (Inputs changed since, say): it starts over at the same
      // moment, so the room watches the same run.
      const at = c.tick * TICK_MS;
      c.restart();
      if (c.runNow) c.seek(at);
      this.notices.told("rebased", "");
    }
    this.attached = watched;
    this.driver = new LiveDriver(
      this.channel,
      watched,
      (show) => this.shown(show),
      () => this.notices.told("too-large", ""),
      undefined,
      adopt,
    );
    this.watchView(watched);
    this.set({ driving: true });
  }

  /** Someone else drives from now: the run is handed over at this tick, and this person goes on following it. */
  private handOff(to: string, watched: WatchedSession | null): void {
    const snapshot = this.driver?.handoff(to);
    this.driver = undefined;
    this.watchView(null);
    this.set({ driving: false });
    this.handedAt = performance.now();
    if (!watched || !snapshot) {
      if (!this.follower) this.attached = undefined;
      return;
    }
    this.wanted = true;
    this.startFollowing(watched, to, snapshot);
  }

  /** Level with the handoff: this person drives the run on from here. */
  private drive(snapshot: RunSnapshot): void {
    const watched = this.attached;
    this.takeover = undefined;
    if (!watched) return;
    this.stopFollowing(true);
    this.override = undefined;
    this.startDriving(watched, snapshot);
    this.notices.told("driving", "");
  }

  private detachDriver(): void {
    if (this.driver) {
      this.driver.dispose();
      this.driver = undefined;
    }
    if (this.attached) this.watchView(null);
    if (!this.follower) this.attached = undefined;
    if (this.state.driving) this.set({ driving: false });
  }

  private shown(show: DriverShow | null): void {
    // What the room's presence says is only ever the room's own diagram's run.
    const live = show && this.attached && this.eligible(this.attached) ? show : undefined;
    this.session.setPresence({ live });
    this.set({ show: live });
  }

  /** The driver shares its view while in Live (presence's view: centre and zoom), at most four times a second. */
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

  private startFollowing(watched: WatchedSession, driver: string, adopt?: RunSnapshot): void {
    const bridge = this.bridge;
    if (!bridge) return;
    this.attached = watched;
    const alias = () => this.state.driver?.alias ?? "";
    // Told its first status as it's made: only this follower's, once it's this watcher's, counts.
    const made: { follower?: LiveFollower } = {};
    const follower = new LiveFollower(
      this.channel,
      watched,
      driver,
      (status) => {
        if (!made.follower || this.follower !== made.follower) return;
        this.set({ following: status });
        if (status.phase === "cant-follow") {
          const why = status.reason === "too-large" ? "follow-too-large" : (status.reason ?? "cant-follow");
          this.notices.told(why, alias());
          this.watchOnMyOwn();
        }
      },
      // This person changed the run themselves (a key, a menu): it's put back, and they're told who drives.
      () => {
        follower.restore();
        this.showInert(typeof document === "undefined" ? null : document.querySelector(LIVE_BAR));
      },
      undefined,
      adopt,
    );
    made.follower = follower;
    this.follower = follower;
    bridge.watchBridge.setFollower({
      pace: (ms) => {
        const paced = follower.pace(ms);
        // Handed the run: level with the handoff, this person drives it on.
        const t = this.takeover;
        const level = t && this.follower === follower ? follower.levelWith(t.tick, t.seq) : undefined;
        if (level) queueMicrotask(() => this.drive(level));
        return paced;
      },
    });
    // The view taken back (their own pan or zoom, a note's focus): following the driver's view ends there.
    this.followStop = watched.camera.subscribe(() => {
      if (this.state.followView && this.viewing && watched.camera.state.owner !== "host")
        this.set({ followView: false });
    });
    // A note's focus doesn't move a view this person moved themselves (camera row L10).
    watched.camera.dispatch({ type: "watching", on: true });
    this.inertBar();
    this.set({ following: { phase: follower.phase } });
    this.applyView();
  }

  private stopFollowing(quiet = false): void {
    if (!this.follower) return;
    const watched = this.attached;
    this.follower.dispose();
    this.follower = undefined;
    this.followStop?.();
    this.followStop = undefined;
    this.inertStop?.();
    this.inertStop = undefined;
    clearTimeout(this.handoffWait);
    this.handoffWait = undefined;
    this.bridge?.watchBridge.setFollower(null);
    watched?.camera.dispatch({ type: "watching", on: false });
    if (this.state.followView) watched?.camera.dispatch({ type: "host.view", view: null });
    if (!this.driver && !quiet) this.attached = undefined;
    this.viewing = false;
    this.set({ following: undefined, followView: false, inert: undefined });
  }

  /**
   * While following, the live bar is inert: its buttons don't act, and using one says who drives ("Sam is driving",
   * with Ask to drive and Watch on my own) instead of taking the run away.
   */
  private inertBar(): void {
    this.inertStop?.();
    if (typeof document === "undefined") return;
    const types = ["pointerdown", "mousedown", "click", "keydown", "dblclick"] as const;
    const stop = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      const bar = target?.closest(LIVE_BAR);
      if (!bar || !this.follower || this.driver) return;
      const key = e instanceof KeyboardEvent ? e.key : undefined;
      if (key === "Tab" || key === "Escape" || key === "Shift") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click" || key === "Enter" || key === " ") this.showInert(target);
    };
    for (const type of types) document.addEventListener(type, stop, true);
    document.body.dataset.watching = "";
    this.inertStop = () => {
      for (const type of types) document.removeEventListener(type, stop, true);
      delete document.body.dataset.watching;
    };
  }

  private showInert(anchor: Element | null): void {
    const rect = anchor?.getBoundingClientRect();
    this.set({ inert: { x: rect?.left ?? 16, y: rect?.top ?? 64 } });
  }

  /** While following the driver's view: this pane shows their centre at their zoom (the camera moves it). */
  private applyView(): void {
    const view = this.state.driver?.view;
    const watched = this.attached;
    if (!this.state.followView || !this.follower || !view || !watched) return;
    this.viewing = true;
    watched.camera.dispatch({ type: "host.view", view: followViewport(view, watched.store.getState()) });
  }

  // -------------------------------------------------------------- the room's people

  private peersChanged(): void {
    if (this.disposed) return;
    this.revision = this.session.presenceRevision;
    const peers = this.session.peers();
    const now = performance.now();
    for (const p of peers) if (!this.since.has(p.sender)) this.since.set(p.sender, now);
    const r = this.roster();
    const host = peers.find((p) => p.sender === r.host);
    const followed = this.follower?.driver;
    const driver = (followed && peers.find((p) => p.sender === followed && p.live)) || driverOf(r, peers);
    const show = this.driver ? this.state.show : driver?.live;
    const previous = this.state.driver;
    const wasShowing = !!this.state.show && !this.driver;
    this.set({
      host,
      driver,
      show,
      roster: r,
      hosting: this.state.hosting,
      cohosting: r.cohosts.includes(this.me),
    });
    const handing = now - this.handedAt < HANDOFF_WAIT_MS;
    if (this.follower && followed && followed !== this.me && !peers.some((p) => p.sender === followed) && !handing) {
      // The driver left (not a dropped connection: their presence is gone), handing nothing over. Their run stays.
      this.watchOnMyOwn();
      return;
    }
    if (this.follower && wasShowing && !show && !handing) {
      // The driver is here and stopped showing Live (back to editing, another diagram): not a dropped connection.
      this.notices.told("ended", driver?.alias ?? previous?.alias ?? "");
      this.watchOnMyOwn();
      return;
    }
    if (driver?.view && driver.view !== previous?.view) this.applyView();
    // A new run to watch: offer it once (never automatic).
    if (show && driver && !this.follower && !this.driver && show.run !== this.offered) {
      this.offered = show.run;
      this.notices.offer({ alias: driver.alias, title: show.title }, () => this.watch());
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
  room: {
    subscribe(fn: () => void): () => void;
    getSnapshot(): { open?: { session: CollabSession; role: RoomRole } };
    /** Called as this person leaves the room on purpose (before the room lets go of the session). */
    onLeaving?(fn: () => void): () => void;
  },
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
  const stopLeaving = room.onLeaving?.(() => current?.leaving());
  update();
  return () => {
    stop();
    stopLeaving?.();
    current?.dispose();
    current = undefined;
    for (const l of currentListeners) l();
  };
}
