import { describe, expect, it } from "vitest";
import { editKeyAction } from "./editKeys";

const key = (
  k: string,
  mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }> = {},
) => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  ...mods,
});

describe("editKeyAction: one set of rules for every inline editor", () => {
  it("Esc saves everywhere", () => {
    expect(editKeyAction(key("Escape"))).toBe("save");
    expect(editKeyAction(key("Escape"), { multiline: true })).toBe("save");
    expect(editKeyAction(key("Escape"), { hasNext: true })).toBe("save");
  });

  it("Enter saves a single line; in several lines it adds one, and Ctrl/Cmd+Enter saves", () => {
    expect(editKeyAction(key("Enter"))).toBe("save");
    expect(editKeyAction(key("Enter"), { multiline: true })).toBeNull();
    expect(editKeyAction(key("Enter", { ctrlKey: true }), { multiline: true })).toBe("save");
    expect(editKeyAction(key("Enter", { metaKey: true }), { multiline: true })).toBe("save");
  });

  it("Tab goes to the next field, Shift+Tab back, and either saves at the end", () => {
    expect(editKeyAction(key("Tab"), { hasNext: true })).toBe("next");
    expect(editKeyAction(key("Tab"))).toBe("save");
    expect(editKeyAction(key("Tab", { shiftKey: true }), { hasPrev: true })).toBe("prev");
    expect(editKeyAction(key("Tab", { shiftKey: true }))).toBe("save");
    expect(editKeyAction(key("Tab"), { multiline: true })).toBe("save");
  });

  it("leaves other keys, and keys of an input method mid-composition, to the field", () => {
    expect(editKeyAction(key("a"))).toBeNull();
    expect(editKeyAction(key("Enter", { isComposing: true }))).toBeNull();
    expect(editKeyAction(key("Escape", { isComposing: true }))).toBeNull();
  });
});
