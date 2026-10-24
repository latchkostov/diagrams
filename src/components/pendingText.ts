import type { PendingKey } from "../canvas/typeAhead";

export interface PendingText {
  value: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

/** Text editing during a held menu uses the same selection state as its mounted field. */
export function pendingTextKey(s: PendingText, key: PendingKey, mac: boolean): PendingText {
  const { value, start, end, direction } = s;
  const command = key.ctrlKey || key.metaKey;
  if (command && key.key.toLowerCase() === "a") return { ...s, start: 0, end: value.length, direction: "forward" };
  const word = mac ? key.altKey : key.ctrlKey;
  const line = mac && key.metaKey;
  // Segment words in Unicode text; punctuation and whitespace separate words.
  const segments = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(value)];
  const previousWord = (at: number) => {
    let previous = 0;
    for (const part of segments) {
      if (part.index >= at) break;
      if (part.isWordLike) previous = part.index;
    }
    return previous;
  };
  const nextWord = (at: number) => {
    const part = segments.find((part) => part.isWordLike && part.index + part.segment.length > at);
    return part ? part.index + part.segment.length : value.length;
  };
  if (["Home", "End", "ArrowLeft", "ArrowRight"].includes(key.key)) {
    const anchor = direction === "backward" ? end : start;
    const edge = direction === "backward" ? start : end;
    const left = key.key === "Home" || key.key === "ArrowLeft";
    const at = key.shiftKey ? edge : left ? start : end;
    const caret =
      key.key === "Home" || (line && left)
        ? 0
        : key.key === "End" || line
          ? value.length
          : word
            ? left
              ? previousWord(at)
              : nextWord(at)
            : left
              ? Math.max(0, at - (key.shiftKey || start === end ? 1 : 0))
              : Math.min(value.length, at + (key.shiftKey || start === end ? 1 : 0));
    return key.shiftKey
      ? {
          ...s,
          start: Math.min(anchor, caret),
          end: Math.max(anchor, caret),
          direction: caret < anchor ? "backward" : "forward",
        }
      : { ...s, start: caret, end: caret, direction: "none" };
  }
  let from = start;
  let to = end;
  let inserted = "";
  if (key.key === "Backspace") {
    if (from === to) from = line ? 0 : word ? previousWord(from) : Math.max(0, from - 1);
  } else if (key.key === "Delete") {
    if (from === to) to = line ? value.length : word ? nextWord(to) : Math.min(value.length, to + 1);
  } else if (key.key.length === 1 && !command && !key.altKey) inserted = key.key;
  else return s;
  const caret = from + inserted.length;
  return { value: value.slice(0, from) + inserted + value.slice(to), start: caret, end: caret, direction: "none" };
}
