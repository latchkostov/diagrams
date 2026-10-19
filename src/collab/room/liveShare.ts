import type { DiagramFile, Simulation } from "../../model/types";
import type { LiveController } from "../../live/controller";
import type { LiveOp, LogEntry } from "../../live/controlLog";
import { createFollowClock, TICK_MS, type SimClock } from "../../live/simClock";
import type { LiveInputs } from "../../live/capacityModel";
import type { WatchedSession } from "../../live/watchBridge";
import { snapshotDigest } from "../../sim/digest";
import { ENGINE_VERSION } from "../../sim/version";

// Only types and small modules nothing in the live view's chunk imports come from src/live and src/sim here: the
// room's chunk stays apart from the live view's (it reaches the running session through src/live/watchBridge.ts).

const tickTime = (tick: number) => tick * TICK_MS;

// Watch together (shared Live design, P2): the room's host drives Live and everyone who chooses Watch follows the
// same run in lockstep, about half a second behind. Nothing streams the simulation: each follower runs the same
// engine (bit-identical in every browser, P1) and the host sends what changes it, as the control log's ops on their
// ticks, with a clock beacon twice a second and a state digest every few simulated seconds.
//
// Every run starts the same way for everyone, whether it's a new run (Restart, another simulation, Play after the
// run ended) or someone joining one under way: the run's start (its settings and the diagram's node props then),
// its log so far, and the host's clock with the last slice ("bootstrap"). A follower rebuilds from that and catches
// up; it rebuilds the same way when its digest differs, or when it finds an op missing (it asks for the run again).
// Twice drifted on one run, it watches on its own.
//
// A follower applies the host's ops through its controller's own remote-op API (`applyRemote`), which logs them as
// the host's: only this person's own changes end following.
//
// Cooperative: frames are the room's (encrypted, any member could have sent them), and followers trust the host
// presence names. Signed roles come later (P4). What arrives is checked in full first (./liveWire.ts), and what a
// follower keeps of a run is bounded.

/** How far behind the host a follower plays: room for the network's jitter, so ops arrive before their tick. */
export const PLAYOUT_MS = 500;
/** No beacon from the host for this long: their connection dropped, and followers wait. */
export const HOST_SILENT_MS = 3_000;
/** Beacons a second, and how often (in simulated time) the host sends a digest. */
export const BEACON_MS = 500;
export const DIGEST_EVERY_TICKS = 500;
/** A follower waiting for the run (or for an op a digest names) asks again after this long. */
export const ASK_MS = 2_500;
/** Asks in a row without getting the run, or rebuilds of one run, before a follower watches on its own. */
export const MAX_RESYNCS = 5;
/** A run's log is sent in slices of about this many bytes of JSON (each one frame, or a few parts). */
const SLICE_BYTES = 12 * 1024;
/** A run whose log has grown past either of these isn't sent any more (the next run is); nor is it kept. */
export const MAX_RUN_BYTES = 1024 * 1024;
export const MAX_RUN_ENTRIES = 20_000;
/** Digests a follower keeps waiting for their tick, at most. */
export const MAX_DIGESTS = 32;
/** One peer's requests for the whole run: at most one per this long (a follower asks every ASK_MS). */
const REQUEST_MS = 2_000;
/** A follower's catch-up advances this many ticks at a time, checking its deadline between them. */
export const CATCH_UP_TICKS = 10;
/** And yields to the page after about this many ms. */
export const CATCH_UP_SLICE_MS = 8;
/** A seek that runs at most this much simulated time at once is applied as it is; longer, it goes in slices. */
const NEAR_SEEK_MS = 5_000;

export interface RunStart {
  engine: string;
  /** The selected simulation (its saved definition, or a draft's), or null for free play. */
  simulation: Simulation | null;
  traffic: boolean;
  inputs: LiveInputs;
  speed: number;
  title: string;
  /** The diagram's node props (by node id) as the run started: the log's edits apply to these, on their ticks. */
  props: Record<string, Record<string, unknown>>;
}

export type WireEntry = Pick<LogEntry, "seq" | "tick" | "op">;
export interface HostClock {
  tick: number;
  /** The run's clock moves (playing, not at a pausing note, not finished). */
  playing: boolean;
  speed: number;
  /** The host's play button: on (playing, or waiting at a note to go on), or paused. */
  on: boolean;
}

/**
 * The Live protocol's version, sent with every run's start: a follower on another one (an older or newer page) can't
 * read the run, and says so (reload) rather than asking for it again and again.
 */
export const LIVE_PROTOCOL = 2;

