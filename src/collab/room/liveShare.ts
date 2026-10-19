import type { Simulation } from "../../model/types";
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
// ticks, with a clock beacon twice a second and a state digest every few simulated seconds. A follower that drifts
// rebuilds the run from its start and the log ("Catching up…"); twice on one run, it offers watching on its own.
//
// Cooperative: frames are the room's (encrypted, any member could have sent them), and followers trust the host
// presence names. Signed roles come later (P4). Followers keep their own camera, pointer, inspector and traces.

/** How far behind the host a follower plays: room for the network's jitter, so ops arrive before their tick. */
export const PLAYOUT_MS = 500;
/** No beacon from the host for this long: their connection dropped, and followers wait. */
export const HOST_SILENT_MS = 3_000;
/** Beacons a second, and how often (in simulated time) the host sends a digest. */
export const BEACON_MS = 500;
export const DIGEST_EVERY_TICKS = 500;
/** Log entries per slice for a follower that joins mid-run (each slice stays well inside one frame). */
const LOG_SLICE = 40;
/** A follower's catch-up works in slices of about this many ms, then yields to the page. */
const CATCH_UP_SLICE_MS = 8;

export interface RunStart {
  engine: string;
  /** The selected simulation (its saved definition, or a draft's), or null for free play. */
  simulation: Simulation | null;
  traffic: boolean;
  inputs: LiveInputs;
  speed: number;
  title: string;
}

export type WireEntry = Pick<LogEntry, "seq" | "tick" | "op">;

export type LiveMessage =
  | { t: "start"; run: string; start: RunStart }
  | { t: "log"; run: string; entries: WireEntry[]; done: boolean }
  | { t: "op"; run: string; entry: WireEntry }
  | { t: "beacon"; run: string; tick: number; playing: boolean; speed: number }
  | { t: "digest"; run: string; tick: number; seq: number; hash: number }
  | { t: "stop"; run: string }
  | { t: "hello" };

/** The room's live channel, as this module sees it (src/collab/session.ts sendLive/onLive, JSON). */
export interface LiveChannel {
  send(message: LiveMessage, to?: string): void;
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

const RUN_DEFINING = new Set<LiveOp["kind"]>(["select", "restart", "reload"]);

const digestOf = (c: LiveController) => {
  const { snapshot, draws } = c.digestInputs();
  return snapshotDigest(snapshot, draws);
};

const titleOf = (sim: Simulation | null) => sim?.title ?? "Free play";

// ---------------------------------------------------------------- the host's side

/** What the host's run tells the room's presence: absent while there's nothing to watch. */
export interface DriverShow {
  run: string;
  title: string;
  playing: boolean;
}

/**
 * The host's Live run, shared: each op as it's logged, beacons, digests, and the whole run for anyone who asks.
 * A run is shareable from its start: one the host's Live began before this room opened waits for its next start.
 */
export class LiveDriver {
  private run?: { id: string; start: RunStart; entries: WireEntry[] };
  private nextDigest = DIGEST_EVERY_TICKS;
  private readonly nonce = Math.random().toString(36).slice(2, 10);
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly channel: LiveChannel,
    private readonly watched: WatchedSession,
    private readonly onShow: (show: DriverShow | null) => void,
    timers: LiveTimers = pageTimers,
  ) {
    const c = watched.controller;
    const origin = runOrigin(c);
    if (origin) this.begin(origin, c.controlLog(), false);
    this.stops.push(
      c.onOp((entry) => this.logged(entry)),
      channel.onMessage((_sender, from, message) => {
        if (message.t === "hello") this.sendRun(from);
      }),
      timers.every(BEACON_MS, () => this.beat()),
    );
  }

  dispose(): void {
    for (const stop of this.stops.splice(0)) stop();
    if (this.run) this.channel.send({ t: "stop", run: this.run.id });
    this.onShow(null);
  }

  /** The run this host shares now (its id), if any. */
  get runId(): string | undefined {
    return this.run?.id;
  }

  private begin(start: RunStart, entries: readonly LogEntry[], announce = true): void {
    const c = this.watched.controller;
    const id = `${this.nonce}.${c.runId}`;
    const title = titleOf(start.simulation);
    // The run as it started; the log as copies (the controller keeps only the latest Inputs, this keeps them all).
    this.run = { id, start: { ...start, title }, entries: entries.map(({ seq, tick, op }) => ({ seq, tick, op })) };
    this.nextDigest = c.tick + DIGEST_EVERY_TICKS;
    if (announce) this.channel.send({ t: "start", run: id, start: this.run.start });
    this.show();
  }

