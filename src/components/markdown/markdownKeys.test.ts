import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import {
  indentMarkdown,
  applyMarkdownCode,
  applyMarkdownLink,
  applyMarkdownWrap,
  handleMarkdownKeyDown,
  handleMarkdownListEnter,
} from "./markdownKeys";

function fakeTextarea(value: string, selectionStart: number, selectionEnd = selectionStart): HTMLTextAreaElement {
  const ta = {
    value,
    selectionStart,
    selectionEnd,
    isConnected: true,
    setSelectionRange(start: number, end: number) {
      ta.selectionStart = start;
      ta.selectionEnd = end;
    },
  };
  return ta as unknown as HTMLTextAreaElement;
}

describe("markdownKeys", () => {
  it("wraps and unwraps bold/italic/strikethrough/highlight", () => {
    let val = "Hello world";
    const ta = fakeTextarea(val, 6, 11); // "world"
    applyMarkdownWrap(ta, val, (next) => (val = next), "**");
    expect(val).toBe("Hello **world**");

    // Unwrap when wrapped outside selection
    const ta2 = fakeTextarea(val, 8, 13); // "world" inside "**world**"
    applyMarkdownWrap(ta2, val, (next) => (val = next), "**");
    expect(val).toBe("Hello world");

    // Unwrap when selection includes markers
    val = "Hello **world**";
    const ta3 = fakeTextarea(val, 6, 15); // "**world**"
    applyMarkdownWrap(ta3, val, (next) => (val = next), "**");
    expect(val).toBe("Hello world");
  });

  it("formats links for text, URLs, and empty selections", () => {
    let val = "Read docs";
    const ta1 = fakeTextarea(val, 5, 9); // "docs"
    applyMarkdownLink(ta1, val, (next) => (val = next));
    expect(val).toBe("Read [docs](url)");

    val = "Visit https://example.com";
    const ta2 = fakeTextarea(val, 6, 25); // "https://example.com"
    applyMarkdownLink(ta2, val, (next) => (val = next));
    expect(val).toBe("Visit [title](https://example.com)");

    val = "";
    const ta3 = fakeTextarea(val, 0, 0);
    applyMarkdownLink(ta3, val, (next) => (val = next));
    expect(val).toBe("[text](url)");
  });

  it("formats inline code and multiline fenced code blocks", () => {
    let val = "run pnpm test";
    const ta1 = fakeTextarea(val, 4, 13);
    applyMarkdownCode(ta1, val, (next) => (val = next));
    expect(val).toBe("run `pnpm test`");

    val = "const a = 1;\nconst b = 2;";
    const ta2 = fakeTextarea(val, 0, val.length);
    applyMarkdownCode(ta2, val, (next) => (val = next));
    expect(val).toBe("```\nconst a = 1;\nconst b = 2;\n```");
  });

  it("continues bullet, ordered, and task lists on Enter and exits on empty item", () => {
    // Bullet continuation
    let val = "- First item";
    const ta1 = fakeTextarea(val, val.length);
    expect(handleMarkdownListEnter(ta1, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("- First item\n- ");

    // Bullet exit on empty item
    const ta2 = fakeTextarea(val, val.length);
    expect(handleMarkdownListEnter(ta2, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("- First item\n");

    // Ordered list increment
    val = "1. Step one";
    const ta3 = fakeTextarea(val, val.length);
    expect(handleMarkdownListEnter(ta3, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("1. Step one\n2. ");

    // Task list continuation resets [x] to [ ]
    val = "- [x] Done task";
    const ta4 = fakeTextarea(val, val.length);
    expect(handleMarkdownListEnter(ta4, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("- [x] Done task\n- [ ] ");
  });

  it("handles keyboard shortcuts via handleMarkdownKeyDown", () => {
    let val = "service";
    const ta = fakeTextarea(val, 0, 7);
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    const makeEvent = (key: string, opts: Partial<KeyboardEvent<HTMLTextAreaElement>> = {}) =>
      ({
        key,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        nativeEvent: { isComposing: false },
        preventDefault,
        stopPropagation,
        ...opts,
      }) as unknown as KeyboardEvent<HTMLTextAreaElement>;

    expect(handleMarkdownKeyDown(makeEvent("b"), ta, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("**service**");
    expect(preventDefault).toHaveBeenCalled();

    val = "service";
    const taItalic = fakeTextarea(val, 0, 7);
    expect(handleMarkdownKeyDown(makeEvent("i"), taItalic, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("*service*");

    val = "service";
    const taStrike = fakeTextarea(val, 0, 7);
    expect(handleMarkdownKeyDown(makeEvent("X", { shiftKey: true }), taStrike, val, (next) => (val = next))).toBe(true);
    expect(val).toBe("~~service~~");

    val = "service";
    const taHighlight = fakeTextarea(val, 0, 7);
    expect(handleMarkdownKeyDown(makeEvent("H", { shiftKey: true }), taHighlight, val, (next) => (val = next))).toBe(
      true,
    );
    expect(val).toBe("==service==");
  });
});

it("indents and unindents every selected line while retaining the selection and contents", () => {
  const original = "- alpha\n- beta\nlast";
  const indented = indentMarkdown(original, 0, 15, false);
  expect(indented).toEqual({ value: "  - alpha\n  - beta\nlast", start: 2, end: 19 });
  expect(indentMarkdown(indented.value, 0, 19, true)).toEqual({ value: original, start: 0, end: 15 });
  expect(indentMarkdown("a\nb", 0, 2, false).value).toBe("  a\nb");
});