export type LiveMessage =
  | { t: "start"; v: number; run: string; start: RunStart }
  /** A start on another protocol version (./liveWire.ts says so before reading the rest). */
  | { t: "incompatible"; run: string }
  | { t: "log"; run: string; entries: WireEntry[]; done: boolean; clock?: HostClock }
  | { t: "op"; run: string; entry: WireEntry }
  | ({ t: "beacon"; run: string } & HostClock)
  | { t: "digest"; run: string; tick: number; seq: number; hash: number }
  | { t: "stop"; run: string }
  | { t: "hello" };

/** What became of a message: sent; too large to send at all; or not sent now (the room's closed, or not allowed). */
export type SendResult = "sent" | "too-large" | "refused";

/** The room's live channel, as this module sees it (./watch.ts over the session). */
export interface LiveChannel {
  send(message: LiveMessage, to?: string): SendResult;
  onMessage(listener: (sender: string, from: string, message: LiveMessage) => void): () => void;
}

/** Wall time and timers: the page's, or a test's. */
export interface LiveTimers {
  now(): number;
  every(ms: number, fn: () => void): () => void;
  soon(fn: () => void): () => void;
}

export const pageTimers: LiveTimers = {
  now: () => performance.now(),
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  soon(fn) {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  },
};

const digestOf = (c: LiveController) => {
  const { snapshot, draws } = c.digestInputs();
  return snapshotDigest(snapshot, draws);
};

const titleOf = (sim: Simulation | null) => sim?.title ?? "Free play";
const sizeOf = (e: WireEntry) => JSON.stringify(e).length;
/** Changes a seek back doesn't undo: the host's run is rebuilt with them in place. */
const PERSISTENT = new Set<LiveOp["kind"]>(["patch", "commit", "inputs", "base"]);
/** Entries in one slice of a run's log, at most (./liveWire.ts takes up to 500). */
const ENTRIES_PER_SLICE = 400;

/**
 * An entry as it goes on the wire. A diagram edit's removed keys are `undefined` in its patch, which JSON drops:
 * they travel as null (./liveWire.ts allows it there) and come back as undefined (`fromWire`).
 */
function wire({ seq, tick, op }: WireEntry): WireEntry {
  if (op.kind !== "patch") return { seq, tick, op };
  const patches = Object.fromEntries(
    Object.entries(op.patches).map(([id, patch]) => [
      id,
      Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v])),
    ]),
  );
  return { seq, tick, op: { ...op, patches } as LiveOp };
}

function fromWire(op: LiveOp): LiveOp {
  if (op.kind !== "patch") return op;
  const patches = Object.fromEntries(
    Object.entries(op.patches).map(([id, patch]) => [
      id,
      Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v])),
    ]),
  );
  return { ...op, patches } as LiveOp;
}

/** The diagram's node props, by node id. */
const propsOf = (d: DiagramFile) => Object.fromEntries(d.nodes.map((n) => [n.id, n.props ?? {}]));

/** Whether the run's clock moves: playing, not at a pausing note, not finished. */
function playingNow(c: LiveController): boolean {
  const run = c.runNow;
  return c.isPlaying && !run?.waiting && !run?.done;
}

/** The host's clock now (as the controller is, published or not: an op's listener hears it first). */
function clockOf(c: LiveController): HostClock {
  return { tick: c.tick, playing: playingNow(c), speed: c.settings.speed, on: c.isPlaying };
}

// ---------------------------------------------------------------- the host's side

/** What the host's run tells the room's presence: absent while there's nothing to watch. */
export interface DriverShow {
  run: string;
  title: string;
  playing: boolean;
}

/**
 * How the controller's current run started, when its log still says (the host's session usually joins the room as
 * it mounts, its log a few ops long): the defaults for a session's first run, or the run's first op (another
 * simulation, Restart, an edit, Play after the end). Undefined when it can't be told (an Inputs change since, of
 * which the log keeps only the latest; a changed saved definition, a saved Inputs or a diagram edit, which the
 * diagram now includes): that run isn't shared, the next one is.
 */
export function runOrigin(c: LiveController): RunStart | undefined {
  const log = c.controlLog();
  const first = log[0];
  const fresh = c.runId === 1;
  if (!fresh && !first) return undefined;
  const inputs = log.filter((e) => e.op.kind === "inputs");
  if (inputs.length > 1 || (inputs[0] && inputs[0].tick > 0)) return undefined;
  if (log.some((e) => e.op.kind === "patch" || e.op.kind === "commit")) return undefined;
  if (!fresh && log.some((e) => e.op.kind === "base")) return undefined;
  const state = c.getState();
  const traffic = log.find((e) => e.op.kind === "traffic");
  const select = !fresh && first.op.kind === "select" ? first.op : undefined;
  return {
    engine: ENGINE_VERSION,
    simulation: select ? select.simulation : fresh ? null : state.simulation,
    // Traffic as it was before its first toggle (a toggle on tick 0 makes the start's value moot).
    traffic: fresh ? false : traffic?.op.kind === "traffic" ? !traffic.op.on : state.traffic,
    // A session's first run, or another simulation, starts with no what-ifs (any since are in the log).
    inputs: fresh || select ? { props: {}, rates: {} } : state.inputs,
    speed: fresh ? 1 : state.speed,
    title: titleOf(select ? select.simulation : fresh ? null : state.simulation),
    props: propsOf(c.currentDiagram),
  };
}

