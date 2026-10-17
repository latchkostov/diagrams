/** Hold independent browser signals; tests choose their delivery order without guessing delays. */
export function holdChecks() {
  const Native = window.Worker;
  let held = true;
  const pending: (() => void)[] = [];
  window.Worker = class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      if (options?.name !== "checks") return;
      this.addEventListener("message", (event) => {
        if (!held) return;
        event.stopImmediatePropagation();
        pending.push(() => this.dispatchEvent(new MessageEvent("message", { data: event.data })));
      });
    }
  };
  Object.assign(window, { heldChecks: () => pending.length });
  window.addEventListener("release-checks", () => {
    held = false;
    pending.splice(0).forEach((run) => run());
  });
}

// Hold real ResizeObserver deliveries until the test releases them. Unlike a slow CPU,
// this guarantees that timers can run before React Flow and the floating chrome measure.
export function holdResizeObservers(initiallyHeld: boolean) {
  const Native = window.ResizeObserver;
  const pending = new Map<ResizeObserver, Map<Element, ResizeObserverEntry>>();
  const callbacks = new Map<ResizeObserver, ResizeObserverCallback>();
  let held = initiallyHeld;
  window.ResizeObserver = class extends Native {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        if (held) {
          const batch = pending.get(observer) ?? new Map<Element, ResizeObserverEntry>();
          for (const entry of entries) batch.set(entry.target, entry);
          pending.set(observer, batch);
          callbacks.set(observer, callback);
        } else callback(entries, observer);
      });
    }
  };
  Object.assign(window, { heldResizeObservers: () => pending.size });
  window.addEventListener("release-resize-observers", () => {
    held = false;
    for (const [observer, entries] of pending) callbacks.get(observer)?.([...entries.values()], observer);
    pending.clear();
  });
  window.addEventListener("hold-resize-observers", () => {
    held = true;
  });
  window.addEventListener("release-node-measurements", () => {
    for (const [observer, batch] of pending) {
      const entries = [...batch.values()].filter((entry) =>
        (entry.target as HTMLElement).dataset.testid?.startsWith("rf__node-"),
      );
      if (entries.length) callbacks.get(observer)?.(entries, observer);
      for (const entry of entries) batch.delete(entry.target);
    }
  });
}
