// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CoachCard } from "./CoachCard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("skips placement while hosted in the handoff and resumes when the host is removed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 30));
  const mount = document.createElement("div");
  mount.dataset.testid = "tutorial-completion-mount";
  const host = document.createElement("div");
  const bar = document.createElement("div");
  bar.dataset.testid = "tutorial-bar";
  document.body.append(host, mount, bar);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <CoachCard
          targets={[]}
          subjects={{}}
          selected={[]}
          anchored={false}
          ring={false}
          collapsed={false}
          complete
          onProgress={() => {}}
        >
          {() => <p data-testid="hosted-instruction" />}
        </CoachCard>,
      ),
    );
    expect(mount.querySelector('[data-testid="hosted-instruction"]')).not.toBeNull();
    expect(geometry).not.toHaveBeenCalled();
    await act(async () => {
      const delivered = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve();
        });
        observer.observe(document.body, { childList: true });
      });
      document.body.append(document.createElement("i"));
      await delivered;
    });
    expect(geometry).not.toHaveBeenCalled();
    await act(async () => {
      mount.remove();
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve();
        });
        observer.observe(document.body, { childList: true });
        document.body.append(document.createElement("i"));
      });
    });
    expect(host.querySelector('[data-testid="coach-card"]')).not.toBeNull();
    expect(geometry).toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
    mount.remove();
    bar.remove();
    document.body.querySelectorAll("i").forEach((el) => el.remove());
  }
});
