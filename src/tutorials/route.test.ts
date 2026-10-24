import { expect, it, vi } from "vitest";
import { tutorialRoute } from "./route";

it("Next replaces the lesson while Exit keeps the original return destination", () => {
  const entries: { url: URL; state: unknown }[] = [
    { url: new URL("https://example.test/?view=tutorials"), state: null },
  ];
  let current = 0;
  const history = {
    get state() {
      return entries[current].state;
    },
    pushState: (state: unknown, _unused: string, url: string) => {
      entries.splice(++current);
      entries.push({ url: new URL(url, entries[0].url), state });
    },
    replaceState: (state: unknown, _unused: string, url: string) => {
      entries[current] = { url: new URL(url, entries[0].url), state };
    },
    back: () => {
      current--;
    },
  };
  vi.stubGlobal("window", {
    get location() {
      return entries[current].url;
    },
    history,
  });
  try {
    tutorialRoute.open("first");
    tutorialRoute.open("second", true);
    expect(entries).toHaveLength(2);
    expect(tutorialRoute.get()).toBe("second");
    tutorialRoute.close();
    expect(window.location.search).toBe("?view=tutorials");
  } finally {
    vi.unstubAllGlobals();
  }
});
