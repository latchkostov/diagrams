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
  | { type: "stop" }
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
      if (state.phase === "recording") return { ...state, phase: "stopping" };
      // Nothing recorded yet: stopping during the countdown (or the prompt) just cancels.
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

// ---------------------------------------------------------------- formats

export interface RecordingType {
  mime: string;
  ext: "webm" | "mp4";
  label: string;
}

/** Preference order: WebM (VP9, then VP8), then H.264 MP4 where WebM can't be recorded (Safari). */
export const RECORDING_TYPES: readonly RecordingType[] = [
  { mime: "video/webm;codecs=vp9", ext: "webm", label: "WebM (VP9)" },
  { mime: "video/webm;codecs=vp8", ext: "webm", label: "WebM (VP8)" },
  { mime: "video/webm", ext: "webm", label: "WebM" },
  { mime: "video/mp4;codecs=avc1", ext: "mp4", label: "MP4 (H.264)" },
  { mime: "video/mp4", ext: "mp4", label: "MP4" },
];

/** The first type the browser's MediaRecorder can write, or null when it can't write any of them. */
export function pickRecordingType(isTypeSupported: (mime: string) => boolean): RecordingType | null {
  for (const t of RECORDING_TYPES) {
    try {
      if (isTypeSupported(t.mime)) return t;
    } catch {
      // A throwing check counts as unsupported.
    }
  }
  return null;
}

/** The extension and words for what the recorder actually wrote (it can differ from what was asked). */
export function describeMime(mime: string): Pick<RecordingType, "ext" | "label"> {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return { ext: "mp4", label: /avc1|h264/.test(m) ? "MP4 (H.264)" : "MP4" };
  return { ext: "webm", label: m.includes("vp9") ? "WebM (VP9)" : m.includes("vp8") ? "WebM (VP8)" : "WebM" };
}

/** "Kafka order pipeline" → "kafka-order-pipeline" (ASCII, no leading / trailing dashes, ≤ 60 chars). */
export function fileSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** `<diagram>-<simulation>.webm`; free play is "free-play". */
export function recordingFilename(diagram: string, simulation: string | null, ext: RecordingType["ext"] = "webm") {
  const d = fileSlug(diagram) || "diagram";
  const s = fileSlug(simulation ?? "") || "free-play";
  return `${d}-${s}.${ext}`;
}

/** 0:07, 1:05, 1:02:03. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** 812 KB, 4.3 MB (decimal units, as file managers and Slack show them). */
export function formatBytes(bytes: number): string {
  const b = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (b < 1000) return `${Math.round(b)} B`;
  if (b < 1_000_000) return `${Math.round(b / 1000)} KB`;
  if (b < 1_000_000_000) return `${(b / 1_000_000).toFixed(b < 10_000_000 ? 1 : 0)} MB`;
  return `${(b / 1_000_000_000).toFixed(1)} GB`;
}

// ---------------------------------------------------------------- support

export interface CaptureSupport {
  /** navigator.mediaDevices.getDisplayMedia exists (secure context, desktop browser). */
  displayMedia: boolean;
  /** MediaRecorder exists and can write one of RECORDING_TYPES. */
  type: RecordingType | null;
}

/** Null when recording can work here; otherwise what to tell people. */
export function unsupportedReason(s: CaptureSupport): string | null {
  if (!s.displayMedia)
    return "This browser can't record a tab. Use a desktop version of Chrome, Edge or Firefox, or your system's screen recorder.";
  if (!s.type)
    return "This browser can't save video recordings. Use a recent Chrome, Edge, Firefox or Safari, or your system's screen recorder.";
  return null;
}

/** Plain words for a getDisplayMedia / MediaRecorder failure. */
export function captureErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "AbortError")
    return "Recording didn't start: sharing this tab wasn't allowed. Start again and choose Allow (or this tab) when the browser asks.";
  if (name === "NotFoundError" || name === "NotReadableError")
    return "Recording didn't start: the browser couldn't capture this tab. Close other screen recordings and try again.";
  if (name === "NotSupportedError" || name === "TypeError")
    return "This browser can't record a tab. Use a desktop version of Chrome, Edge or Firefox, or your system's screen recorder.";
  return "Recording didn't start. Try again, or use your system's screen recorder.";
}