/**
 * The host's Live run, shared: each op as it's logged, beacons, digests, and the run from its start for every new
 * run and anyone who asks. A run too large to send stops being shown, and says so (onError); the next one is.
 */
export class LiveDriver {
  private run?: { id: string; number: number; start: RunStart; entries: WireEntry[]; bytes: number; broken: boolean };
  /** The controller's run this driver is on (one it couldn't describe isn't shared: `run` is then absent). */
  private number: number;
  private nextDigest = DIGEST_EVERY_TICKS;
  private readonly nonce = Math.random().toString(36).slice(2, 10);
  /** Runs shared so far: a run shared afresh (a seek back that rewrote it) gets an id of its own. */
  private shared = 0;
  private readonly stops: (() => void)[] = [];
  private readonly requests = new Map<string, number>();
  private readonly asking = new Set<string>();
  private answer?: () => void;
  private lastShow = "";

  constructor(
    private readonly channel: LiveChannel,
    private readonly watched: WatchedSession,
    private readonly onShow: (show: DriverShow | null) => void,
    private readonly onError: (problem: "too-large") => void = () => {},
    private readonly timers: LiveTimers = pageTimers,
  ) {
    const c = watched.controller;
    this.number = c.runId;
    const origin = runOrigin(c);
    if (origin) this.begin(c.runId, origin, c.controlLog());
    this.stops.push(
      c.onOp((entry) => this.logged(entry)),
      channel.onMessage((_sender, from, message) => {
        if (message.t === "hello") this.asked(from);
      }),
      timers.every(BEACON_MS, () => this.beat()),
    );
  }

  dispose(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.answer?.();
    this.answer = undefined;
    if (this.run && !this.run.broken) this.channel.send({ t: "stop", run: this.run.id });
    this.run = undefined;
    this.show();
  }

  /** The run this host shares now (its id), if any. */
  get runId(): string | undefined {
    return this.run && !this.run.broken ? this.run.id : undefined;
  }

  private begin(number: number, start: RunStart, entries: readonly WireEntry[]): void {
    const copies = entries.map(wire);
    this.number = number;
    this.run = {
      id: `${this.nonce}.${number}.${++this.shared}`,
      number,
      start,
      entries: copies,
      bytes: copies.reduce((n, e) => n + sizeOf(e), 0),
      broken: false,
    };
    this.nextDigest = this.watched.controller.tick + DIGEST_EVERY_TICKS;
    // Everyone gets a new run from its start (a follower on the last one starts over with it).
    this.bootstrap();
    this.show();
  }

  /** The run's start as the controller is now (its published state isn't updated yet when an op starts a run). */
  private startNow(select?: Simulation | null): RunStart {
    const c = this.watched.controller;
    const state = c.settings;
    const simulation = select !== undefined ? select : state.simulation;
    return {
      engine: ENGINE_VERSION,
      simulation,
      traffic: state.traffic,
      // Another simulation starts with no what-ifs; a restart or an edit keeps them.
      inputs: select !== undefined ? { props: {}, rates: {} } : state.inputs,
      speed: state.speed,
      title: titleOf(simulation),
      props: propsOf(c.currentDiagram),
    };
  }

  private logged(entry: LogEntry): void {
    if (entry.run !== this.number) {
      // A new run (Restart, another simulation, an edit, Play after the end): it starts from the state just before
      // this op, and everyone gets it from its start.
      this.begin(entry.run, this.startNow(entry.op.kind === "select" ? entry.op.simulation : undefined), [entry]);
      return;
    }
    const run = this.run;
    if (!run || run.broken) return;
    // A seek back cut the controller's log there: so does this copy.
    if (entry.op.kind === "seek") {
      const cut = run.entries.filter((e) => e.tick > entry.tick);
      run.entries = run.entries.filter((e) => e.tick <= entry.tick);
      // It cut a change that stays (a diagram edit, saved or what-if Inputs, a saved definition): the host's run
      // went back with it in place, from the start, which this run's start no longer describes. It's shared
      // afresh: started as the host is now, with the log since (its edits already in that start).
      if (cut.some((e) => PERSISTENT.has(e.op.kind))) {
        const log = this.watched.controller.controlLog().filter((e) => e.op.kind !== "patch" && e.op.kind !== "commit");
        return this.begin(this.number, this.startNow(), log);
      }
    }
    const copy = wire(entry);
    run.entries.push(copy);
    run.bytes += sizeOf(copy);
    if (run.bytes > MAX_RUN_BYTES || run.entries.length > MAX_RUN_ENTRIES) return this.broke();
    // Not sent now (the room busy or closed): followers find it missing and ask for the run.
    if (this.channel.send({ t: "op", run: run.id, entry: copy }) === "too-large") return this.broke();
    if (entry.op.kind === "play" || entry.op.kind === "resume") this.show();
  }

