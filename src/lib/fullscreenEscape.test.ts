import { describe, expect, it, vi } from "vitest";
import { escapeFullscreen } from "./fullscreenEscape";

const doc = (full: boolean) =>
  ({
    fullscreenElement: full ? ({} as Element) : null,
    exitFullscreen: vi.fn(() => Promise.resolve()),
  }) as unknown as Document & { exitFullscreen: ReturnType<typeof vi.fn> };

const esc = (key = "Escape") => ({ key, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });

describe("escapeFullscreen", () => {
  it("takes Esc while full screen: leaves full screen, and no other listener sees it", () => {
    const d = doc(true);
    const e = esc();
    expect(escapeFullscreen(e, d)).toBe(true);
    expect(d.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("leaves Esc to the app when nothing is full screen, and other keys alone", () => {
    const d = doc(false);
    const e = esc();
    expect(escapeFullscreen(e, d)).toBe(false);
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
    const f = esc("f");
    expect(escapeFullscreen(f, doc(true))).toBe(false);
    expect(f.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
