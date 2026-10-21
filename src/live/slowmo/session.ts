// Slow motion's session: record first, then replay. Pure TypeScript (no DOM, no React).
//
//   start → capturing (checkpoint, run ahead in slices until the journey is done, at most 30 s of
//   simulated time) → restore the checkpoint exactly → on (play the script on its own clock).
//
// Live stays paused the whole time and comes back exactly where it was (and playing if it was): the
// controller is held (`LiveController.hold`), so no control can play, step or seek it meanwhile.
// The trace keeps following the same message, so live at real speed then shows the very journey
// that was replayed (runs are deterministic). If no message can arrive (free play with no traffic),
// the session is "armed": the live trace waits ("Send one now") and slow motion starts once it comes.

import type { MessageTrace } from "../../sim/types";
import type { LiveController, LookAhead } from "../controller";
import type { SlowFrame, SlowScript } from "./script";
import { loadSlowScript, slowScript, type SlowScriptCode } from "./scriptChunk";
import { notify } from "../../interop/ui/toast";
import { LOAD_FAILED } from "../../lib/lazyLoad";

/** How far ahead to look for the journey's end, in simulated ms. */
export const LOOK_AHEAD_MS = 30_000;
/** One look-ahead slice: at most this much simulated time or this many ms of work, then yield. */
const SLICE_SIM_MS = 2000;
const SLICE_WORK_MS = 6;
const CHECK_EVERY_MS = 50;

/** Which message to watch. */
export type SlowSource =
  /** The next message to start at (or reach) a node, or anywhere. */
  | { kind: "next"; node?: string }
  /** A recorded or live root (the trace card's message). */
  | { kind: "root"; rootId: number }
  /** Whatever the live trace follows or waits for now. */
  | { kind: "followed" };

export type SlowStatus = "off" | "capturing" | "armed" | "on";

export interface SlowState {
  status: SlowStatus;
  playing: boolean;
  /** Script time, ms (at 1×). */
  t: number;
  script: SlowScript | null;
  /** The recorded journey being replayed (the trace card shows it). */
  trace: MessageTrace | null;
  /** Bumps for every new script and every Replay (the camera fits once per take). */
  take: number;
  /** Armed: the node a message is awaited at. */
  armedAt?: string;
  /** The current trace card row and the rows in progress. */
  row?: string;
  activeRows: readonly string[];
  /** Journey time in real ms at `t`. */
  real: number;
  /** The words of the most important caption on screen (screen readers, tests). */
  caption: string;
  done: boolean;
}

export interface SlowEnv {
  /** Builds the script for a recorded journey (it needs the screen's geometry). */
  build(trace: MessageTrace, waiting?: { lag(nodeId: string): number | undefined }): SlowScript;
  /** Yields between look-ahead slices (requestAnimationFrame by default). Returns a cancel. */
  schedule?(work: () => void): () => void;
  /**
   * The script code. Given here (tests, the Lab), it is used at once; otherwise the first start downloads it
   * (src/live/slowmo/scriptChunk.ts) while the session is capturing, and `build` runs only after it arrived.
   */
  code?: SlowScriptCode;
}

const OFF: SlowState = {
  status: "off",
  playing: false,
  t: 0,
  script: null,
  trace: null,
  take: 0,
  activeRows: [],
  real: 0,
  caption: "",
  done: false,
};

function defaultSchedule(work: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(work);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(work, 1);
  return () => clearTimeout(id);
}

export class SlowMotion {
  private state: SlowState = OFF;
  private listeners = new Set<() => void>();
  private wasPlaying = false;
  private liveSpeed: number | null = null;
  private cancel: (() => void) | null = null;
  private sandbox: LookAhead | null = null;
  private cached: { t: number; script: SlowScript; frame: SlowFrame } | null = null;
  private take = 0;
  private pendingStart: SlowSource | null = null;
  /** Bumps when a start waiting for the script code is superseded (ended, dropped, started again). */
  private loading = 0;

  constructor(
    private controller: LiveController,
    private env: SlowEnv = { build: () => missingEnv() },
  ) {}

  /** Armed: start as soon as the awaited message is on its way. Returns the unsubscribe. */
  watch(): () => void {
    return this.controller.subscribe(() => {
      if (this.pendingStart && !this.controller.busy) {
        const source = this.pendingStart;
        this.pendingStart = null;
        if (this.controller.getState().needsRestart) this.end();
        else this.start(source);
        return;
      }
      if (this.state.status === "armed" && this.controller.getState().trace?.current) this.start({ kind: "followed" });
    });
  }

  /** Supplies the script builder (the live view's screen geometry) after construction. */
  configure(env: SlowEnv): void {
    this.env = env;
  }

  getState = (): SlowState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get active(): boolean {
    return this.state.status === "on" || this.state.status === "capturing";
  }

  get on(): boolean {
    return this.state.status === "on";
  }

  /** The script code, given or downloaded; always there once a script exists. */
  private code(): SlowScriptCode | undefined {
    return this.env.code ?? slowScript();
  }

