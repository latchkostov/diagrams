// Recording formats and download messages load with the recorder.
export {
  COUNTDOWN,
  initialRecordState,
  recordReducer,
  isCapturing,
  type RecordPhase,
  type RecordResult,
  type CropMode,
  type RecordState,
  type RecordEvent,
} from "./recordState";

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
