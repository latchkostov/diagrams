/** Snapshot ownership before any menu/panel closes, then let all inner listeners handle the key. */
export function onUnhandledEscape(dismiss: () => void): () => void {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.repeat) return;
    const owner = document.querySelector(
      '[role="menu"], [role="dialog"], [data-testid="capacity-panel"], [data-testid="sim-panel"], [data-testid="trace-card"]',
    );
    if (owner) return;
    // A task, not a microtask: native dispatch can flush microtasks between event listeners.
    const timer = setTimeout(() => {
      pending.delete(timer);
      if (!event.defaultPrevented) dismiss();
    }, 0);
    pending.add(timer);
  };
  window.addEventListener("keydown", onKey, { capture: true });
  return () => {
    window.removeEventListener("keydown", onKey, { capture: true });
    for (const timer of pending) clearTimeout(timer);
    pending.clear();
  };
}
