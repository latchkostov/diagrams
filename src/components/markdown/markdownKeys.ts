import type { KeyboardEvent } from "react";

function scheduleSelection(textarea: HTMLTextAreaElement, start: number, end: number) {
  const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : queueMicrotask;
  schedule(() => {
    if (textarea.isConnected) {
      textarea.setSelectionRange(start, end);
    }
  });
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
    onChange(nextVal);
    scheduleSelection(textarea, start, start + unwrapped.length);
    return;
  }

  if (isWrappedOutside) {
    const nextVal = value.slice(0, start - prefix.length) + selected + value.slice(end + suffix.length);
    onChange(nextVal);
    scheduleSelection(textarea, start - prefix.length, end - prefix.length);
    return;
  }

  const textToWrap = selected || defaultPlaceholder;
  const replacement = `${prefix}${textToWrap}${suffix}`;
  const nextVal = value.slice(0, start) + replacement + value.slice(end);
  onChange(nextVal);

  if (selected) {
    scheduleSelection(textarea, start + prefix.length, start + prefix.length + selected.length);
  } else {
    scheduleSelection(textarea, start + prefix.length, start + prefix.length + defaultPlaceholder.length);
  }
}

export function applyMarkdownLink(textarea: HTMLTextAreaElement, value: string, onChange: (val: string) => void) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);

  if (selected.startsWith("http://") || selected.startsWith("https://")) {
    const replacement = `[title](${selected})`;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    onChange(nextVal);
    scheduleSelection(textarea, start + 1, start + 6);
  } else if (selected) {
    const replacement = `[${selected}](url)`;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    onChange(nextVal);
    const urlStart = start + selected.length + 3;
    scheduleSelection(textarea, urlStart, urlStart + 3);
  } else {
    const replacement = `[text](url)`;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    onChange(nextVal);
    scheduleSelection(textarea, start + 1, start + 5);
  }
}

export function applyMarkdownCode(textarea: HTMLTextAreaElement, value: string, onChange: (val: string) => void) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);

  if (selected.includes("\n")) {
    const replacement = `\`\`\`\n${selected}\n\`\`\``;
    const nextVal = value.slice(0, start) + replacement + value.slice(end);
    onChange(nextVal);
    scheduleSelection(textarea, start + 4, start + 4 + selected.length);
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
      onChange(nextVal);
      scheduleSelection(textarea, lineStart, lineStart);
      return true;
    }
    const newPrefix = prefix.replace(/\[[xX]\]/, "[ ]");
    const nextVal = value.slice(0, start) + "\n" + newPrefix + value.slice(start);
    onChange(nextVal);
    const pos = start + 1 + newPrefix.length;
    scheduleSelection(textarea, pos, pos);
    return true;
  }

  // Bullet list: ^(\s*[-*+]\s+)(.*)$
  const bulletMatch = lineToCursor.match(/^(\s*[-*+]\s+)(.*)$/);
  if (bulletMatch) {
    const prefix = bulletMatch[1];
    const content = bulletMatch[2];
    if (!content.trim()) {
      const nextVal = value.slice(0, lineStart) + value.slice(start);
      onChange(nextVal);
      scheduleSelection(textarea, lineStart, lineStart);
      return true;
    }
    const nextVal = value.slice(0, start) + "\n" + prefix + value.slice(start);
    onChange(nextVal);
    const pos = start + 1 + prefix.length;
    scheduleSelection(textarea, pos, pos);
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
      onChange(nextVal);
      scheduleSelection(textarea, lineStart, lineStart);
      return true;
    }
    const newPrefix = `${indent}${num + 1}${dot}`;
    const nextVal = value.slice(0, start) + "\n" + newPrefix + value.slice(start);
    onChange(nextVal);
    const pos = start + 1 + newPrefix.length;
    scheduleSelection(textarea, pos, pos);
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
