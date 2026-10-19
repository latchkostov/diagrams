import type { KeyboardEvent } from "react";

function scheduleSelection(textarea: HTMLTextAreaElement, start: number, end: number) {
  const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : queueMicrotask;
  schedule(() => {
    if (textarea.isConnected) {
      textarea.setSelectionRange(start, end);
    }
  });
}

/** Refuse a transformation atomically: existing content and selection must survive. */
export function applyMarkdownEdit(
  textarea: HTMLTextAreaElement,
  onChange: (value: string) => void,
  value: string,
  start: number,
  end = start,
): boolean {
  if (textarea.maxLength >= 0 && value.length > textarea.maxLength) return false;
  onChange(value);
  scheduleSelection(textarea, start, end);
  return true;
}

export function applyMarkdownWrap(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (val: string) => void,
  prefix: string,
  suffix = prefix,
  defaultPlaceholder = "",
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);

  // Toggle check: if already wrapped inside selection, unwrap
  const isWrappedInside =
    selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length;
  // Or if the characters immediately outside the selection match the wrapper, unwrap
  const isWrappedOutside =
    start >= prefix.length &&
    end + suffix.length <= value.length &&
    value.slice(start - prefix.length, start) === prefix &&
    value.slice(end, end + suffix.length) === suffix;

  if (isWrappedInside) {
    const unwrapped = selected.slice(prefix.length, -suffix.length);
    const nextVal = value.slice(0, start) + unwrapped + value.slice(end);
    applyMarkdownEdit(textarea, onChange, nextVal, start, start + unwrapped.length);
    return;
  }

  if (isWrappedOutside) {
    const nextVal = value.slice(0, start - prefix.length) + selected + value.slice(end + suffix.length);
    applyMarkdownEdit(textarea, onChange, nextVal, start - prefix.length, end - prefix.length);
    return;
  }

  const textToWrap = selected || defaultPlaceholder;
  const replacement = `${prefix}${textToWrap}${suffix}`;
  const nextVal = value.slice(0, start) + replacement + value.slice(end);
  if (selected) {
    applyMarkdownEdit(textarea, onChange, nextVal, start + prefix.length, start + prefix.length + selected.length);
  } else {
    applyMarkdownEdit(
      textarea,
      onChange,
      nextVal,
      start + prefix.length,
      start + prefix.length + defaultPlaceholder.length,
    );
  }
}

export function applyMarkdownLink(textarea: HTMLTextAreaElement, value: string, onChange: (val: string) => void) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);

  if (selected.startsWith("http://") || selected.startsWith("https://")) {
    const replacement = `[title](${selected})`;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    applyMarkdownEdit(textarea, onChange, nextVal, start + 1, start + 6);
  } else if (selected) {
    const replacement = `[${selected}](url)`;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    const urlStart = start + selected.length + 3;
    applyMarkdownEdit(textarea, onChange, nextVal, urlStart, urlStart + 3);
  } else {
    const replacement = `[text](url)`;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    applyMarkdownEdit(textarea, onChange, nextVal, start + 1, start + 5);
  }
}

export function applyMarkdownCode(textarea: HTMLTextAreaElement, value: string, onChange: (val: string) => void) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);

  if (selected.includes("\n")) {
    const replacement = `\`\`\`\n${selected}\n\`\`\``;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    applyMarkdownEdit(textarea, onChange, nextVal, start + 4, start + 4 + selected.length);
  } else {
    applyMarkdownWrap(textarea, value, onChange, "`");
  }
}