  /** The frame at the current time (cached per time). */
  frame(): SlowFrame | null {
    const { script, t } = this.state;
    if (!script) return null;
    if (this.cached && this.cached.t === t && this.cached.script === script) return this.cached.frame;
    const frame = this.code()!.frameAt(script, t, this.controller.currentDiagram);
    this.cached = { t, script, frame };
    return frame;
  }

  /** Record the chosen message's journey, then replay it. */
  start(source: SlowSource): void {
    // Flush a debounced Inputs rebuild before taking the checkpoint. A replay to a
    // later time can yield: wait for it before borrowing the engine for recording.
    this.controller.flush();
    if (this.controller.getState().needsRestart) return;
    const prev = this.state.status;
    if (prev === "capturing") this.abortCapture();
    if (prev === "off") this.wasPlaying = this.controller.isPlaying;
    if (prev === "armed") this.wasPlaying = this.wasPlaying || this.controller.isPlaying;
    // Capturing before pausing: pausing publishes, and an armed session must not start twice.
    this.set({ ...OFF, status: "capturing", take: this.take });
    this.loading++;
    // The first start downloads the script code; live carries on (as for a rebuild) and the capture starts then.
    if (!this.code()) return this.load(source);
    if (this.controller.busy) {
      this.pendingStart = source;
      return;
    }
    this.pendingStart = null;
    this.controller.setPlaying(false);
    this.controller.hold(true);
    const sandbox = this.controller.lookAhead();
    this.sandbox = sandbox;
    const tracer = sandbox.tracer;
    if (source.kind === "next") tracer.request({ next: "message", node: source.node });
    else if (source.kind === "root") tracer.followRoot(source.rootId);
    const from = sandbox.time();
    const schedule = this.env.schedule ?? defaultSchedule;
    let stopped = false;
    const slice = () => {
      this.cancel = null;
      const began = Date.now();
      const until = Math.min(from + LOOK_AHEAD_MS, sandbox.time() + SLICE_SIM_MS);
      while (!stopped) {
        // Done, at the cap, or nothing more can happen (no traffic, a finished run).
        if (tracer.current()?.done || sandbox.time() >= from + LOOK_AHEAD_MS) stopped = true;
        else if (sandbox.idle() && !tracer.current()) stopped = true;
        else if (!sandbox.step(CHECK_EVERY_MS)) stopped = true;
        else if (sandbox.time() >= until || Date.now() - began >= SLICE_WORK_MS) break;
      }
      if (stopped) this.finish(source);
      else this.cancel = schedule(slice);
    };
    slice();
  }

  /**
   * Waits for the script code, then starts. A start that was ended, dropped or replaced meanwhile does nothing; a
   * failed download goes back to live and says so with Retry, which takes the keyboard and gives it back.
   */
  private load(source: SlowSource): void {
    const token = this.loading;
    const current = () => token === this.loading && this.state.status === "capturing";
    // The journey starts where the person asked for it: live waits, paused, for the code (Esc or a failure resumes).
    this.controller.setPlaying(false);
    loadSlowScript().then(
      () => {
        if (current()) this.start(source);
      },
      (error: unknown) => {
        if (!current()) return;
        console.error("[diagrams] lazy load failed", error);
        this.end();
        notify(LOAD_FAILED, {
          kind: "error",
          action: { label: "Retry", run: () => this.start(source), testId: "lazy-load-retry", focus: true },
        });
      },
    );
  }

  private finish(source: SlowSource): void {
    const sandbox = this.sandbox!;
    this.sandbox = null;
    const trace = sandbox.tracer.current();
    let waiting: { lag(nodeId: string): number | undefined } | undefined;
    if (trace && !trace.done) {
      // Still on its way at the cap: say where, with that node's backlog or lag, before rewinding.
      const node = unfinishedAt(trace);
      const lag = node ? sandbox.lag(node) : undefined;
      waiting = { lag: (id) => (id === node ? lag : undefined) };
    }
    sandbox.restore();
    if (sandbox.refused) {
      this.set(OFF);
      this.restoreSpeed();
      this.controller.hold(false);
      return;
    }
    const tracer = sandbox.tracer;
    if (!trace) {
      // Nothing came (free play with no traffic, or a run that ended): wait for it live.
      if (source.kind === "next") tracer.request({ next: "message", node: source.node });
      else if (source.kind === "root") tracer.followRoot(source.rootId);
      this.set({ ...OFF, status: "armed", take: this.take, armedAt: source.kind === "next" ? source.node : undefined });
      this.restoreSpeed();
      this.controller.hold(false);
      this.controller.setPlaying(this.wasPlaying);
      return;
    }
    // Live keeps following the same message: after slow motion it plays out at real speed.
    tracer.followRoot(trace.rootId);
    const script = this.env.build(trace, waiting);
    this.liveSpeed ??= this.controller.getState().speed;
    this.controller.setSpeed(1);
    this.take++;
    this.set({ ...OFF, status: "on", playing: true, t: 0, script, trace, take: this.take });
    this.controller.publish();
  }