  /**
   * A follower asked for the run: at most once per peer every REQUEST_MS. Asks together (several joining at once)
   * get one answer, to everyone; a follower already on the run ignores what it didn't ask for.
   */
  private asked(from: string): void {
    const now = this.timers.now();
    const last = this.requests.get(from);
    if (last !== undefined && now - last < REQUEST_MS) return;
    this.requests.set(from, now);
    this.asking.add(from);
    this.answer ??= this.timers.soon(() => {
      this.answer = undefined;
      const peers = [...this.asking];
      this.asking.clear();
      this.bootstrap(peers.length === 1 ? peers[0] : undefined);
    });
  }

  /** The run from its start, to everyone or one peer: its start, its log in slices by size, the clock with the last. */
  private bootstrap(to?: string): void {
    const run = this.run;
    if (!run || run.broken) return;
    const send = (message: LiveMessage) => {
      const result = this.channel.send(message, to);
      if (result === "too-large") this.broke();
      return result === "sent";
    };
    if (!send({ t: "start", v: LIVE_PROTOCOL, run: run.id, start: run.start })) return;
    let slice: WireEntry[] = [];
    let bytes = 0;
    for (const e of run.entries) {
      const size = sizeOf(e);
      if (slice.length && (bytes + size > SLICE_BYTES || slice.length >= ENTRIES_PER_SLICE)) {
        if (!send({ t: "log", run: run.id, entries: slice, done: false })) return;
        slice = [];
        bytes = 0;
      }
      slice.push(e);
      bytes += size;
    }
    send({ t: "log", run: run.id, entries: slice, done: true, clock: clockOf(this.watched.controller) });
  }

  /** A run that can't be described isn't shared (the next one is): followers are told it stopped. */
  private withdraw(number: number): void {
    if (this.run && !this.run.broken) this.channel.send({ t: "stop", run: this.run.id });
    this.run = undefined;
    this.number = number;
    this.show();
  }

  /** This run can't be sent (too large): it's no longer shown; the next run is. */
  private broke(): void {
    if (!this.run || this.run.broken) return;
    this.run.broken = true;
    this.channel.send({ t: "stop", run: this.run.id });
    this.show();
    this.onError("too-large");
  }

  private beat(): void {
    const c = this.watched.controller;
    // A new run with no op yet (free play starts over when its Inputs change): nothing has changed it since it
    // started (every change is an op), so it's shared from its start with the settings it has now.
    if (c.runId !== this.number) {
      if (!c.controlLog().length) this.begin(c.runId, this.startNow(), []);
      else this.withdraw(c.runId);
    }
    const run = this.run;
    if (!run || run.broken) return;
    // Replaying (an Inputs change rewrites the run from its start), or about to: the engine isn't at the logged
    // ops' state, so nothing's said about its clock or state meanwhile.
    const last = run.entries.at(-1);
    if (c.busy || (last && c.tick < last.tick)) return;
    const clock = clockOf(c);
    this.channel.send({ t: "beacon", run: run.id, ...clock });
    if (clock.tick >= this.nextDigest) {
      const seq = last?.seq ?? 0;
      this.channel.send({ t: "digest", run: run.id, tick: clock.tick, seq, hash: digestOf(c) });
      this.nextDigest = clock.tick + DIGEST_EVERY_TICKS;
    }
    this.show();
  }

  private show(): void {
    const run = this.run;
    const show =
      run && !run.broken ? { run: run.id, title: run.start.title, playing: playingNow(this.watched.controller) } : null;
    const key = JSON.stringify(show);
    if (key === this.lastShow) return;
    this.lastShow = key;
    this.onShow(show);
  }
}

// ---------------------------------------------------------------- a follower's side

export type FollowPhase =
  | "joining" // asked for the host's run (or for it again), waiting for it
  | "catching-up" // replaying the run so far
  | "following" // in lockstep
  | "host-dropped" // no beacon from the host: holding still
  | "cant-follow"; // drifted twice on one run (or can't get it): watch on your own instead

