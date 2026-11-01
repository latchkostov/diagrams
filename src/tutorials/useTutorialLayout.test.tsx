// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useTutorialLayout } from "./useTutorialLayout";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mutate(root: Element, change: () => void) {
  return new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      resolve();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    change();
  });
}
function Layout() {
  useTutorialLayout();
  return (
    <div data-testid="tutorial-app">
      <div data-testid="tutorial-bar" />
      <div data-testid="tutorial-tools" />
      <div data-testid="live-caption-mount">
        <div data-testid="live-note" data-expanded="0" />
      </div>
      <div data-testid="unrelated-badge" />
    </div>
  );
}
it("ignores badge churn, measures note expansion synchronously and writes room only on change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const geometry = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 300, 100));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<Layout />));
    const app = host.querySelector<HTMLElement>('[data-testid="tutorial-app"]')!;
    const writes = vi.spyOn(app.style, "setProperty");
    const badge = host.querySelector<HTMLElement>('[data-testid="unrelated-badge"]')!;
    const note = host.querySelector<HTMLElement>('[data-testid="live-note"]')!;
    geometry.mockClear();
    for (let i = 0; i < 16; i++)
      await mutate(app, () => {
        badge.className = `badge-${i}`;
        badge.append(document.createElement("i"));
      });
    expect(geometry).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    await mutate(app, () => {
      note.dataset.expanded = "1";
    });
    expect(geometry).toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    host.querySelector<HTMLElement>('[data-testid="live-caption-mount"]')!.getBoundingClientRect = () =>
      new DOMRect(0, 0, 300, 400);
    await mutate(app, () => {
      note.dataset.expanded = "0";
    });
    expect(writes).toHaveBeenCalledExactlyOnceWith("--tutorial-note-room", "292px");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
