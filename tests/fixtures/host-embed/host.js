// The host page's own script (tests/e2e/host-embed.spec.ts): records what the page hears, from the
// <live-diagram> element (its DOM events) and from any window (raw messages), for the test to read.
window.__events = [];
window.__raw = [];
window.addEventListener("message", (e) => window.__raw.push({ origin: e.origin, data: e.data }));
window.__viewerFrame = () =>
  document
    .querySelector('[data-testid="host-diagram"]')
    ?.shadowRoot?.querySelector('[data-testid="live-diagram-frame"]') ?? null;
document.addEventListener("DOMContentLoaded", () => {
  const el = document.querySelector("live-diagram");
  if (!el) return;
  for (const type of ["ready", "loaded", "error", "nodeclick", "simulationchanged", "playstate", "resize"])
    el.addEventListener(type, (e) => window.__events.push({ type, detail: e.detail }));
});
