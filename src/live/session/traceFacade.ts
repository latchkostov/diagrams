import { createMachine } from "../../lib/machine";
import type { DiagramFile } from "../../model/types";
import type { MessageTrace } from "../../sim/types";
import type { LiveController } from "../controller";
import type { SlowMotionApi, SlowMotionView } from "../slowmo/controller";
import type { SlowSource, SlowState } from "../slowmo/session";
import type { View } from "../slowmo/camera";
import { traceRuntimeMachine, type RuntimeEvent } from "./traceRuntimeMachine";

const off: SlowState = {
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
  loading: false,
};
const waiting: SlowState = { ...off, status: "capturing", loading: true };
export interface TraceService {
  slow: SlowMotionView;
  journey(trace: MessageTrace, diagram: DiagramFile): NonNullable<SlowMotionView["path"]>;
}

/** The shell owns requests, holds and subscriptions even before there is a runtime. A failed
 * download keeps the checkpoint held for Retry or Escape. Modal ownership queues handoff. */
export function createTraceFacade(controller: LiveController, view: () => View, blocked: () => boolean) {
  const machine = createMachine(traceRuntimeMachine);
  const listeners = new Set<() => void>();
  let service: TraceService | null = null;
  let unsubscribe: (() => void) | undefined;
  let wasPlaying = false;
  let before: View | undefined;
  let snapshot = { state: off, service } as { state: SlowState; service: TraceService | null };
  const emit = () => {
    snapshot = { state: machine.state.source ? waiting : (service?.slow.session.getState() ?? off), service };
    listeners.forEach((fn) => fn());
  };
  const send = (event: RuntimeEvent) => {
    const source = machine.state.source;
    const { commands } = machine.send(event);
    for (const command of commands) {
      if (command === "preserve") {
        wasPlaying = controller.isPlaying;
        before = view();
        controller.setPlaying(false);
        controller.hold(true);
      } else {
        controller.hold(false);
        controller.setPlaying(wasPlaying);
        if (command === "handoff") service!.slow.start(source!, before);
        before = undefined;
      }
    }
    emit();
  };
  const drain = () => {
    if (service && machine.state.source && !blocked()) send({ type: "ready" });
  };
  const end = () => {
    send({ type: "cancel" });
    service?.slow.end();
  };
  const session: SlowMotionApi = {
    getState: () => snapshot.state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    get active() {
      return !!machine.state.source || !!service?.slow.session.active;
    },
    get on() {
      return !!service?.slow.session.on;
    },
    end,
    toggle: () => service?.slow.session.toggle(),
    restart: () => service?.slow.session.restart(),
    step: (dir) => service?.slow.session.step(dir),
    seek: (at) => service?.slow.session.seek(at),
    seekRow: (key) => service?.slow.session.seekRow(key) ?? false,
    pause: () => service?.slow.session.pause(),
    play: () => service?.slow.session.play(),
    publish: () => service?.slow.session.publish(),
  };
  const slow: SlowMotionView = {
    session,
    get state() {
      return snapshot.state;
    },
    get path() {
      return service?.slow.path ?? null;
    },
    start(source: SlowSource) {
      controller.flush();
      if (controller.getState().needsRestart) return;
      send({ type: "request", source });
      drain();
    },
    end,
    frame: (ms, speed) => {
      drain();
      return service?.slow.frame(ms, speed);
    },
    ui: (canvas, snap, labels) => {
      canvas.dataset.simTime = String(snap.time);
      let sum = 0;
      for (const particle of snap.particles)
        sum = (sum + particle.id * 7 + Math.round(particle.progress * 1000)) % 1_000_000_007;
      canvas.dataset.particleSum = String(sum);
      if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1")
        canvas.dataset.livePlaying = String(controller.isPlaying);
      if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1")
        canvas.dataset.traceRuntime = service && machine.state.source ? "queued" : machine.state.value;
      service?.slow.ui(canvas, snap, labels);
    },
  };
  return {
    connect() {
      send({ type: "connect" });
    },
    slow,
    getSnapshot: () => snapshot,
    get pending() {
      return !!machine.state.source;
    },
    get phase() {
      return machine.state.value;
    },
    attach(next: TraceService) {
      if (service?.slow.session !== next.slow.session) {
        unsubscribe?.();
        unsubscribe = next.slow.session.subscribe(emit);
      }
      service = next;
      emit();
      drain();
    },
    detach() {
      unsubscribe?.();
      service = null;
      emit();
    },
    fail() {
      send({ type: "failure" });
    },
    dispose() {
      send({ type: "dispose" });
      unsubscribe?.();
      service = null;
      emit();
    },
    settled() {
      if (!machine.state.source && snapshot.state.status !== "capturing") return;
      return new Promise<void>((resolve) => {
        const stop = session.subscribe(() => {
          if (machine.state.source || snapshot.state.status === "capturing") return;
          stop();
          resolve();
        });
      });
    },
  };
}
export type TraceFacade = ReturnType<typeof createTraceFacade>;
