/** Serialized into the page: force only this measured run's idle callback. */
export function flushMeasuredCheck({ count, controlled }: { count: number; controlled: boolean }) {
  const stats = (window as unknown as { __checks: { started: number; skipped: number; flush(): void } }).__checks;
  if (stats.started + stats.skipped !== count) return;
  const requestIdle = window.requestIdleCallback;
  // Zero retains Playwright's default idle quiet window. One is its first positive
  // virtual tick; all four start frames and both final paint frames still run.
  if (controlled) window.requestIdleCallback = (run) => requestIdle.call(window, run, { timeout: 1 });
  try {
    stats.flush();
  } finally {
    window.requestIdleCallback = requestIdle;
  }
}