export interface FollowStatus {
  phase: FollowPhase;
  /** While catching up: how far (ms of simulated time) of how far. */
  progress?: { at: number; of: number };
  /** Why it can't follow, when it's more than drift: the host's engine differs, or the run is too large to keep. */
  reason?: "version" | "too-large";
}

interface FollowedRun {
  id: string;
  start: RunStart;
  /** The host's log as it is (a seek back cut it, as it cut the host's), in order. */
  entries: WireEntry[];
  /** The run's log so far has arrived (its last slice, with the host's clock). */
  complete: boolean;
  /** Received of this run so far (bootstrap and ops, whatever a seek cut since): bounded. */
  bytes: number;
  count: number;
}

/** The diagram with the run's starting node props in place of its own (its structure is the room's). */
function withBaseline(d: DiagramFile, props: Record<string, Record<string, unknown>>): DiagramFile {
  return { ...d, nodes: d.nodes.map((n) => (props[n.id] ? { ...n, props: props[n.id] } : n)) };
}

/** Ops that rewrite the run's history: the controller replays it; that replay runs now, not after its pause. */
const REWRITES = new Set<LiveOp["kind"]>(["inputs", "base", "commit"]);

/**
 * Follows the host's run. While following, the bridge's pace hook moves this browser's run toward the host's tick
 * minus the playout delay (src/live/simClock.ts), stopping exactly on each op's tick to apply it, and on each
 * digest's tick to compare. Any op this person makes on their own ends following (onLocal).
 */
