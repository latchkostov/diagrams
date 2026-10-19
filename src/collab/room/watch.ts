import { paletteHost } from "../../palette/host";
import type { PeerPresence } from "../presence";
import type { CollabSession } from "../session";
import type { RoomRoster } from "./roomRoster";
import type { LiveController } from "../../live/controller";
import { snapshotDigest } from "../../sim/digest";
import { TICK_MS } from "../../live/simClock";
import type { WatchedSession } from "../../live/watchBridge";
import {
  followViewport,
  LiveDriver,
  LiveFollower,
  runOrigin,
  viewOf,
  HANDOFF_MS,
  type DriverShow,
  type FollowStatus,
  type LiveChannel,
  type LiveMessage,
  type RunSnapshot,
  type SendResult,
} from "./liveShare";
import { encodeMessage, LiveDecoder } from "./liveWire";
import { driverOf, ownsMember, rosterOf, successor, type Roster, type RosterSource } from "./roles";
import { clonedRoster } from "./roomRoster";

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
//
// In a signed room (P4) the roles are the session's signed roster (../roster.ts), not presence: the host and co-hosts
// change them by signed entries (a yes to a request too), and the shared run's messages count only from its driver
// (signed, so no one else can send them as the driver): the roster's driver while they're here, else the host. The
// last driver's messages still count for a moment after the roster moved on (HANDOFF_MS, until its handoff), and
// so do those of whom it handed the run to, until the roster says so too.

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
  /** A signed room (P4): roles are its signed roster's, and these say what it says beyond the roster above. */
  signed: boolean;
  /** This person can change roles (the host, a co-host). */
  lead: boolean;
  /** New people can only view (the host's or a co-host's switch). */
  viewOnly: boolean;
  /** This person can edit (always, in a room without roles). */
  canEdit: boolean;
  /** People here who can only view (sender ids). */
  viewers: string[];
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
  | "rebased"
  | "removal-limit";

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
export type Verdict = "pass" | "drop" | "hold";

/** A channel whose messages pass a gate: held ones wait (a while, a few) for `release` to ask the gate again. */
export interface GatedChannel extends LiveChannel {
  release(): void;
}

/** Messages a gated channel holds at most, and for how long. */
const HELD_MESSAGES = 8;

