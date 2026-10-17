import { describe, expect, it } from "vitest";
import { isMac, formatCombo, matches, shortcutFor, type KeyLike } from "./shortcuts";

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

  it("keyboard selection between nodes doesn't collide with nudges or Alt+arrow quick-add (D14)", () => {
    expect(shortcutFor(key("ArrowRight", { ctrlKey: true, altKey: true }))).toBe("select-toward");
    expect(shortcutFor(key("ArrowRight", { altKey: true }))).toBe("add-next");
    expect(shortcutFor(key("ArrowRight", { altKey: true, shiftKey: true }))).toBe("clone-next");
    expect(shortcutFor(key("ArrowRight"))).toBe("nudge");
    // Ctrl is the Control key: ⌘⌥+arrows switch the browser's tabs on a Mac, so they stay the browser's.
    expect(shortcutFor(key("ArrowRight", { metaKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(key("Tab"))).toBe("select-next");
    expect(shortcutFor(key("Tab", { shiftKey: true }))).toBe("select-prev");
  });

  it("Ctrl+Alt+] and [ go by the physical bracket key or the printed one", () => {
    expect(shortcutFor({ ...key("]", { ctrlKey: true, altKey: true }), code: "BracketRight" })).toBe("select-edge-out");
    expect(shortcutFor({ ...key("[", { ctrlKey: true, altKey: true }), code: "BracketLeft" })).toBe("select-edge-in");
    // A layout where Ctrl+Alt on that key prints something else.
    expect(shortcutFor({ ...key("+", { ctrlKey: true, altKey: true }), code: "BracketRight" })).toBe("select-edge-out");
    expect(shortcutFor({ ...key("]"), code: "BracketRight" })).toBeNull();
  });

  it("formats per platform", () => {
    expect(formatCombo("Ctrl+Alt+]", false)).toBe("Ctrl+Alt+]");
    expect(formatCombo("Ctrl+Alt+]", true)).toBe("⌃⌥]");
    expect(formatCombo("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(formatCombo("Mod+Shift+Z", true)).toBe("⌘⇧Z");
    expect(formatCombo("Delete", false)).toBe("Del");
  });
});

it.each([
  ["MacIntel", true],
  ["iPad", true],
  ["Win32", false],
  ["Linux x86_64", false],
])("identifies an explicit platform %s", (platform, mac) => {
  expect(isMac(platform)).toBe(mac);
});
