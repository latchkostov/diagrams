// "Record video" for the live view: the pure parts (no DOM, no React), unit-tested directly.
//
//   idle → setup → requesting → countdown → recording → stopping → review → idle
//
// `setup` is the small dialog with the options; its Start button is the user gesture the browser's
// share prompt needs (`requesting`). A refusal goes back to `setup` with a message, never to a
// broken state. The 3-2-1 countdown runs while the capture is already live but nothing is recorded
// yet, so the countdown itself is never in the video. Stop (button, Esc, the browser's own "Stop
// sharing", or the simulation finishing) moves to `stopping` until the recorder hands over its data.

export type RecordPhase = "idle" | "setup" | "requesting" | "countdown" | "recording" | "stopping" | "review";

/** A finished recording, ready to preview and download. */
export interface RecordResult {
  blob: Blob;
  /** Object URL for the preview and the download (revoked when it's discarded). */
  url: string;
  mime: string;
  /** e.g. "WebM (VP9)". */
  format: string;
  filename: string;
  durationMs: number;
  /** How the video was framed: just the diagram (element / region capture) or the whole surface. */
  crop: CropMode;
}

export type CropMode = "element" | "region" | "none";

export interface RecordState {
  phase: RecordPhase;
  /** Countdown seconds left (3, 2, 1). */
  count: number;
  /** performance.now() when the recorder started; 0 before. */
  startedAt: number;
  result: RecordResult | null;
  /** Why the last attempt didn't start (shown in the setup dialog). */
  error: string | null;
}

export type RecordEvent =
  | { type: "open" }
  | { type: "start" }
  | { type: "granted"; count?: number }
  | { type: "denied"; message: string }
  | { type: "tick"; at: number }
  /** `unstarted`: the recorder hadn't started (it starts two frames after the countdown), so nothing was recorded. */
  | { type: "stop"; unstarted?: boolean }
  | { type: "finished"; result: RecordResult }
  | { type: "failed"; message: string }
  | { type: "close" }
  | { type: "reopen"; result: RecordResult };

export const COUNTDOWN = 3;

export const initialRecordState: RecordState = { phase: "idle", count: 0, startedAt: 0, result: null, error: null };

/** The state machine. Events that don't apply to the current phase leave it unchanged. */
export function recordReducer(state: RecordState, event: RecordEvent): RecordState {
  switch (event.type) {
    case "open":
      return state.phase === "idle" ? { ...initialRecordState, phase: "setup" } : state;
    case "start":
      return state.phase === "setup" ? { ...state, phase: "requesting", error: null } : state;
    case "granted": {
      if (state.phase !== "requesting") return state;
      const count = Math.max(0, Math.round(event.count ?? COUNTDOWN));
      return count > 0 ? { ...state, phase: "countdown", count } : { ...state, phase: "recording", count: 0 };
    }
    case "denied":
      return state.phase === "requesting" ? { ...state, phase: "setup", error: event.message } : state;
    case "tick":
      if (state.phase !== "countdown") return state;
      return state.count > 1
        ? { ...state, count: state.count - 1 }
        : { ...state, phase: "recording", count: 0, startedAt: event.at };
    case "stop":
      // Nothing recorded yet: stopping during the countdown (or the prompt, or before the recorder starts)
      // just cancels.
      if (state.phase === "recording") return event.unstarted ? initialRecordState : { ...state, phase: "stopping" };
      if (state.phase === "countdown" || state.phase === "requesting") return initialRecordState;
      return state;
    case "finished":
      return state.phase === "stopping" || state.phase === "recording"
        ? { ...state, phase: "review", result: event.result }
        : state;
    case "failed":
      return state.phase === "idle" || state.phase === "review"
        ? state
        : { ...initialRecordState, phase: "setup", error: event.message };
    case "close":
      return state.phase === "setup" || state.phase === "review" ? initialRecordState : state;
    case "reopen":
      return state.phase === "idle" ? { ...initialRecordState, phase: "review", result: event.result } : state;
  }
}

/** True while the capture is live (the chrome is hidden and Esc stops). */
export const isCapturing = (phase: RecordPhase) =>
  phase === "requesting" || phase === "countdown" || phase === "recording" || phase === "stopping";