export function handleMarkdownListEnter(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (val: string) => void,
): boolean {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start !== end) return false;

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineToCursor = value.slice(lineStart, start);

  // Task list: ^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$
  const taskMatch = lineToCursor.match(/^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$/);
  if (taskMatch) {
    const prefix = taskMatch[1];
    const content = taskMatch[2];
    if (!content.trim()) {
      const nextVal = value.slice(0, lineStart) + value.slice(start);
      applyMarkdownEdit(textarea, onChange, nextVal, lineStart, lineStart);
      return true;
    }
    const newPrefix = prefix.replace(/\[[xX]\]/, "[ ]");
    const nextVal = value.slice(0, start) + "\n" + newPrefix + value.slice(start);
    const pos = start + 1 + newPrefix.length;
    applyMarkdownEdit(textarea, onChange, nextVal, pos);
    return true;
  }

  // Bullet list: ^(\s*[-*+]\s+)(.*)$
  const bulletMatch = lineToCursor.match(/^(\s*[-*+]\s+)(.*)$/);
  if (bulletMatch) {
    const prefix = bulletMatch[1];
    const content = bulletMatch[2];
    if (!content.trim()) {
      const nextVal = value.slice(0, lineStart) + value.slice(start);
      applyMarkdownEdit(textarea, onChange, nextVal, lineStart, lineStart);
      return true;
    }
    const nextVal = value.slice(0, start) + "\n" + prefix + value.slice(start);
    const pos = start + 1 + prefix.length;
    applyMarkdownEdit(textarea, onChange, nextVal, pos);
    return true;
  }

  // Ordered list: ^(\s*)(\d+)(\.\s+)(.*)$
  const orderedMatch = lineToCursor.match(/^(\s*)(\d+)(\.\s+)(.*)$/);
  if (orderedMatch) {
    const indent = orderedMatch[1];
    const num = parseInt(orderedMatch[2], 10);
    const dot = orderedMatch[3];
    const content = orderedMatch[4];
    if (!content.trim()) {
      const nextVal = value.slice(0, lineStart) + value.slice(start);
      applyMarkdownEdit(textarea, onChange, nextVal, lineStart, lineStart);
      return true;
    }
    const newPrefix = `${indent}${num + 1}${dot}`;
    const nextVal = value.slice(0, start) + "\n" + newPrefix + value.slice(start);
    const pos = start + 1 + newPrefix.length;
    applyMarkdownEdit(textarea, onChange, nextVal, pos);
    return true;
  }

  return false;
}

/**
 * Handles Markdown formatting keyboard shortcuts and smart list continuation on a textarea.
 * Returns true if the event was handled.
 */
export function handleMarkdownKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (val: string) => void,
): boolean {
  if (e.nativeEvent.isComposing) return false;

  if ((e.ctrlKey || e.metaKey) && (e.key === "]" || e.key === "[")) {
    e.preventDefault();
    e.stopPropagation();
    const next = indentMarkdown(value, textarea.selectionStart, textarea.selectionEnd, e.key === "[");
    applyMarkdownEdit(textarea, onChange, next.value, next.start, next.end);
    return true;
  }

  // Smart Enter in lists (plain Enter without modifiers)
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (handleMarkdownListEnter(textarea, value, onChange)) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    return false;
  }

  const isMod = e.ctrlKey || e.metaKey;
  if (!isMod || e.altKey) return false;

  const key = e.key.toLowerCase();

  // Ctrl/Cmd+B: Bold
  if (key === "b" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMarkdownWrap(textarea, value, onChange, "**");
    return true;
  }

  // Ctrl/Cmd+I: Italic
  if (key === "i" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMarkdownWrap(textarea, value, onChange, "*");
    return true;
  }

  // Ctrl/Cmd+K: Link
  if (key === "k" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMarkdownLink(textarea, value, onChange);
    return true;
  }

  // Ctrl/Cmd+E: Inline or block code
  if (key === "e" && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMarkdownCode(textarea, value, onChange);
    return true;
  }

  // Ctrl/Cmd+Shift+X: Strikethrough
  if (key === "x" && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMarkdownWrap(textarea, value, onChange, "~~");
    return true;
  }

  // Ctrl/Cmd+Shift+H: Highlight
  if (key === "h" && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    applyMarkdownWrap(textarea, value, onChange, "==");
    return true;
  }

  return false;
}

// Indent every selected line without replacing the selected contents.
export function indentMarkdown(value: string, start: number, end: number, unindent: boolean) {
  const first = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const stop = value.indexOf("\n", last);
  const limit = stop < 0 ? value.length : stop;
  let delta = 0;
  let firstDelta = 0;
  const lines = value
    .slice(first, limit)
    .split("\n")
    .map((line, i) => {
      const removed = unindent ? (line.startsWith("\t") ? 1 : Math.min(2, line.length - line.trimStart().length)) : 0;
      const change = unindent ? -removed : 2;
      delta += change;
      if (i === 0) firstDelta = change;
      return unindent ? line.slice(removed) : "  " + line;
    });
  return {
    value: value.slice(0, first) + lines.join("\n") + value.slice(limit),
    start: Math.max(first, start + firstDelta),
    end: Math.max(first, end + delta),
  };
}