  private abortCapture(): void {
    this.cancel?.();
    this.cancel = null;
    this.sandbox?.restore();
    this.sandbox = null;
  }

  /** Back to live: exactly where it was, playing if it was. */
  end(): void {
    this.pendingStart = null;
    this.loading++;
    const status = this.state.status;
    if (status === "off") return;
    if (status === "capturing") this.abortCapture();
    this.set(OFF);
    this.restoreSpeed();
    this.controller.hold(false);
    this.controller.setPlaying(this.wasPlaying);
  }

  /** Drop an invalidated journey without touching play; false means a pending capture survives this rebuild. */
  drop(): boolean {
    // This rebuild is the one a requested capture is waiting for.
    if (this.pendingStart && this.controller.busy) return false;
    this.pendingStart = null;
    this.loading++;
    if (this.state.status === "off") return true;
    if (this.state.status === "capturing") {
      this.cancel?.();
      this.cancel = null;
      this.sandbox = null;
    }
    this.set(OFF);
    this.restoreSpeed();
    this.controller.hold(false);
    return true;
  }

  private restoreSpeed(): void {
    const speed = this.liveSpeed;
    this.liveSpeed = null;
    if (speed !== null) this.controller.setSpeed(speed);
  }

  /** The live view unmounted: stop any look-ahead in progress (the engine goes with the view). */
  dispose(): void {
    this.pendingStart = null;
    this.loading++;
    this.cancel?.();
    this.cancel = null;
  }

  /** Advance the replay by wall-clock ms; `speed` (the speed select) scales the pacing. */
  advance(wallMs: number, speed: number): void {
    const s = this.state;
    if (s.status !== "on" || !s.playing || !s.script || !(wallMs > 0)) return;
    const t = Math.min(s.script.duration, s.t + wallMs * speed);
    this.state = { ...s, t, playing: t < s.script.duration };
    if (!this.state.playing) this.publish();
  }

  play(): void {
    const s = this.state;
    if (s.status !== "on" || !s.script) return;
    // At the end, Play replays from the start.
    const again = s.t >= s.script.duration;
    this.set({ ...s, playing: true, t: again ? 0 : s.t, take: again ? ++this.take : s.take });
  }

  pause(): void {
    if (this.state.status === "on") this.set({ ...this.state, playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** Replay from the start (the camera fits the whole path again). */
  restart(): void {
    const s = this.state;
    if (s.status !== "on") return;
    this.take++;
    this.set({ ...s, t: 0, playing: true, take: this.take });
  }

  seek(t: number): void {
    const s = this.state;
    if (s.status !== "on" || !s.script || !Number.isFinite(t)) return;
    this.set({ ...s, t: Math.max(0, Math.min(s.script.duration, t)) });
  }

  /** Next (+1) or previous (-1) hop, then pause there. */
  step(dir: 1 | -1): void {
    const s = this.state;
    if (s.status !== "on" || !s.script) return;
    this.set({ ...s, playing: false, t: this.code()!.stepStop(s.script, s.t, dir) });
  }

  /** A trace card row was clicked: tell the story from that hop. */
  seekRow(key: string): boolean {
    const at = this.state.script?.rowStart.get(key);
    if (at === undefined) return false;
    this.seek(at);
    return true;
  }

  /** Republish the derived fields (current row, clock, caption) for React. */
  publish(): void {
    this.set(this.state);
  }

  private set(next: SlowState): void {
    const frame = next.script ? this.frameFor(next) : null;
    const top = frame?.captions
      .filter((c) => !c.chip)
      .reduce<(typeof frame.captions)[number] | undefined>(
        (best, c) => (!best || c.priority > best.priority ? c : best),
        undefined,
      );
    this.state = {
      ...next,
      row: frame?.currentRow,
      activeRows: frame?.activeRows ?? [],
      real: frame?.real ?? 0,
      caption: top?.text ?? "",
      done: !!frame?.done,
    };
    for (const l of this.listeners) l();
  }

  private frameFor(s: SlowState): SlowFrame {
    if (this.cached && this.cached.t === s.t && this.cached.script === s.script) return this.cached.frame;
    const frame = this.code()!.frameAt(s.script!, s.t, this.controller.currentDiagram);
    this.cached = { t: s.t, script: s.script!, frame };
    return frame;
  }
}

function missingEnv(): never {
  throw new Error("SlowMotion: configure() it with a script builder first");
}

/** Where an unfinished journey is waiting: the last node of a copy that hasn't ended. */
export function unfinishedAt(trace: MessageTrace): string | undefined {
  const last = new Map<number, { node?: string; over: boolean }>();
  for (const s of trace.steps) {
    const over = s.kind === "end" || s.kind === "drop" || s.kind === "block" || s.kind === "park";
    const prev = last.get(s.id);
    last.set(s.id, { node: s.node ?? prev?.node, over });
  }
  for (const v of last.values()) if (!v.over) return v.node;
  return trace.steps.at(-1)?.node;
}
