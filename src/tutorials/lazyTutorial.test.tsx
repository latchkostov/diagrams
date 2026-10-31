// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { tutorialRoute } from "./route";
import type { Placeholder } from "../lib/lazyLoad";

// Exercise the real placeholder with both loader states without downloading the tutorial app.
vi.mock("../lib/lazySurface", () => ({
  defineLazySurface:
    ({ placeholder }: { placeholder: { render: Placeholder<{ id: string; onExit(): void }> } }) =>
    ({ failed, ...props }: { failed: boolean; id: string; onExit(): void }) =>
      placeholder.render(props, { failed, retry: () => {} }),
}));

it("clicking Exit returns to the hub while the tutorial chunk is loading or failed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { TutorialSurface } = await import("./lazyTutorial");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const off = tutorialRoute.subscribe(() => {});
  vi.spyOn(window.history, "back").mockImplementation(() => {
    window.history.replaceState(null, "", "/?view=tutorials");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  try {
    for (const failed of [false, true]) {
      window.history.replaceState(null, "", "/?view=tutorials");
      tutorialRoute.open("mobile-api");
      // The mocked primitive supplies its status directly to the production placeholder.
      const props = { id: "mobile-api", onExit: tutorialRoute.close, failed };
      await act(() => root.render(<TutorialSurface {...props} />));
      expect(host.querySelector('[data-testid="tutorial-app-loading"]')?.getAttribute("aria-busy")).toBe(
        String(!failed),
      );
      await act(() => host.querySelector<HTMLButtonElement>('[data-testid="tutorial-exit"]')!.click());
      expect(window.location.search).toBe("?view=tutorials");
      expect(tutorialRoute.get()).toBeNull();
    }
  } finally {
    await act(() => root.unmount());
    off();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
