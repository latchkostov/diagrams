// Drives live view for the host-supplied embed: the host's play, pause, speed and simulation commands go to
// the running session, or wait for it (going live first when they need to); the session's changes go back
// to the host as `playState` and `simulationChanged`. No React here: hostReducer.test.ts drives it with a fake.
//
// Commands can arrive before there's anything to run them on: right after `loaded`, the canvas (and so live
// view) may still be downloading, and a session takes a moment to start once live view is on. They wait, in
// order, and run when the session is up. Play and a simulation switch go live as soon as there's a canvas to
// ask; a pause waits too whenever a session may be on its way (live view starting, an autoplay load, a waiting
// play), so "play, then pause" or "autoplay, then pause" ends paused.

import type { LiveHandle, LiveSessionHandle } from "../../live/LiveView";
import type { FrameMessage } from "./hostProtocol";
import type { LiveOp } from "./hostReducer";

const activates = (op: LiveOp) => op.kind === "play" || op.kind === "simulation";

export class LiveDriver {
  private handle: LiveHandle | null = null;
  private session: LiveSessionHandle | null = null;
  private pending: LiveOp[] = [];
  private unsubscribe: (() => void) | undefined;
  private last: { playing?: boolean; speed?: number; simulation?: string | null } = {};

  constructor(private readonly post: (message: FrameMessage) => void) {}

  /** Live view told us how to drive it (again): whether it's on, how to go live, and the session once it's up. */
  setHandle(handle: LiveHandle | null): void {
    this.handle = handle;
    const session = handle?.session ?? null;
    if (session !== this.session) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.session = session;
      if (session) {
        for (const op of this.pending.splice(0)) this.apply(session, op);
        this.unsubscribe = session.controller.subscribe(() => this.report(session));
        this.report(session);
        return;
      }
      this.report(null);
    }
    if (!handle || session) return;
    // A canvas, no session yet: commands that waited for one start live view now.
    if (this.pending.some(activates)) {
      if (!handle.live) handle.goLive();
    } else if (!handle.live) {
      // Live view is off and nothing will turn it on: a waiting pause has nothing to pause.
      this.pending = this.pending.filter((p) => p.kind !== "pause");
    }
  }

  run(op: LiveOp): void {
    if (this.session) return this.apply(this.session, op);
    if (op.kind === "pause") {
      // Only worth keeping if a session may be coming: no canvas yet (an autoplay load), live view starting,
      // or a play or switch waiting for it.
      const coming = !this.handle || this.handle.live || this.pending.some(activates);
      if (coming) this.pending.push(op);
      return;
    }
    this.pending.push(op);
    if (activates(op) && this.handle && !this.handle.live) this.handle.goLive();
  }

  /** A new diagram: the old canvas (and its session) is going away; the new one reports itself. */
  reset(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.handle = null;
    this.session = null;
    this.pending = [];
    this.last = {};
  }

  private apply(session: LiveSessionHandle, op: LiveOp): void {
    const c = session.controller;
    switch (op.kind) {
      case "play":
        return c.setPlaying(true);
      case "pause":
        return c.setPlaying(false);
      case "speed":
        return c.setSpeed(op.speed);
      case "simulation":
        return session.selectSimulation(op.id);
    }
  }

  /** Tells the host what changed: playing or speed, and which simulation runs (null: free play). */
  private report(session: LiveSessionHandle | null): void {
    const st = session?.controller.getState();
    const playing = !!st?.playing;
    const speed = st?.speed ?? this.last.speed ?? 1;
    if (playing !== this.last.playing || speed !== this.last.speed) {
      this.last.playing = playing;
      this.last.speed = speed;
      this.post({ type: "playState", playing, speed });
    }
    if (!st) return;
    const simulation = st.simulation?.id ?? null;
    if (simulation !== this.last.simulation) {
      this.last.simulation = simulation;
      this.post({ type: "simulationChanged", simulation });
    }
  }
}