  private logged(entry: LogEntry): void {
    const c = this.watched.controller;
    if (!this.run || !this.run.id.endsWith(`.${entry.run}`)) {
      // A new run (Restart, another simulation, a structural edit): it starts from the controller's state now.
      if (!RUN_DEFINING.has(entry.op.kind)) return;
      // (The published state is from just before the op: what a new run keeps from the old one.)
      const state = c.getState();
      const select = entry.op.kind === "select";
      this.begin(
        {
          engine: ENGINE_VERSION,
          simulation: select && entry.op.kind === "select" ? entry.op.simulation : state.simulation,
          traffic: state.traffic,
          // Another simulation starts with no what-ifs; a restart or an edit keeps them.
          inputs: select ? { props: {}, rates: {} } : state.inputs,
          speed: state.speed,
          title: "",
        },
        [entry],
      );
      return;
    }
    const run = this.run;
    // A seek back cut the controller's log there: so does this copy.
    if (entry.op.kind === "seek") run.entries = run.entries.filter((e) => e.tick <= entry.tick);
    const wire = { seq: entry.seq, tick: entry.tick, op: entry.op };
    run.entries.push(wire);
    this.channel.send({ t: "op", run: run.id, entry: wire });
    if (entry.op.kind === "play" || entry.op.kind === "resume") this.show();
  }

  /** The whole run to one follower who asked: its start, then its log in slices. */
  private sendRun(to: string): void {
    const run = this.run;
    if (!run) return;
    this.channel.send({ t: "start", run: run.id, start: run.start }, to);
    for (let i = 0; i < run.entries.length || i === 0; i += LOG_SLICE) {
      const entries = run.entries.slice(i, i + LOG_SLICE);
      this.channel.send({ t: "log", run: run.id, entries, done: i + LOG_SLICE >= run.entries.length }, to);
    }
  }

  private beat(): void {
    const run = this.run;
    if (!run) return;
    const c = this.watched.controller;
    const state = c.getState();
    const tick = c.tick;
    this.channel.send({ t: "beacon", run: run.id, tick, playing: playingNow(c), speed: state.speed });
    if (tick >= this.nextDigest) {
      const seq = run.entries.at(-1)?.seq ?? 0;
      this.channel.send({ t: "digest", run: run.id, tick, seq, hash: digestOf(c) });
      this.nextDigest = tick + DIGEST_EVERY_TICKS;
    }
    this.show();
  }

  private lastShow = "";
  private show(): void {
    const run = this.run;
    const show = run ? { run: run.id, title: run.start.title, playing: playingNow(this.watched.controller) } : null;
    const key = JSON.stringify(show);
    if (key === this.lastShow) return;
    this.lastShow = key;
    this.onShow(show);
  }
}

/**
 * How the controller's current run started, when its log still says (the host's session usually joins the room as
 * it mounts, its log a few ops long): the defaults for a session's first run, or a run-defining op first. Undefined
 * when it can't be told (an Inputs change since, which the log keeps only the latest of): that run isn't shared,
 * the next one is.
 */
export function runOrigin(c: LiveController): RunStart | undefined {
  const log = c.controlLog();
  const first = log[0];
  const fresh = c.runId === 1;
  if (!fresh && (!first || !RUN_DEFINING.has(first.op.kind))) return undefined;
  const inputs = log.filter((e) => e.op.kind === "inputs");
  if (inputs.length > 1 || (inputs[0] && inputs[0].tick > 0)) return undefined;
  if (!fresh && log.some((e) => e.op.kind === "base")) return undefined;
  const state = c.getState();
  const traffic = log.find((e) => e.op.kind === "traffic");
  return {
    engine: ENGINE_VERSION,
    simulation: !fresh && first.op.kind === "select" ? first.op.simulation : fresh ? null : state.simulation,
    // Traffic as it was before its first toggle (a toggle on tick 0 makes the start's value moot).
    traffic: fresh ? false : traffic?.op.kind === "traffic" ? !traffic.op.on : state.traffic,
    // A session's first run, or another simulation, starts with no what-ifs (any since are in the log).
    inputs: fresh || first?.op.kind === "select" ? { props: {}, rates: {} } : state.inputs,
    speed: fresh ? 1 : state.speed,
    title: "",
  };
}

/** Whether the run's clock moves: playing, not at a pausing note, not finished. */
function playingNow(c: LiveController): boolean {
  const state = c.getState();
  return state.playing && !state.run?.waiting && !state.run?.done;
}

// ---------------------------------------------------------------- a follower's side

