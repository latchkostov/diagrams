import { afterEach, describe, expect, it, vi } from "vitest";
import { exitFullscreen, fullscreenAvailable, isFullscreen, isFullscreenKey, toggleFullscreen } from "./fullscreen";

/** A document with just what the Fullscreen API helpers use. */
function fakeDocument(opts: { enabled?: boolean; request?: boolean; refuse?: boolean } = {}) {
  const root = {} as HTMLElement;
  const doc = {
    fullscreenEnabled: opts.enabled ?? true,
    fullscreenElement: null as Element | null,
    documentElement: root,
    exitFullscreen: vi.fn(() => {
      doc.fullscreenElement = null;
      return Promise.resolve();
    }),
  };
  if (opts.request ?? true)
    Object.assign(root, {
      requestFullscreen: vi.fn(() => {
        if (opts.refuse) return Promise.reject(new TypeError("Permissions check failed"));
        doc.fullscreenElement = root;
        return Promise.resolve();
      }),
    });
  return doc as typeof doc & Document;
}

const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    target: null,
    ...extra,
  }) as KeyboardEvent;

afterEach(() => vi.unstubAllGlobals());

describe("fullscreenAvailable", () => {
  it("is true only when the document allows it and can request it", () => {
    expect(fullscreenAvailable(fakeDocument())).toBe(true);
    // An iframe without allow="fullscreen".
    expect(fullscreenAvailable(fakeDocument({ enabled: false }))).toBe(false);
    // iOS Safari: no requestFullscreen on elements other than video.
    expect(fullscreenAvailable(fakeDocument({ request: false }))).toBe(false);
  });
});

describe("toggleFullscreen", () => {
  it("puts the whole page (the document element) full screen, then takes it out", async () => {
    const doc = fakeDocument();
    await toggleFullscreen(doc);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBe(doc.documentElement);
    expect(isFullscreen(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(isFullscreen(doc)).toBe(false);
  });

  it("swallows a refusal and changes nothing", async () => {
    const doc = fakeDocument({ refuse: true });
    await expect(toggleFullscreen(doc)).resolves.toBeUndefined();
    expect(isFullscreen(doc)).toBe(false);
  });
});

describe("exitFullscreen", () => {
  it("leaves full screen, and does nothing when not in it", async () => {
    const doc = fakeDocument();
    exitFullscreen(doc);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    await toggleFullscreen(doc);
    exitFullscreen(doc);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("isFullscreenKey", () => {
  it("is F or Shift+F on its own", () => {
    expect(isFullscreenKey(key("f"))).toBe(true);
    expect(isFullscreenKey(key("F"))).toBe(true);
  });

  it("isn't another key, a chord, a held key, a handled key or a composition", () => {
    expect(isFullscreenKey(key("l"))).toBe(false);
    expect(isFullscreenKey(key("F11"))).toBe(false);
    expect(isFullscreenKey(key("f", { ctrlKey: true }))).toBe(false);
    expect(isFullscreenKey(key("f", { metaKey: true }))).toBe(false);
    expect(isFullscreenKey(key("f", { altKey: true }))).toBe(false);
    expect(isFullscreenKey(key("f", { repeat: true }))).toBe(false);
    expect(isFullscreenKey(key("f", { defaultPrevented: true }))).toBe(false);
    expect(isFullscreenKey(key("f", { isComposing: true }))).toBe(false);
  });

  it("isn't typing in a text field", () => {
    class FakeElement {
      constructor(private editable: boolean) {}
      closest() {
        return this.editable ? this : null;
      }
    }
    vi.stubGlobal("Element", FakeElement);
    expect(isFullscreenKey(key("f", { target: new FakeElement(true) as unknown as EventTarget }))).toBe(false);
    expect(isFullscreenKey(key("f", { target: new FakeElement(false) as unknown as EventTarget }))).toBe(true);
  });
});
