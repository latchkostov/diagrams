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
    tutorialRoute.open("first");
    tutorialRoute.open("first", true);
    expect(entries).toHaveLength(2);
    tutorialRoute.close();
    expect(window.location.search).toBe("?view=tutorials");
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

it("opens an explicit draft without reloading or retaining tutorial, Live or share-link state", () => {
  const pushState = vi.fn();
  vi.stubGlobal("window", {
    location: new URL("https://example.test/tools/?tutorial=lesson&live=1&sim=demo#d=old"),
    history: { pushState },
  });
  try {
    tutorialRoute.openDiagram("new");
    expect(pushState).toHaveBeenCalledExactlyOnceWith(null, "", "/tools/?view=canvas&example=new");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("opens app views under the current sub-path without reloading or retaining tutorial state", () => {
  const pushState = vi.fn();
  vi.stubGlobal("window", {
    location: new URL("https://example.test/tools/?tutorial=lesson&live=1#d=old"),
    history: { pushState },
  });
  try {
    tutorialRoute.openView("tutorials");
    expect(pushState).toHaveBeenCalledExactlyOnceWith(null, "", "/tools/?view=tutorials");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("redirects the restored history entry before notifying the app, retaining its diagram", () => {
  const pop: (() => void)[] = [];
  let url = new URL("https://example.test/tools/?tutorial=lesson");
  const state = { "livediagrams-tutorial": true };
  const back = vi.fn(() => {
    url = new URL("https://example.test/tools/?view=canvas&example=original");
  });
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
    url = new URL(next, url);
  });
  vi.stubGlobal("window", {
    get location() {
      return url;
    },
    history: { state, back, replaceState },
    addEventListener: (_name: string, listener: () => void) => pop.push(listener),
    removeEventListener: vi.fn(),
  });
  const observed: string[] = [];
  const off = tutorialRoute.subscribe(() => observed.push(window.location.search));
  try {
    tutorialRoute.close("tutorials");
    expect(back).toHaveBeenCalledOnce();
    expect(replaceState).not.toHaveBeenCalled();
    for (const listener of pop) listener();
    expect(observed).toEqual(["?view=tutorials&example=original"]);
    expect(replaceState).toHaveBeenCalledWith(state, "", "/tools/?view=tutorials&example=original");
  } finally {
    off();
    vi.unstubAllGlobals();
  }
});