export class LiveFollower {
  private run?: FollowedRun;
  /** The next entry to apply, and the last applied one's seq. */
  private next = 0;
  private appliedSeq = 0;
  /** The highest seq received on this run: the host's ops come one after another, so a jump means one's missing. */
  private seen = 0;
  private digests: { tick: number; seq: number; hash: number; at: number }[] = [];
  private beacon?: HostClock & { at: number };
  /** Asked for the run, and not had it whole yet. */
  private asking = false;
  /** An op is missing (the next one received skipped it): holding still, asking for the run. */
  private missing = false;
  private lastAsk = -Infinity;
  private mismatches = 0;
  private resyncs = 0;
  private rebuilds = 0;
  private status: FollowStatus = { phase: "joining" };
  private announced = false;
  private disposed = false;
  private cancelCatchUp?: () => void;
  private readonly clock: SimClock;
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly channel: LiveChannel,
    private readonly watched: WatchedSession,
    /** The host's sender id (presence's). */
    private readonly host: string,
    private readonly onStatus: (status: FollowStatus) => void,
    /** This person changed the run themselves (they watch on their own from here). */
    private readonly onLocal: () => void,
    private readonly timers: LiveTimers = pageTimers,
  ) {
    this.clock = createFollowClock(() => this.target());
    this.stops.push(
      channel.onMessage((sender, _from, message) => {
        if (sender === this.host) this.receive(message);
      }),
      // Only this person's own changes: the host's (applyRemote) and the document's sync are neither.
      watched.controller.onOp((_entry, origin) => {
        if (origin === "user") this.onLocal();
      }),
      timers.every(BEACON_MS, () => this.check()),
    );
    this.publish({ phase: "joining" });
    this.ask();
  }

  dispose(): void {
    this.disposed = true;
    this.stopCatchUp();
    for (const stop of this.stops.splice(0)) stop();
  }

  get phase(): FollowPhase {
    return this.status.phase;
  }

  private get c(): LiveController {
    return this.watched.controller;
  }

  /** The frame's pace: what the run may advance now (0: hold still). */
  pace(proposedMs: number): number {
    if (this.status.phase === "host-dropped" && this.fresh()) this.publish({ phase: "following" });
    if (this.status.phase !== "following" || this.missing) return 0;
    if (!this.fresh()) {
      this.publish({ phase: "host-dropped" });
      return 0;
    }
    if (!this.applyDue()) return 0;
    return this.clock.pace(proposedMs, { tick: this.c.tick, speed: this.c.getState().speed });
  }

  /** Twice a second: a wait that's gone on too long (for the run, or for an op a digest names) asks again. */
  private check(): void {
    if (this.status.phase === "cant-follow") return;
    const now = this.timers.now();
    if (this.asking || this.missing) {
      if (now - this.lastAsk >= ASK_MS) this.resync();
      return;
    }
    const d = this.digests[0];
    if (d && d.seq > this.seen && now - d.at >= ASK_MS) this.resync();
  }

  // -------------------------------------------------------------- messages

  private receive(m: LiveMessage): void {
    if (this.status.phase === "cant-follow") return;
    switch (m.t) {
      case "incompatible":
        return this.fail("version");
      case "start":
        if (m.start.engine !== ENGINE_VERSION) return this.fail("version");
        // This run again, not asked for: someone else's answer.
        if (m.run === this.run?.id && !this.asking) return;
        // Another run, or this one again as asked: rebuilt from it.
        this.reset(
          { id: m.run, start: m.start, entries: [], complete: false, bytes: 0, count: 0 },
          m.run !== this.run?.id,
        );
        return;
      case "log": {
        const run = this.run;
        if (m.run !== run?.id || run.complete) return;
        for (const e of m.entries) {
          // The host's log as it is now: in order, with gaps where a seek back cut it (and older Inputs went).
          if (e.seq <= this.seen) continue;
          if (!this.keep(e)) return;
          run.entries.push(e);
          this.seen = e.seq;
        }
        if (m.done && m.clock) {
          run.complete = true;
          this.asking = false;
          // The host's clock as the log ends: the catch-up heads for it.
          this.beacon = { ...m.clock, at: this.timers.now() };
          this.rebuild();
        }
        return;
      }
      case "op":
        if (m.run !== this.run?.id) return this.unfamiliar();
        // While the run arrives, its ops so far are in its log, and those after come after its last slice.
        if (this.run.complete) this.add(m.entry);
        return;
      case "beacon":
        if (m.run !== this.run?.id) return this.unfamiliar();
        if (!this.run.complete) return;
        this.beacon = { tick: m.tick, playing: m.playing, speed: m.speed, on: m.on, at: this.timers.now() };
        return;
      case "digest": {
        if (m.run !== this.run?.id) return this.unfamiliar();
        // Bounded, and each once: a digest already waiting (the same tick and op) isn't kept again.
        if (this.digests.some((d) => d.tick === m.tick && d.seq === m.seq)) return;
        if (this.digests.length >= MAX_DIGESTS) this.digests.shift();
        this.digests.push({ tick: m.tick, seq: m.seq, hash: m.hash, at: this.timers.now() });
        this.digests.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
        return;
      }
      case "stop":
        if (m.run === this.run?.id) {
          this.beacon = undefined;
          if (this.status.phase === "following") this.publish({ phase: "host-dropped" });
        }
        return;
      default:
        return;
    }
  }

  /** The host is on a run this browser hasn't been told about (it restarted while the connection was down). */
  private unfamiliar(): void {
    if (!this.asking) this.resync();
  }

  /** Counts an entry against the run's bounds: false (and following ends) past them. */
  private keep(e: WireEntry): boolean {
    const run = this.run;
    if (!run) return false;
    run.bytes += sizeOf(e);
    run.count++;
    if (run.bytes <= MAX_RUN_BYTES && run.count <= MAX_RUN_ENTRIES) return true;
    this.fail("too-large");
    return false;
  }

  /** Starts over on `run`: every per-run state reset, holding still until it's rebuilt. */
  private reset(run: FollowedRun, fresh: boolean): void {
    this.stopCatchUp();
    this.run = run;
    this.next = 0;
    this.appliedSeq = 0;
    this.seen = 0;
    this.digests = [];
    this.beacon = undefined;
    // Asking until its last slice arrives (a new run's comes right after its start).
    this.asking = true;
    this.missing = false;
    this.lastAsk = this.timers.now();
    if (fresh) {
      this.mismatches = 0;
      this.rebuilds = 0;
    }
    this.publish({ phase: "joining" });
  }

  /**
   * One of the host's ops as it's logged. One missing before it (a frame lost while a connection dropped): ask for
   * the run. A seek is handled as it arrives: the branch it abandoned (ops logged past its target) goes, as it went
   * from the host's log, with that branch's digests, so nothing waits behind them.
   */
  private add(e: WireEntry): void {
    const run = this.run;
    if (!run || e.seq <= this.seen) return;
    if (e.seq !== this.seen + 1) {
      this.missing = true;
      return this.resync();
    }
    if (!this.keep(e)) return;
    this.seen = e.seq;
    if (e.op.kind === "seek") {
      const kept: WireEntry[] = [];
      let next = 0;
      run.entries.forEach((x, i) => {
        if (x.tick > e.tick) return;
        kept.push(x);
        if (i < this.next) next++;
      });
      run.entries = kept;
      this.next = next;
      this.digests = this.digests.filter((d) => d.tick <= e.tick || d.seq >= e.seq);
    }
    run.entries.push(e);
  }

  /** Asks the host for the run (again), at most every ASK_MS; MAX_RESYNCS asks in a row unanswered, it gives up. */
  private resync(): void {
    if (this.timers.now() - this.lastAsk < ASK_MS) return;
    if (++this.resyncs > MAX_RESYNCS) return this.fail();
    this.stopCatchUp();
    this.ask();
    this.publish({ phase: "joining" });
  }

  private ask(): void {
    this.asking = true;
    this.lastAsk = this.timers.now();
    this.channel.send({ t: "hello" });
  }

  private fail(reason?: FollowStatus["reason"]): void {
    this.stopCatchUp();
    this.asking = false;
    this.publish(reason ? { phase: "cant-follow", reason } : { phase: "cant-follow" });
  }

  // -------------------------------------------------------------- lockstep

  private fresh(): boolean {
    return !!this.beacon && this.timers.now() - this.beacon.at < HOST_SILENT_MS;
  }

  /** The host's tick now, extrapolated from its last beacon, less the playout delay (none once it's paused). */
  private hostTick(): number {
    const b = this.beacon;
    if (!b) return 0;
    if (!b.playing) return b.tick;
    const since = ((this.timers.now() - b.at) * b.speed) / TICK_MS;
    const delay = (PLAYOUT_MS * b.speed) / TICK_MS;
    return Math.max(0, Math.floor(b.tick + since - delay));
  }

  /** Where this frame may take the run: the host's tick less the delay, but never past the next op or digest. */
  private target(): number | undefined {
    let goal = this.hostTick();
    const e = this.run?.entries[this.next];
    if (e && e.op.kind !== "seek") goal = Math.min(goal, e.tick);
    if (this.digests.length) goal = Math.min(goal, this.digests[0].tick);
    return goal;
  }

  /** A seek whose synchronous work is small (judged by the tick the host's seek reached, which is where it goes). */
  private near(e: WireEntry): boolean {
    return this.c.seekCost(tickTime(e.tick)) <= NEAR_SEEK_MS;
  }

  /**
   * Applies the ops due on this tick, in order, comparing a digest at its point among them. False when the run
   * can't go on as it is (it's replaying an Inputs change, rebuilding or catching up).
   */
  private applyDue(): boolean {
    const run = this.run;
    if (!run) return false;
    for (;;) {
      if (this.c.busy) return false;
      if (!this.checkDigest()) return false;
      const e = run.entries[this.next];
      if (!e) return true;
      if (e.op.kind === "seek") {
        if (!this.near(e)) {
          // Far ahead: there in slices (catching up), and applied there. Far back: replayed from the start.
          if (e.tick > this.c.tick) this.catchUp();
          else this.rebuild();
          return false;
        }
      } else {
        if (e.tick > this.c.tick) return true;
        // This browser passed the op's tick before it arrived: the run as it is can't take it.
        if (e.tick < this.c.tick) {
          this.rebuild();
          return false;
        }
      }
      this.applyEntry(e);
    }
  }

  /** One of the host's ops, through the controller's remote-op API (logged as the host's). */
  private applyEntry(e: WireEntry): void {
    this.next++;
    this.appliedSeq = e.seq;
    try {
      this.c.applyRemote({ tick: e.tick, op: fromWire(e.op) });
      if (REWRITES.has(e.op.kind)) this.c.flush();
    } catch {
      // Refused here as it can't have been there (a budget, a removed node): the digest will say if it matters.
    }
  }

  /** The digest at this tick, once the ops it covers are applied; a mismatch rebuilds, a second one gives up. */
  private checkDigest(): boolean {
    while (this.digests.length) {
      const d = this.digests[0];
      if (d.tick < this.c.tick) {
        this.digests.shift();
        continue;
      }
      if (d.tick > this.c.tick || this.appliedSeq < d.seq || this.c.busy) return true;
      this.digests.shift();
      if (digestOf(this.c) === d.hash) continue;
      if (++this.mismatches >= 2) {
        this.fail();
        return false;
      }
      this.rebuild();
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------- the run from its start

  /** This browser's run from the host's run's start, then caught up through its log, in slices. */
  private rebuild(): void {
    const run = this.run;
    if (!run?.complete) return this.resync();
    this.stopCatchUp();
    if (++this.rebuilds > MAX_RESYNCS) return this.fail();
    const c = this.c;
    const s = run.start;
    try {
      c.as("remote", () => {
        // The room's diagram, with its node props as they were when the run started: the log's edits follow.
        c.updateDiagram(withBaseline(this.watched.getDiagram(), s.props));
        c.setTraffic(s.traffic);
        c.selectSimulation(s.simulation);
        if (hasInputs(s.inputs)) c.setInputs(s.inputs);
        c.setSpeed(s.speed);
        // Restart builds with the inputs, as the host's run was built.
        c.restart();
        c.flush();
      });
    } catch {
      return this.fail();
    }
    this.next = 0;
    this.appliedSeq = 0;
    this.digests = this.digests.filter((d) => d.tick >= c.tick);
    this.catchUp();
  }

  /**
   * Plays the log up to where the host is (less the delay), or to a far seek's target, a few ticks at a time with
   * the deadline checked between them, yielding to the page every CATCH_UP_SLICE_MS (the run published once a
   * slice); then follows, playing or paused as the host is.
   */
  private catchUp(): void {
    this.cancelCatchUp = undefined;
    const run = this.run;
    if (!run || this.disposed) return;
    const c = this.c;
    const started = this.timers.now();
    this.progress();
    const later = () => {
      c.publish();
      this.progress();
      this.cancelCatchUp = this.timers.soon(() => this.catchUp());
    };
    // Its own replay (an Inputs change on the way) runs first: catch-up goes on when the controller next publishes
    // (the replay's slices do), and nothing is published meanwhile.
    const afterReplay = () => {
      let cancel: (() => void) | undefined;
      const off = c.subscribe(() => {
        off();
        cancel = this.timers.soon(() => this.catchUp());
      });
      this.cancelCatchUp = () => {
        off();
        cancel?.();
      };
    };
    const due = () => this.timers.now() - started >= CATCH_UP_SLICE_MS;
    for (;;) {
      if (c.busy) return afterReplay();
      if (!this.checkDigest()) return;
      const e = run.entries[this.next];
      if (e?.op.kind === "seek") {
        if (this.near(e)) {
          this.applyEntry(e);
          if (due()) return later();
          continue;
        }
        if (e.tick < c.tick) return this.rebuild();
      } else if (e && e.tick <= c.tick) {
        if (e.tick < c.tick) return this.rebuild();
        this.applyEntry(e);
        if (due()) return later();
        continue;
      }
      // To the host's tick, or (a seek far ahead next) to the seek's own, never past an op or a digest.
      const seeking = e?.op.kind === "seek";
      const host = seeking ? e.tick : this.hostTick();
      const goal = Math.min(host, e ? e.tick : Infinity, this.digests[0]?.tick ?? Infinity);
      if (c.tick >= goal) break;
      const before = c.tick;
      // On the way to a seek's target, pausing notes pass (as the host's seek passed them); playing on, they hold.
      c.advanceTo(Math.min(goal, c.tick + CATCH_UP_TICKS), seeking);
      // Held still (a pausing note the host's resume op passes, the run's end): it follows from here.
      if (c.tick <= before) break;
      if (due()) return later();
    }
    c.publish();
    this.resyncs = 0;
    this.restorePlaying();
    this.publish({ phase: this.fresh() ? "following" : "host-dropped" });
  }

  /** Caught up: playing or paused as the host is (once level with a host that's holding still). */
  private restorePlaying(): void {
    const b = this.beacon;
    const c = this.c;
    if (!b || (!b.playing && c.tick < b.tick)) return;
    const want = b.playing || b.on;
    const state = c.getState();
    if (state.playing === want || (want && state.run?.done)) return;
    try {
      c.as("remote", () => c.setPlaying(want));
    } catch {
      // A refused rebuild says so in the live view.
    }
  }

  private progress(): void {
    this.publish({
      phase: "catching-up",
      progress: { at: tickTime(this.c.tick), of: tickTime(this.hostTick()) },
    });
  }

  private stopCatchUp(): void {
    this.cancelCatchUp?.();
    this.cancelCatchUp = undefined;
  }

  private publish(status: FollowStatus): void {
    const was = this.status;
    this.status = status;
    if (
      this.announced &&
      status.phase === was.phase &&
      status.progress?.at === was.progress?.at &&
      status.progress?.of === was.progress?.of &&
      status.reason === was.reason
    )
      return;
    this.announced = true;
    this.onStatus(status);
  }
}

function hasInputs(i: LiveInputs): boolean {
  return (
    Object.keys(i.rates).length > 0 ||
    Object.keys(i.props).length > 0 ||
    i.traffic !== undefined ||
    i.capacity !== undefined ||
    i.scale !== undefined
  );
}

/** A follower's view of the host's camera: the host's view centre and zoom, as this pane's viewport. */
export function followViewport(
  view: { x: number; y: number; zoom: number },
  pane: { width: number; height: number },
): { x: number; y: number; zoom: number } {
  return { x: pane.width / 2 - view.x * view.zoom, y: pane.height / 2 - view.y * view.zoom, zoom: view.zoom };
}

/** The view a host shares: its pane's centre in flow coordinates, and its zoom. */
export function viewOf(transform: readonly [number, number, number], pane: { width: number; height: number }) {
  const [x, y, zoom] = transform;
  return { x: (pane.width / 2 - x) / zoom, y: (pane.height / 2 - y) / zoom, zoom };
}
