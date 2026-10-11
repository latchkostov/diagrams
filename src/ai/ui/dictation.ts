// Transcript merging for dictation, kept pure so it's unit-tested without a browser.
//
// The Web Speech API (continuous + interimResults) reports, per session, a growing list of results:
// final ones first (stable), then the words it's still unsure of (interim). Final results are written
// into the text at the caret as they arrive; interim words are only shown, never written. When the
// browser ends a session on silence and we restart it, the list starts over from zero.

export interface SpeechText {
  value: string;
  /** Where spoken words go (a caret index into `value`). */
  caret: number;
}

export interface SpokenResult {
  isFinal: boolean;
  transcript: string;
}

export interface MergeState extends SpeechText {
  /** How many final results of the current session are already in `value`. */
  committed: number;
}

export interface MergeOutput extends MergeState {
  /** Words heard but not settled yet: shown lighter, not written. */
  interim: string;
}

const SENTENCE_END = /[.!?]\s*$/;

/** Writes spoken words at the caret, with a space between them and their neighbours. */
export function insertSpoken(text: SpeechText, spoken: string): SpeechText {
  let words = spoken.replace(/\s+/g, " ").trim();
  if (!words) return text;
  const caret = Math.max(0, Math.min(text.caret, text.value.length));
  const before = text.value.slice(0, caret);
  const after = text.value.slice(caret);
  // A new sentence starts with a capital; mid-sentence words stay as heard.
  if (!before.trim() || SENTENCE_END.test(before)) words = words[0].toUpperCase() + words.slice(1);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? " " : "";
  const value = before + lead + words + trail + after;
  return { value, caret: before.length + lead.length + words.length };
}

/** Folds a result event into the text: new final results are written, the rest becomes interim. */
export function mergeResults(state: MergeState, results: ArrayLike<SpokenResult>): MergeOutput {
  let text: SpeechText = { value: state.value, caret: state.caret };
  let committed = state.committed;
  let interim = "";
  for (let i = committed; i < results.length; i++) {
    const r = results[i];
    // Only settle results in order: a final after an interim one waits for it.
    if (r.isFinal && i === committed && !interim) {
      text = insertSpoken(text, r.transcript);
      committed++;
    } else {
      interim += r.transcript;
    }
  }
  return { ...text, committed, interim: interim.replace(/\s+/g, " ").trim() };
}

/** What a recognition error means for the person dictating. */
export type SpeechErrorKind = "denied" | "no-mic" | "no-speech" | "network" | "language" | "aborted" | "other";

export function speechErrorKind(code: string): SpeechErrorKind {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "audio-capture":
      return "no-mic";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "language-not-supported":
      return "language";
    case "aborted":
      return "aborted";
    default:
      return "other";
  }
}

/** Friendly, inline words for each error. Null: nothing worth saying (we stopped it ourselves). */
export function speechErrorMessage(kind: SpeechErrorKind): string | null {
  switch (kind) {
    case "denied":
      return "The microphone is blocked. Allow it from the icon in the address bar, then try again.";
    case "no-mic":
      return "No microphone was found. Plug one in, or type instead.";
    case "no-speech":
      return "Didn't catch that. Still listening…";
    case "network":
      return "The speech service couldn't be reached. Check your connection, or type instead.";
    case "language":
      return "Dictation doesn't support your browser's language yet. Type instead.";
    case "aborted":
      return null;
    default:
      return "Dictation stopped unexpectedly. Try again.";
  }
}

/** Errors that end listening for good (the rest restart quietly). */
export const isFatalSpeechError = (kind: SpeechErrorKind) =>
  kind === "denied" || kind === "no-mic" || kind === "network" || kind === "language" || kind === "other";
