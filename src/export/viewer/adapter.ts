import { hostReducer, initialHostState, type HostState } from "../../interop/embed/hostReducer";
import type { FrameMessage, HostMessage } from "../../interop/embed/hostProtocol";
import { LiveDriver } from "../../interop/embed/hostLive";
import type { Theme } from "../../harness/settings";

export type ViewerEvents = {
  loaded: Extract<FrameMessage, { type: "loaded" }>;
  error: Extract<FrameMessage, { type: "error" }>;
  size: { height: number };
};

/** Memory-only host adapter. Loading never plays; play is an explicit reader/host action. */
export class ViewerAdapter {
  private state: HostState = initialHostState;
  private listeners = new Set<() => void>();
  private events = new Map<keyof ViewerEvents, Set<(value: never) => void>>();
  readonly driver = new LiveDriver(() => {});

  getSnapshot = (): HostState => this.state;
  getTheme = (): Theme | undefined => this.state.options.theme ?? undefined;

  /** Host theme changes update the same settings consumed by the canvas and live renderer. */
  setTheme(theme: Theme): void {
    this.command({ type: "setTheme", theme });
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  on<K extends keyof ViewerEvents>(type: K, listener: (value: ViewerEvents[K]) => void): () => void {
    let listeners = this.events.get(type);
    if (!listeners) this.events.set(type, (listeners = new Set()));
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private emit<K extends keyof ViewerEvents>(type: K, value: ViewerEvents[K]): void {
    for (const listener of this.events.get(type) ?? []) listener(value as never);
  }

  /** Object or JSON text; validated with the same size and format limits as the web component. */
  load(diagram: unknown): boolean {
    return this.command({ type: "load", diagram, options: { autoplay: false } });
  }

  play(simulationId?: string): void {
    if (simulationId !== undefined && !this.command({ type: "selectSimulation", simulation: simulationId })) return;
    this.command({ type: "play" });
  }

  /** Pause at the current position; a later play resumes. Pending play is paused too. */
  stop(): void {
    this.command({ type: "pause" });
  }

  report = (message: FrameMessage): void => {
    if (message.type === "resize") this.emit("size", { height: message.height });
  };

  dispose(): void {
    this.driver.reset();
    this.events.clear();
    this.listeners.clear();
  }

  private command(message: HostMessage): boolean {
    const previous = this.state;
    const result = hostReducer(previous, message);
    this.state = result.state;
    if (previous.generation !== this.state.generation) this.driver.reset();
    for (const listener of this.listeners) listener();
    let ok = true;
    for (const effect of result.effects) {
      if (effect.kind === "live") this.driver.run(effect.op);
      if (effect.kind === "post" && (effect.message.type === "loaded" || effect.message.type === "error")) {
        const message = effect.message;
        if (message.type === "error") {
          ok = false;
          this.emit("error", message);
        } else this.emit("loaded", message);
      }
    }
    return ok;
  }
}
