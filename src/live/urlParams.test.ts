import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showDiagram } from "../lib/urlState";
import { parseLiveParams, writeLiveParams } from "./urlParams";

/** A minimal window: the location and the history calls the URL state uses. */
function stubWindow(search: string) {
  const location = { pathname: "/", search, hash: "" };
  const go = (_state: unknown, _title: string, url: string) => {
    location.search = new URL(url, "http://localhost").search;
  };
  vi.stubGlobal("window", { location, history: { state: null, replaceState: go, pushState: go } });
  return location;
}

describe("writeLiveParams", () => {
  beforeEach(() => showDiagram(null));
  afterEach(() => {
    showDiagram(null);
    vi.unstubAllGlobals();
  });

  it("mirrors live state into a canvas URL and clears playback keys when live view ends", () => {
    const location = stubWindow("?view=canvas&example=a&speed=2&traffic=0");
    writeLiveParams(true, "s1");
    expect(location.search).toBe("?view=canvas&example=a&speed=2&traffic=0&live=1&sim=s1");
    writeLiveParams(false, null);
    expect(location.search).toBe("?view=canvas&example=a");
  });

  it("leaves other views alone", () => {
    const location = stubWindow("?view=lab&preset=x");
    writeLiveParams(true, "s1");
    expect(location.search).toBe("?view=lab&preset=x");
  });

  it("keeps the diagram on screen's keys off the URL of an example that is still loading", () => {
    const location = stubWindow("?view=canvas&example=a&live=1&traffic=0&sim=s1");
    showDiagram({ identity: "id-a", example: "a" });
    // The picker moved on to b; a is still on screen.
    location.search = "?view=canvas&example=b";
    writeLiveParams(true, "s2");
    expect(location.search).toBe("?view=canvas&example=b");
    // Back on a: its current keys apply.
    location.search = "?view=canvas&example=a";
    writeLiveParams(true, "s2");
    expect(parseLiveParams(location.search)).toEqual({
      live: true,
      sim: "s2",
      speed: null,
      paused: false,
      traffic: false,
    });
  });

  it("a newly shown diagram starts from the URL's keys; the same canvas keeps its own when renamed", () => {
    const location = stubWindow("?view=canvas&example=a&live=1&sim=s1");
    showDiagram({ identity: "id-a", example: "a" });
    location.search = "?view=canvas&example=b";
    showDiagram({ identity: "id-b", example: "b" });
    writeLiveParams(false, null);
    expect(location.search).toBe("?view=canvas&example=b");

    location.search = "?view=canvas&example=draft&live=1";
    showDiagram({ identity: "id-draft", example: "draft" });
    // The draft became an entry without remounting: the URL for the entry carries its keys.
    showDiagram({ identity: "id-draft", example: "entry-1" });
    location.search = "?view=canvas&example=entry-1";
    writeLiveParams(true, null);
    expect(location.search).toBe("?view=canvas&example=entry-1&live=1");
  });
});