export type FollowPhase =
  | "joining" // asked for the host's run, waiting for it
  | "catching-up" // replaying the run so far
  | "following" // in lockstep
  | "host-dropped" // no beacon from the host: holding still
  | "cant-follow"; // drifted twice on one run: watch on your own instead

export interface FollowStatus {
  phase: FollowPhase;
  /** While catching up: how far (ms of simulated time) of how far. */
  progress?: { at: number; of: number };
  /** The host's engine differs (another release of Live Diagrams). */
  version?: boolean;
}

/**
 * Follows the host's run. While following, the bridge's pace hook moves this browser's run toward the host's tick
 * minus the playout delay (src/live/simClock.ts), stopping exactly on each op's tick to apply it, and on each
 * digest's tick to compare. Any op this person makes on their own ends following (onLocal).
 */
export class LiveFollower {
  private run?: { id: string; start: RunStart; entries: WireEntry[]; complete: boolean };
  private next = 0;
  private digests: { tick: number; seq: number; hash: number }[] = [];
  private beacon?: { tick: number; playing: boolean; speed: number; at: number };
  private applying = false;
  private mismatches = 0;
  private status: FollowStatus = { phase: "joining" };
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
      watched.controller.onOp(() => {
        if (!this.applying) this.onLocal();
      }),
    );
    this.publish({ phase: "joining" });
    channel.send({ t: "hello" });
  }

  dispose(): void {
    this.cancelCatchUp?.();
    for (const stop of this.stops.splice(0)) stop();
  }

  get phase(): FollowPhase {
    return this.status.phase;
  }

  /** The frame's pace: what the run may advance now (0: hold still). */
  pace(proposedMs: number): number {
    if (this.status.phase === "host-dropped" && this.fresh()) this.publish({ phase: "following" });
    if (this.status.phase !== "following") return 0;
    if (!this.fresh()) {
      this.publish({ phase: "host-dropped" });
      return 0;
    }
    if (!this.applyDue()) return 0;
    const c = this.watched.controller;
    return this.clock.pace(proposedMs, { tick: c.tick, speed: c.getState().speed });
  }

  // -------------------------------------------------------------- messages

  private receive(m: LiveMessage): void {
    switch (m.t) {
      case "start":
        if (m.start.engine !== ENGINE_VERSION) return this.publish({ phase: "cant-follow", version: true });
        if (this.run?.id === m.run) return;
        this.run = { id: m.run, start: m.start, entries: [], complete: false };
        this.digests = [];
        this.mismatches = 0;
        return;
      case "log":
        if (m.run !== this.run?.id) return;
        for (const e of m.entries) this.add(e);
        if (m.done && !this.run.complete) {
          this.run.complete = true;
          this.rebuild();
        }
        return;
      case "op":
        if (m.run !== this.run?.id) {
          // An op of a run this browser hasn't been told about: ask again.
          if (this.run) this.channel.send({ t: "hello" });
          return;
        }
        this.add(m.entry);
        return;
      case "beacon":
        if (m.run !== this.run?.id) return;
        this.beacon = { tick: m.tick, playing: m.playing, speed: m.speed, at: this.timers.now() };
        return;
      case "digest":
        if (m.run !== this.run?.id) return;
        this.digests.push({ tick: m.tick, seq: m.seq, hash: m.hash });
        return;
      case "stop":
        if (m.run === this.run?.id) this.publish({ phase: "host-dropped" });
        return;
      default:
        return;
    }
  }

  private add(e: WireEntry): void {
    const entries = this.run!.entries;
    const last = entries.at(-1)?.seq ?? 0;
    if (e.seq <= last) return;
    entries.push(e);
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
    const entries = this.run?.entries ?? [];
    let goal = this.hostTick();
    if (this.next < entries.length) goal = Math.min(goal, entries[this.next].tick);
    if (this.digests.length) goal = Math.min(goal, this.digests[0].tick);
    return goal;
  }

  /**
   * Applies the ops due on this tick, in order, comparing a digest at its point among them. False when the run
   * can't go on as it is (it's being rebuilt).
   */
  private applyDue(): boolean {
    const run = this.run;
    if (!run) return false;
    const c = this.watched.controller;
    for (;;) {
      if (!this.checkDigest()) return false;
      const e = run.entries[this.next];
      if (!e) return true;
      if (e.tick > c.tick && e.op.kind !== "seek") return true;
      if (e.tick < c.tick && e.op.kind !== "seek") {
        // This browser passed the op's tick before it arrived: the run as it is can't take it.
        this.rebuild();
        return false;
      }
      this.next++;
      this.apply(e.op);
    }
  }

  /** The digest at this tick, once the ops it covers are applied; a mismatch rebuilds. */
  private checkDigest(): boolean {
    const c = this.watched.controller;
    while (this.digests.length) {
      const d = this.digests[0];
      if (d.tick < c.tick) {
        this.digests.shift();
        continue;
      }
      const applied = this.next > 0 ? this.run!.entries[this.next - 1].seq : 0;
      if (d.tick > c.tick || applied < d.seq) return true;
      this.digests.shift();
      if (digestOf(c) === d.hash) continue;
      this.mismatches++;
      if (this.mismatches >= 2) {
        this.publish({ phase: "cant-follow" });
        return false;
      }
      this.rebuild();
      return false;
    }
    return true;
  }

  /** One of the host's ops, on this browser's run (the same tick). */
  private apply(op: LiveOp): void {
    const c = this.watched.controller;
    this.applying = true;
    try {
      switch (op.kind) {
        case "play":
          return c.setPlaying(op.on);
        case "speed":
          return c.setSpeed(op.speed);
        case "step":
          return c.step(op.simMs);
        case "seek":
          return c.seek(op.targetMs);
        case "resume":
          return c.resume();
        case "inputs":
          return c.setInputs(op.inputs);
        case "base":
          return c.setBase(op.simulation);
        case "patch":
          c.updateDiagram(this.watched.getDiagram());
          return;
        case "traffic":
          return c.setTraffic(op.on);
        case "inject":
          return c.inject(op.node, op.count, op.opts);
        case "injectSources":
          c.injectAtSources(op.count);
          return;
        case "sendOne":
          return c.sendOne(op.node, op.type);
        case "fault":
          return c.setFault(op.fault);
        case "status":
          return c.setNodeStatus(op.node, op.status);
        case "props":
          return c.setNodeProps(op.node, op.patch);
        default:
          // select, restart and reload start a run: the run's start describes them. commit changes nothing here.
          return;
      }
    } catch {
      // Refused here as it can't have been there (a budget, a removed node): the digest will say if it matters.
    } finally {
      this.applying = false;
    }
  }

  // -------------------------------------------------------------- the run from its start

  /** This browser's run from the host's run's start, then caught up through its log, in slices. */
  private rebuild(): void {
    const run = this.run;
    if (!run?.complete) return;
    this.cancelCatchUp?.();
    const c = this.watched.controller;
    const s = run.start;
    this.applying = true;
    try {
      c.updateDiagram(this.watched.getDiagram());
      c.setTraffic(s.traffic);
      c.selectSimulation(s.simulation);
      if (hasInputs(s.inputs)) c.setInputs(s.inputs);
      c.setSpeed(s.speed);
      // Restart builds with the inputs, as the host's run was built.
      c.restart();
      c.setPlaying(true);
      c.flush();
    } catch {
      this.applying = false;
      return this.publish({ phase: "cant-follow" });
    }
    this.applying = false;
    this.next = 0;
    this.digests = this.digests.filter((d) => d.tick >= c.tick);
    this.publish({ phase: "catching-up", progress: { at: 0, of: tickTime(this.hostTick()) } });
    this.catchUp();
  }

  /** Plays the log up to where the host is (less the delay), a slice per frame; then follows. */
  private catchUp(): void {
    const run = this.run;
    if (!run) return;
    const c = this.watched.controller;
    const started = this.timers.now();
    for (;;) {
      if (!this.applyDue()) return;
      const goal = this.target() ?? 0;
      if (c.tick >= goal && (this.next >= run.entries.length || run.entries[this.next].tick > c.tick)) {
        this.publish({ phase: "following" });
        return;
      }
      if (c.getState().run?.done) {
        this.publish({ phase: "following" });
        return;
      }
      const stop = Math.min(goal, c.tick + 200);
      if (stop <= c.tick) {
        this.publish({ phase: "following" });
        return;
      }
      this.applying = true;
      try {
        if (c.getState().run) c.seek(tickTime(stop));
        else c.step(tickTime(stop - c.tick));
      } finally {
        this.applying = false;
      }
      if (this.timers.now() - started >= CATCH_UP_SLICE_MS) break;
    }
    this.publish({ phase: "catching-up", progress: { at: tickTime(c.tick), of: tickTime(this.hostTick()) } });
    this.cancelCatchUp = this.timers.soon(() => this.catchUp());
  }

  private publish(status: FollowStatus): void {
    this.status = status;
    this.onStatus(status);
  }
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

function hasInputs(i: LiveInputs): boolean {
  return (
    Object.keys(i.rates).length > 0 ||
    Object.keys(i.props).length > 0 ||
    i.traffic !== undefined ||
    i.capacity !== undefined ||
    i.scale !== undefined
  );
}
