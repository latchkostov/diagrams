import { describe, expect, it } from "vitest";
import { formatCombo, matches, shortcutFor, type KeyLike } from "./shortcuts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("Mod matches Ctrl or Cmd", () => {
    expect(matches(key("z", { ctrlKey: true }), "Mod+Z")).toBe(true);
    expect(matches(key("z", { metaKey: true }), "Mod+Z")).toBe(true);
    expect(matches(key("z"), "Mod+Z")).toBe(false);
  });

  it("Shift must match exactly for letters", () => {
    expect(shortcutFor(key("z", { ctrlKey: true }))).toBe("undo");
    expect(shortcutFor(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(key("y", { ctrlKey: true }))).toBe("redo");
  });

  it("punctuation ignores the implied Shift", () => {
    expect(shortcutFor(key("?", { shiftKey: true }))).toBe("shortcuts");
  });

  it("Shift+digit matches by physical key", () => {
    expect(shortcutFor({ ...key("!", { shiftKey: true }), code: "Digit1" })).toBe("fit-view");
    // Shift+2 prints "@" on US layouts and "\"" on others: the physical digit decides.
    expect(shortcutFor({ ...key("@", { shiftKey: true }), code: "Digit2" })).toBe("zoom-selection");
    expect(shortcutFor({ ...key('"', { shiftKey: true }), code: "Digit2" })).toBe("zoom-selection");
    expect(shortcutFor({ ...key(")", { shiftKey: true }), code: "Digit0" })).toBe("zoom-100");
  });

  it("arrows nudge, Shift+arrows nudge far", () => {
    expect(shortcutFor(key("ArrowLeft"))).toBe("nudge");
    expect(shortcutFor(key("ArrowLeft", { shiftKey: true }))).toBe("nudge-far");
  });

  it("plain letters don't trigger Mod shortcuts", () => {
    expect(shortcutFor(key("c"))).toBeNull();
    expect(shortcutFor(key("d", { ctrlKey: true }))).toBe("duplicate");
  });

  it("formats per platform", () => {
    expect(formatCombo("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(formatCombo("Mod+Shift+Z", true)).toBe("⌘⇧Z");
    expect(formatCombo("Delete", false)).toBe("Del");
  });
});
