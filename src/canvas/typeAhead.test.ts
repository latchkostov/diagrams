import { describe, expect, it } from "vitest";
import { typeAheadKey, type TypeAhead } from "./typeAhead";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});
const typeAll = (keys: string[]) => keys.reduce<TypeAhead>((s, k) => typeAheadKey(s, key(k)) ?? s, { text: null });

describe("typeAheadKey: keys typed before a new node's label editor opens", () => {
  it("keeps annotation newlines and commits buffered words with Escape, Tab or Mod+Enter", () => {
    let state: TypeAhead = { text: null };
    for (const k of ["a", "Enter", "b"]) state = typeAheadKey(state, key(k), true)!;
    expect(state).toEqual({ text: "a\nb" });
    expect(typeAheadKey(state, key("Escape"), true)).toEqual({ text: "a\nb", done: "escape" });
    expect(typeAheadKey(state, key("Tab"), true)).toEqual({ text: "a\nb", done: "enter" });
    expect(typeAheadKey(state, key("Enter", { ctrlKey: true }), true)).toEqual({ text: "a\nb", done: "enter" });
  });
  it("collects printable keys, T and spaces included (none reach the canvas)", () => {
    expect(typeAll(["t", "o", "p", "i", "c", " ", "A"])).toEqual({ text: "topic A" });
  });

  it("Backspace edits what was typed; on nothing yet it clears the name, as in the editor", () => {
    expect(typeAll(["a", "b", "Backspace"])).toEqual({ text: "a" });
    expect(typeAll(["Backspace"])).toEqual({ text: "" });
  });

  it("Enter and Esc end it; keys after that are left alone", () => {
    expect(typeAll(["a", "Enter"])).toEqual({ text: "a", done: "enter" });
    expect(typeAll(["Escape"])).toEqual({ text: null, done: "escape" });
    expect(typeAheadKey({ text: "a", done: "enter" }, key("b"))).toBeNull();
  });

  it("leaves shortcuts and other keys alone", () => {
    expect(typeAheadKey({ text: null }, key("z", { ctrlKey: true }))).toBeNull();
    expect(typeAheadKey({ text: null }, key("ArrowLeft"))).toBeNull();
    expect(typeAheadKey({ text: null }, key("Shift"))).toBeNull();
  });
});
