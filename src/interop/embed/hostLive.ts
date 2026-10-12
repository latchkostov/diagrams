// Drives live view for the host-supplied embed: the host's play, pause, speed and simulation commands go to
// the running session, or wait for it (going live first when they need to); the session's changes go back
// to the host as `playState` and `simulationChanged`. No React here: hostLive.test.ts drives it with a fake.

import type { LiveHandle, LiveSessionHandle } from "../../live/LiveView";
import type { FrameMessage } from "./hostProtocol";
import type { LiveOp } from "./hostReducer";

export class LiveDriver {
  private handle: LiveHandle | null = null;
  private session: LiveSessionHandle | null = null;
  private pending: LiveOp[] = [];
  private unsubscribe: (() => void) | undefined;
  private last: { playing?: boolean; speed?: number; simulation?: string | null } = {};

  constructor(private readonly post: (message: FrameMessage) => void) {}

  /** Live view told us how to drive it (again): going live, and the session once it's up. */
  setHandle(handle: LiveHandle | null): void {
    this.handle = handle;
    const session = handle?.session ?? null;
    if (session === this.session) return;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session = session;
    if (!session) {
      this.report(null);
      return;
    }
    for (const op of this.pending.splice(0)) this.apply(session, op);
    this.unsubscribe = session.controller.subscribe(() => this.report(session));
    this.report(session);
  }

  run(op: LiveOp): void {
    if (this.session) return this.apply(this.session, op);
    if (op.kind === "pause") {
      // Not live, so nothing plays: a pause only cancels a play still waiting for the session.
      this.pending = this.pending.filter((p) => p.kind !== "play");
      return;
    }
    this.pending.push(op);
    if (op.kind === "play" || op.kind === "simulation") this.handle?.goLive();
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