export function sessionChannel(
  session: CollabSession,
  allowed: () => boolean = () => true,
  gate: (sender: string, message: LiveMessage) => Verdict = () => "pass",
): GatedChannel {
  let id = 0;
  const decoder = new LiveDecoder();
  const listeners = new Set<(sender: string, from: string, message: LiveMessage) => void>();
  let held: { sender: string; from: string; message: LiveMessage; at: number }[] = [];
  let stop: (() => void) | undefined;
  const deliver = (sender: string, from: string, message: LiveMessage) => {
    for (const listener of [...listeners]) listener(sender, from, message);
  };
  const judge = (h: { sender: string; from: string; message: LiveMessage; at: number }) => {
    const verdict = gate(h.sender, h.message);
    if (verdict === "pass") deliver(h.sender, h.from, h.message);
    else if (verdict === "hold") held = [...held.slice(-(HELD_MESSAGES - 1)), h];
  };
  return {
    send(message, to): SendResult {
      if (!allowed()) return "refused";
      const parts = encodeMessage(message, ++id);
      if (!parts) return "too-large";
      for (const part of parts) if (!session.sendLive(part, to)) return "too-large";
      return "sent";
    },
    onMessage(listener) {
      listeners.add(listener);
      // One subscription however many listen: each message is decoded once.
      stop ??= session.onLive((sender, from, payload) => {
        const message = decoder.push(sender, payload);
        if (message) judge({ sender, from, message, at: performance.now() });
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stop?.();
        stop = undefined;
      };
    },
    release() {
      const now = performance.now();
      const waiting = held.filter((h) => now - h.at < HANDOFF_MS);
      held = [];
      for (const h of waiting) judge(h);
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
  private readonly channel: GatedChannel;
  /** A channel that's never refused: requests and answers say nothing about anyone's Live. */
  private readonly control: GatedChannel;
  private readonly stops: (() => void)[] = [];
  private viewStop?: () => void;
  /** The camera has the driver's view (since the last opt-in). */
  private viewing = false;
  private offered?: string;
  private revision = -1;
  private followStop?: () => void;
  private recheck = false;
  /** When this person first saw each peer here, by sender (who's been here longest). */
  private readonly since = new Map<string, number>();
  private readonly promptTimers = new Map<string, () => void>();
  private askTimer?: ReturnType<typeof setTimeout>;
  /**
   * The handoff to this person in progress: the run it hands over (held by this follower), the tick and last op to
   * come level with, and its deadline. Gone once this person drives, or on its deadline, the follower's failure or
   * its going (then this person starts a run of their own).
   */
  private takeover?: {
    follower: LiveFollower;
    run: string;
    tick: number;
    seq: number;
    timer: ReturnType<typeof setTimeout>;
  };
  private handoffWait?: ReturnType<typeof setTimeout>;
  /** A driver handed over not long ago: its show going away isn't the run ending. */
  private handedAt = -Infinity;
  /** Waiting for this driver's Inputs replay to end before handing the run over. */
  private handing?: () => void;
  private inertStop?: () => void;
  private guardStop?: () => void;
  private snapshotKey = "";
  /**
   * A signed room: the last driver, whose messages for the run it drove still count for a moment after the roster
   * moved on (until its handoff, or HANDOFF_MS). Nothing extends it.
   */
  private grace?: { key: string; run?: string; until: number };
  private driverKey?: string;
  private wasHosting?: boolean;

  constructor(
    readonly session: CollabSession,
    private readonly roster: RoomRoster,
    private readonly room: WatchRoom,
    private readonly notices: WatchNotices,
  ) {
    this.target = room.read();
    this.channel = sessionChannel(
      session,
      () => this.mayShare(),
      (sender, m) => this.moves(sender, m),
    );
    this.control = sessionChannel(session, undefined, (sender, m) =>
      m.t === "handoff" ? this.moves(sender, m, false) : "pass",
    );
    const mine = roster.get();
    this.state = {
      followView: false,
      hosting: mine.hosting,
      cohosting: false,
      driving: false,
      roster: { cohosts: [], source: { cohosts: [] } },
      me: session.senderId,
      prompts: [],
      signed: !!session.signed,
      lead: false,
      viewOnly: false,
      canEdit: session.canEdit,
      viewers: [],
    };
    this.claim();
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
    // A signed room's roster or bindings changed: the roles did.
    if (session.signed) this.stops.push(session.signed.subscribe(() => this.peersChanged()));
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
    this.handing?.();
    this.listeners.clear();
  }

  getState = (): WatchState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A new snapshot only when something in it changed (a cursor moving changes nothing here). */
  private set(patch: Partial<WatchState>): void {
    if ((Object.keys(patch) as (keyof WatchState)[]).every((k) => this.state[k] === patch[k])) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private get me(): string {
    return this.state.me;
  }

  private alias(sender: string): string {
    return this.session.peers().find((p) => p.sender === sender)?.alias ?? "";
  }

  private memberOf(sender: string): string | undefined {
    if (sender === this.me) return this.roster.get().member;
    return this.session.peers().find((p) => p.sender === sender)?.member;
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
  probe(): { tick: number; digest: number; playing: boolean; run?: string } | undefined {
    const c = this.bridge?.watchBridge.session()?.controller;
    if (!c) return undefined;
    const { snapshot, draws } = c.digestInputs();
    return {
      tick: c.tick,
      digest: snapshotDigest(snapshot, draws),
      playing: c.getState().playing,
      run: this.driver?.runId ?? this.state.show?.run,
    };
  }

  setFollowView(on: boolean): void {
    this.set({ followView: on });
    if (on) this.applyView();
    else this.attached?.camera.dispatch({ type: "host.view", view: null });
  }

  // -------------------------------------------------------------- roles and requests

  /** A sender's key in a signed room (this person's own included). */
  private keyOf(sender: string | undefined): string | undefined {
    const signed = this.session.signed;
    if (!signed || !sender) return undefined;
    // Who it is, across a re-key (bindings are per epoch; the person isn't): roles never resolve to someone else.
    return sender === this.me ? signed.key : signed.identityOf(sender);
  }

  /** This person hosts the room: a signed room's roster says so, else this tab's record (cooperative). */
  private get isHosting(): boolean {
    const signed = this.session.signed;
    return signed ? signed.state().host === signed.key : this.roster.get().hosting;
  }

  /** This person can change roles in a signed room (the host, a co-host). */
  private get isLead(): boolean {
    const signed = this.session.signed;
    if (!signed) return false;
    const s = signed.state();
    return s.host === signed.key || s.cohosts.includes(signed.key);
  }

  /**
   * Whether a shared run's message counts (a signed room): from the driver (the roster's while they're here, else
   * the host), or, for the run it drove, from the last driver for a moment after the roster moved on. A handoff
   * counts only to the driver the roster names: one that comes before the roster says so waits for it (a while),
   * and one to anyone else changes nothing, so a handoff never grants anyone the run. Followers' requests for the
   * run (hello) count from anyone. `note`: the run's own channel ends the last driver's moment at its handoff (the
   * control channel only asks).
   */
  private moves(sender: string, m: LiveMessage, note = true): Verdict {
    if (!this.session.signed || m.t === "hello") return "pass";
    const key = this.keyOf(sender);
    if (!key) return "drop";
    const driverKey = this.keyOf(this.rosterNow().driver);
    const grace = this.grace;
    const lingering =
      !!grace && grace.key === key && performance.now() < grace.until && "run" in m && m.run === grace.run;
    if (key !== driverKey && !lingering) return "drop";
    if (m.t !== "handoff") return "pass";
    const to = this.keyOf(m.to);
    if (!to || to === key) return "drop";
    // Handed to whom the roster doesn't (yet) name as driver: it waits for the roster.
    if (to !== driverKey) return "hold";
    if (note && lingering) this.grace = undefined;
    return "pass";
  }

  /** This person's presence: their member id, and the roster while they host. */
  private claim(): void {
    // A signed room's roles are its roster's: presence says nothing of them.
    if (this.session.signed) {
      this.session.setPresence({ member: undefined, host: undefined, cohosts: undefined, driver: undefined });
      return;
    }
    const r = this.roster.get();
    this.session.setPresence(
      r.hosting
        ? {
            member: r.member,
            host: true,
            cohosts: r.cohosts.length ? r.cohosts : undefined,
            driver: r.driver,
          }
        : { member: r.member, host: undefined, cohosts: undefined, driver: undefined },
    );
  }

  /** The roster as presence says it (this person's claim included), else the last one a host said. */
  private rosterNow(): Roster {
    const signed = this.session.signed;
    if (signed) {
      // A signed room: its roster, resolved to the people here (a key's lowest sender id here).
      const s = signed.state();
      const here = new Set(this.session.peers().map((p) => p.sender));
      const senderOf = (key?: string) =>
        key === undefined
          ? undefined
          : key === signed.key
            ? this.me
            : signed.sendersFor(key).find((sender) => here.has(sender));
      const host = senderOf(s.host);
      const cohosts = s.cohosts.map(senderOf).filter((x): x is string => !!x && x !== host);
      return {
        host,
        cohosts,
        driver: senderOf(s.driver ?? s.host) ?? host,
        source: { host: s.host, cohosts: s.cohosts, driver: s.driver },
      };
    }
    const r = this.roster.get();
    const mine = r.hosting
      ? { sender: this.me, member: r.member, host: true as const, cohosts: r.cohosts, driver: r.driver }
      : { sender: this.me, member: r.member };
    const now = rosterOf(mine, this.session.peers(), r);
    // A host's roster, here and said: the one that stands while no host is here.
    if (now.host && !r.hosting) this.roster.update({ ...now.source });
    return now;
  }

  /** Who should drive now: the roster's driver; with no host and no driver here, whoever drives already. */
  private wantDriver(r = this.rosterNow()): string | undefined {
    // A signed room: only the roster's driver (or the host) can drive; nobody else's run would count.
    if (this.session.signed) return r.driver;
    return r.driver ?? (this.driver ? this.me : undefined);
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
    if (yes && this.session.signed) {
      // A signed room: the yes is a signed entry (the answer below only tells the asker).
      this.dropPrompt(prompt.from);
      this.control.send({ t: "answer", to: prompt.from, what: prompt.what, yes });
      this.granted(prompt.from);
      return;
    }
    this.dropPrompt(prompt.from);
    this.control.send({ t: "answer", to: prompt.from, what: prompt.what, yes });
    if (yes) this.granted(prompt.from);
  }

  /**
   * A request was granted (by this person, or by a host or co-host): `to` drives next. The host's roster says so;
   * with no host here, everyone's last roster does (a co-host's yes counts then).
   */
  private granted(to: string): void {
    if (this.session.signed) {
      const key = this.keyOf(to);
      if (key && this.isLead) void this.session.appendRoster("drive", { who: key });
      return;
    }
    const member = this.memberOf(to);
    const r = this.roster.get();
    if (!member) return;
    if (r.hosting) this.setRoster({ driver: member === r.member ? undefined : member });
    else {
      this.roster.update({ driver: member });
      this.peersChanged();
    }
  }

  /** The host's people menu: who drives, co-hosts, who hosts. */
  letDrive(sender: string): void {
    if (this.session.signed) {
      const key = this.keyOf(sender);
      if (key && this.isLead) void this.session.appendRoster("drive", { who: key });
      return;
    }
    const r = this.roster.get();
    const member = this.memberOf(sender);
    if (!r.hosting || !member) return;
    this.setRoster({ driver: member === r.member ? undefined : member });
    this.attach();
  }

  takeBack(): void {
    this.letDrive(this.me);
  }

  setCohost(sender: string, on: boolean): void {
    if (this.session.signed) {
      const key = this.keyOf(sender);
      if (key && sender !== this.me && this.isLead)
        void this.session.appendRoster(on ? "cohost" : "uncohost", { who: key });
      return;
    }
    const r = this.roster.get();
    const member = this.memberOf(sender);
    if (!r.hosting || !member || sender === this.me) return;
    const cohosts = r.cohosts.filter((m) => m !== member);
    this.setRoster({ cohosts: on ? [...cohosts, member] : cohosts });
  }

  /** A signed room's "Can edit": the host or a co-host lets someone who can only view edit. */
  letEdit(sender: string): void {
    const key = this.keyOf(sender);
    if (key && this.isLead) void this.session.appendRoster("admit", { who: key });
  }

  /** Knock-to-join: Remove someone (the host alone; never the host). The room moves to a new epoch. */
  remove(sender: string): void {
    const key = this.keyOf(sender);
    if (!key || sender === this.me || !this.isHosting) return;
    // A room that has been through all its epochs removes no one (nothing is signed): it says to start a new room.
    if (this.session.atRemovalLimit) this.notices.told("removal-limit", "");
    else void this.session.remove(key);
  }

  /** Knock-to-join: "Ask before people join" (the host's or a co-host's switch). */
  setAsk(on: boolean): void {
    if (this.isLead) void this.session.appendRoster("ask", { ask: on });
  }

  /** A signed room's "New people can view only" (the host's or a co-host's switch). */
  setViewOnly(on: boolean): void {
    if (this.isLead) void this.session.appendRoster("policy", { viewOnly: on });
  }

  /** Make someone the host: they get the roster, this person becomes their first co-host. Live stays as it is. */
  makeHost(sender: string): void {
    if (this.session.signed) {
      const key = this.keyOf(sender);
      if (key && sender !== this.me && this.isHosting) void this.session.appendRoster("host", { who: key });
      return;
    }
    const r = this.roster.get();
    const member = this.memberOf(sender);
    if (!r.hosting || !member || sender === this.me) return;
    const driver = r.driver ?? r.member;
    this.control.send({
      t: "host",
      to: sender,
      cohosts: [r.member, ...r.cohosts.filter((m) => m !== member)],
      ...(driver !== member ? { driver } : {}),
    });
    this.resign({ host: member, cohosts: [r.member, ...r.cohosts.filter((m) => m !== member)], driver });
  }

  /** No longer the host (kept across reloads): the roster stands as handed over. */
  private resign(roster: RosterSource): void {
    for (const stop of this.promptTimers.values()) stop();
    this.promptTimers.clear();
    this.roster.update({ hosting: false, host: roster.host, cohosts: roster.cohosts, driver: roster.driver });
    this.claim();
    this.set({ hosting: false, prompts: [] });
    this.peersChanged();
  }

  /** The host's roster changed: kept (across reloads) and said in presence. */
  private setRoster(patch: Partial<RosterSource>): void {
    const r = this.roster.get();
    this.roster.update({ host: r.member, ...patch });
    this.claim();
    this.peersChanged();
  }

  /**
   * Leave room, on purpose: the host hands the room to the earliest co-host, else to whoever has been here longest,
   * and a driver hands the run to whoever drives next. (A dropped connection hands nothing over: followers wait.)
   */
  leaving(): void {
    if (this.disposed) return;
    const r = this.rosterNow();
    const mine = this.roster.get();
    let next = r.driver === this.me ? undefined : r.driver;
    const signed = this.session.signed;
    if (signed && this.isHosting) {
      // A signed room: the handover is a signed entry (sent before the goodbye), and Live with it if the host drove.
      const host = successor(
        { ...r, host: this.me },
        this.session.peers().map((p) => p.sender),
        this.since,
      );
      const key = this.keyOf(host);
      if (host && key) {
        const hostDrove = signed.state().driver === undefined;
        void this.session.appendRoster("host", { who: key });
        if (hostDrove) void this.session.appendRoster("drive", { who: key });
        next = hostDrove ? host : r.driver === this.me ? host : r.driver;
      }
    } else if (signed) {
      if (this.driver) next = r.host;
    } else if (mine.hosting) {
      const host = successor(
        { ...r, host: this.me },
        this.session.peers().map((p) => p.sender),
        this.since,
      );
      const hostMember = host && this.memberOf(host);
      if (host && hostMember) {
        const driver = mine.driver && mine.driver !== hostMember ? mine.driver : undefined;
        this.control.send({
          t: "host",
          to: host,
          cohosts: mine.cohosts.filter((m) => m !== hostMember),
          ...(driver ? { driver } : {}),
        });
        next = (driver && this.session.peers().find((p) => p.member === driver)?.sender) || host;
      }
    } else if (this.driver) next = r.host;
    // Mid-replay the run can't be handed over (its tick isn't the ops'): the next driver starts one of its own.
    if (this.driver?.ready && next && next !== this.me) {
      this.driver.handoff(next);
      this.driver = undefined;
    }
  }

  /** The room's control messages: requests, answers, a handover, a handoff to this person. */
  private received(sender: string, m: LiveMessage): void {
    if (this.disposed) return;
    const r = this.rosterNow();
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
        // A yes counts from the host, or a co-host (the last roster's, while no host is here). A signed room's yes
        // is the roster entry its answerer signed: the answer itself grants nothing.
        if (!this.session.signed && m.yes && (sender === r.host || r.cohosts.includes(sender))) this.granted(m.to);
        return;
      case "host": {
        if (this.session.signed) return;
        // The host hands the room over (Make host, or leaving): this person hosts now. (The old host's presence may
        // already say otherwise: the last roster's host counts.)
        const from = this.memberOf(sender);
        const host = r.host ?? undefined;
        if (m.to !== this.me || (sender !== host && !(host === undefined && from === r.source.host))) return;
        const me = this.roster.get().member;
        this.roster.update({
          hosting: true,
          host: me,
          cohosts: m.cohosts.filter((c) => c !== me),
          driver: m.driver === me ? undefined : m.driver,
        });
        this.claim();
        this.set({ hosting: true });
        this.notices.told("host", "");
        this.peersChanged();
        return;
      }
      case "handoff":
        this.handedAt = performance.now();
        if (m.to === this.me) this.handedTo(m);
        return;
      default:
        return;
    }
  }

  /**
   * The last driver handed its run to this person. Holding that run whole, it comes level with the handoff and drives
   * it on, within HANDOFF_MS; otherwise (still joining, another run, too slow) it starts a run of its own.
   */
  private handedTo(m: Extract<LiveMessage, { t: "handoff" }>): void {
    clearTimeout(this.handoffWait);
    this.handoffWait = undefined;
    const follower = this.follower;
    this.clearTakeover();
    if (!follower || !follower.holds(m.run)) return this.fallback();
    const timer = setTimeout(() => this.fallback(), HANDOFF_MS);
    this.takeover = { follower, run: m.run, tick: m.tick, seq: m.seq, timer };
  }

  private clearTakeover(): void {
    if (this.takeover) clearTimeout(this.takeover.timer);
    this.takeover = undefined;
  }

  /** The handoff can't complete: this person, who's to drive, starts a run of their own (followers rebuild). */
  private fallback(): void {
    this.clearTakeover();
    if (this.wantDriver() !== this.me || this.driver) return;
    if (this.follower) this.stopFollowing(true);
    this.attach();
  }

  private addPrompt(prompt: Prompt): void {
    this.dropPrompt(prompt.from);
    this.set({ prompts: [...this.state.prompts, prompt] });
    // A minute without an answer: declined (the host says so; a co-host's card just goes).
    const timer = setTimeout(() => {
      if (!this.state.prompts.some((p) => p.from === prompt.from)) return;
      if (this.isHosting) this.answer(prompt, false);
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

  /** "Sam is driving" put away (Esc, a click elsewhere, an action). */
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
    const r = this.rosterNow();
    const want = this.wantDriver(r);
    if (this.driver && want && want !== this.me) return this.handOff(want, watched);
    if (!watched) return this.set({ driving: !!this.driver });
    if (want === this.me && !this.driver) {
      if (this.takeover) return;
      // Following the run it's to drive: the last driver hands it over (a while at most), else it starts its own.
      if (this.follower && this.follower.driver !== this.me && this.follower.phase !== "cant-follow") {
        this.handoffWait ??= setTimeout(() => {
          this.handoffWait = undefined;
          this.fallback();
        }, HANDOFF_WAIT_MS);
        return;
      }
      // Not following anyone else (following no one, or itself after a handoff that didn't complete): its own run.
      if (this.follower) this.stopFollowing(true);
      return this.startDriving(watched);
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

  /**
   * Someone else drives from now: the run is handed over at this tick, and this person goes on following it. While
   * this run replays an Inputs change, the handoff waits for the replay to end (its tick isn't the ops' till then).
   */
  private handOff(to: string, watched: WatchedSession | null): void {
    const driver = this.driver;
    if (!driver) return;
    if (!driver.ready && watched) {
      if (this.handing) return;
      const off = watched.controller.subscribe(() => {
        if (!driver.ready) return;
        this.handing?.();
        this.handing = undefined;
        this.attach();
      });
      this.handing = off;
      return;
    }
    this.handing?.();
    this.handing = undefined;
    const snapshot = driver.handoff(to);
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
    this.clearTakeover();
    if (!watched) return;
    this.stopFollowing(true);
    this.startDriving(watched, snapshot);
    this.notices.told("driving", "");
  }

  private detachDriver(): void {
    this.handing?.();
    this.handing = undefined;
    if (this.driver) {
      this.driver.dispose();
      this.driver = undefined;
    }
    if (this.attached) this.watchView(null);
    if (!this.follower) this.attached = undefined;
    this.set({ driving: false });
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
      // A change of this person's own that got past the guard: put back, and they're told who drives.
      () => {
        follower.restore();
        this.showInert(null);
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
        const level = t && t.follower === follower ? follower.levelWith(t.tick, t.seq) : undefined;
        if (level)
          queueMicrotask(() => {
            if (this.takeover === t && this.follower === follower) this.drive(level);
          });
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
    this.guardStop = guardController(watched.controller, () => this.showInert(null));
    this.inertBar();
    this.set({ following: { phase: follower.phase } });
    this.applyView();
  }

  private stopFollowing(quiet = false): void {
    if (!this.follower) return;
    const watched = this.attached;
    this.clearTakeover();
    this.follower.dispose();
    this.follower = undefined;
    this.followStop?.();
    this.followStop = undefined;
    this.inertStop?.();
    this.inertStop = undefined;
    this.guardStop?.();
    this.guardStop = undefined;
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
   * While following, the live bar's controls that change the shared run (play, restart, speed, the simulation, the
   * timeline, traffic) are inert: using one says who drives ("Sam is driving", with Ask to drive and Watch on my
   * own). Its other controls (the event log, traces, Record video, Inputs to look at) work as ever, and so does
   * everything while slow motion (this person's own replay) has the bar.
   */
  private inertBar(): void {
    this.inertStop?.();
    if (typeof document === "undefined") return;
    const types = ["pointerdown", "mousedown", "click", "keydown", "dblclick"] as const;
    const stop = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null;
      // Record video from the start replays the run from its start: that's this person's own run, so they watch on
      // their own from here (recording as it goes records the shared run as it plays).
      if (e.type === "click" && target?.closest(RECORD_START) && this.follower && !this.driver) {
        const fromStart = document.querySelector<HTMLInputElement>(RECORD_FROM_START);
        if (fromStart?.checked) {
          this.notices.told("own", "");
          this.watchOnMyOwn();
        }
        return;
      }
      const control = target?.closest(SHARED_CONTROLS);
      if (!control || !this.follower || this.driver || document.querySelector(SLOW_MOTION)) return;
      const key = e instanceof KeyboardEvent ? e.key : undefined;
      if (key === "Tab" || key === "Escape" || key === "Shift") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click" || key === "Enter" || key === " ") this.showInert(control);
    };
    for (const type of types) document.addEventListener(type, stop, true);
    document.body.dataset.watching = "";
    this.inertStop = () => {
      for (const type of types) document.removeEventListener(type, stop, true);
      delete document.body.dataset.watching;
    };
  }

  /** "Sam is driving", by what was used (the live bar when it was a key or a menu). */
  private showInert(anchor: Element | null): void {
    const at = anchor ?? (typeof document === "undefined" ? null : document.querySelector(LIVE_BAR));
    const rect = at?.getBoundingClientRect();
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
    // Another sender with this tab's member id, and a lower one: this is a copy (a duplicated tab whose check didn't
    // catch it). It takes an id of its own, and gives up any claim to host.
    const mine = this.roster.get();
    if (!this.session.signed && !ownsMember({ sender: this.me, member: mine.member }, peers)) {
      this.roster.update(clonedRoster(mine, (n) => crypto.getRandomValues(new Uint8Array(n))));
      this.claim();
      this.set({ hosting: false });
    }
    const r = this.rosterNow();
    const signed = this.session.signed;
    if (signed) {
      // The driver changed: the last one's messages for its run still count for a moment (its handoff is on its way).
      const key = this.keyOf(r.driver);
      if (this.driverKey && key !== this.driverKey)
        this.grace = { key: this.driverKey, run: this.state.show?.run, until: performance.now() + HANDOFF_MS };
      this.driverKey = key;
      // A handoff that came before the roster named its driver: asked again.
      this.control.release();
      this.channel.release();
      // Newer changes overtook an unfinished handoff: whom this person follows is neither the roster's driver nor the
      // last one (whose handoff may still come), so nothing they'd hear counts. Follow the roster's driver instead,
      // asking it for its run.
      const followedKey = this.keyOf(this.follower?.driver);
      const grace = this.grace;
      const lingering = !!grace && grace.key === followedKey && performance.now() < grace.until;
      const watched = this.attached;
      if (
        this.follower &&
        watched &&
        !this.driver &&
        !this.takeover &&
        followedKey &&
        followedKey !== key &&
        !lingering &&
        r.driver &&
        r.driver !== this.me
      ) {
        this.stopFollowing(true);
        this.startFollowing(watched, r.driver);
      }
      const hosting = this.isHosting;
      if (this.wasHosting === false && hosting) this.notices.told("host", "");
      this.wasHosting = hosting;
    }
    const host = peers.find((p) => p.sender === r.host);
    const followed = this.follower?.driver;
    const driver = (followed && peers.find((p) => p.sender === followed && p.live)) || driverOf(r, peers, !!signed);
    const show = this.driver ? this.state.show : driver?.live;
    const previous = this.state.driver;
    const wasShowing = !!this.state.show && !this.driver;
    // Only what the room's controls use: a cursor moving changes none of it.
    const key = JSON.stringify([
      host?.sender,
      host?.alias,
      driver?.sender,
      driver?.alias,
      driver?.view,
      show,
      r,
      peers.map((p) => [p.sender, p.alias]),
      signed && [signed.state().viewOnly, this.session.canEdit, [...signed.state().editors].length],
    ]);
    if (key !== this.snapshotKey) {
      this.snapshotKey = key;
      this.set({
        host,
        driver,
        show,
        roster: r,
        hosting: this.isHosting,
        cohosting: r.cohosts.includes(this.me),
        lead: this.isLead,
        viewOnly: !!signed?.state().viewOnly,
        canEdit: this.session.canEdit,
        viewers: signed ? peers.filter((p) => !signed.isEditor(this.keyOf(p.sender))).map((p) => p.sender) : [],
      });
    }
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

/** The live bar's controls that change the shared run (a follower's are inert), and slow motion's bar. */
const SHARED_CONTROLS = [
  "live-play",
  "live-restart",
  "live-speed",
  "live-sim-picker",
  "live-step",
  "live-traffic",
  "live-timeline",
  "live-done",
  "live-edit-sims",
]
  .map((id) => `[data-testid="${id}"]`)
  .join(", ");
const SLOW_MOTION = '[data-testid="slowmo-chip"]';
const RECORD_START = '[data-testid="record-start"]';
const RECORD_FROM_START = '[data-testid="record-opt-from-start"]';

/** The controller's methods that change a run, and what each returns when a follower's call is turned away. */
const RUN_OPS: Record<string, unknown> = {
  setPlaying: undefined,
  togglePlaying: undefined,
  setSpeed: undefined,
  step: undefined,
  seek: undefined,
  resume: undefined,
  restart: false,
  selectSimulation: "rejected",
  setTraffic: undefined,
  setInputs: undefined,
  setBase: undefined,
  commitInputs: undefined,
  updateDiagram: "none",
  inject: undefined,
  injectAtSources: [],
  sendOne: undefined,
  setFault: undefined,
  setNodeStatus: undefined,
  setNodeProps: undefined,
};
/** Playback a follower's own slow motion uses while it holds the run (its own replay, put back exactly after). */
const PLAYBACK = new Set(["setPlaying", "togglePlaying", "setSpeed"]);

/**
 * While following, this person's own changes to the run are turned away before they reach it (a key, a menu, the
 * Inputs panel): `refused` says who drives instead. The host's ops (`applyRemote`) and the document's sync (`as`) go
 * through, and so does the playback slow motion uses while it holds the run. Returns the guard's removal.
 */
function guardController(controller: LiveController, refused: () => void): () => void {
  const own = controller as unknown as Record<string, (...args: unknown[]) => unknown>;
  let inside = 0;
  const through = (name: string) => {
    const method = own[name].bind(controller);
    own[name] = (...args: unknown[]) => {
      inside++;
      try {
        return method(...args);
      } finally {
        inside--;
      }
    };
  };
  through("as");
  through("applyRemote");
  // Slow motion gives the run back (hold off) and puts its playback as it was, in one go: that's its own too.
  let releasing = false;
  const hold = own.hold.bind(controller);
  own.hold = (on: unknown) => {
    hold(on);
    if (on) return;
    releasing = true;
    queueMicrotask(() => (releasing = false));
  };
  for (const [name, refusal] of Object.entries(RUN_OPS)) {
    const method = own[name].bind(controller);
    own[name] = (...args: unknown[]) => {
      if (inside > 0) return method(...args);
      // Slow motion's own playback: not a change to the shared run (nor this person taking it over).
      if (PLAYBACK.has(name) && (controller.isHeld || releasing)) return controller.as("sync", () => method(...args));
      // Slow motion pauses just before it holds the run: that's its own, not a change to the shared run.
      if (PLAYBACK.has(name))
        queueMicrotask(() => {
          if (!controller.isHeld) refused();
        });
      else refused();
      return refusal;
    };
  }
  return () => {
    for (const name of ["as", "applyRemote", "hold", ...Object.keys(RUN_OPS)]) Reflect.deleteProperty(own, name);
  };
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
    getSnapshot(): { open?: { session: CollabSession; roster: RoomRoster } };
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
    current = open ? new WatchTogether(open.session, open.roster, target, notices) : undefined;
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
