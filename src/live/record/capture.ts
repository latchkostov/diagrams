// The browser half of "Record video": capture this tab, frame it to the diagram, record it.
//
// Why tab capture: the particles are a <canvas> but the nodes, edges, badges, notes and title are
// DOM and SVG. Re-drawing all of that into a canvas per frame would be a second renderer (fonts,
// icons, filters, themes) that drifts from what people see. Capturing the tab records exactly what
// the browser composites, at the screen's resolution and frame rate, with no extra code per feature.
//
// Framing, best first:
//  1. Element Capture (`RestrictionTarget` + `track.restrictTo`, Chrome / Edge 132+): only the canvas
//     area and what's inside it, so the recording indicator and anything outside never appear.
//  2. Region Capture (`CropTarget` + `track.cropTo`, Chrome / Edge 104+): cropped to the canvas area.
//  3. Otherwise the whole surface the person chose (Firefox and Safari offer windows and screens).
//     The live view hides its editing chrome while recording, so a tab capture is mostly diagram.

import { pickRecordingType, type CropMode, type RecordingType } from "./recordModel";

interface ElementTargetClass {
  fromElement(element: Element): Promise<unknown>;
}
type CaptureTrack = MediaStreamTrack & {
  restrictTo?: (target: unknown) => Promise<void>;
  cropTo?: (target: unknown) => Promise<void>;
};

const win = () =>
  globalThis as typeof globalThis & {
    RestrictionTarget?: ElementTargetClass;
    CropTarget?: ElementTargetClass;
  };

/** What this browser can do (checked when the setup dialog opens). */
export function captureSupport(): { displayMedia: boolean; type: RecordingType | null } {
  const displayMedia =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
  const type =
    typeof MediaRecorder === "function" && typeof MediaRecorder.isTypeSupported === "function"
      ? pickRecordingType((m) => MediaRecorder.isTypeSupported(m))
      : null;
  return { displayMedia, type };
}

/** Whether the canvas area can be framed exactly (for the setup dialog's wording). */
export function canFrameToElement(): boolean {
  return !!(win().RestrictionTarget || win().CropTarget);
}

/**
 * Opens the browser's share prompt, offering this tab first. Must be called from a click (the
 * browser requires a user gesture), before any await.
 */
export function requestTabCapture(): Promise<MediaStream> {
  const options = {
    video: { displaySurface: "browser", frameRate: { ideal: 30, max: 60 } },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  };
  return navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
}

/**
 * Frames the capture to `target`: Element Capture, then Region Capture, else nothing. Both only
 * work when the person shared this tab; any refusal falls through to the next option.
 */
export async function frameTo(stream: MediaStream, target: Element | null): Promise<CropMode> {
  const track = stream.getVideoTracks()[0] as CaptureTrack | undefined;
  if (!track || !target) return "none";
  const { RestrictionTarget, CropTarget } = win();
  if (RestrictionTarget && typeof track.restrictTo === "function") {
    try {
      await track.restrictTo(await RestrictionTarget.fromElement(target));
      return "element";
    } catch {
      // Another surface was shared, or the element isn't eligible: try a crop.
    }
  }
  if (CropTarget && typeof track.cropTo === "function") {
    try {
      await track.cropTo(await CropTarget.fromElement(target));
      return "region";
    } catch {
      // Another surface was shared: record it whole.
    }
  }
  return "none";
}

export function stopStream(stream: MediaStream | null): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
}

/** ~8 Mbit/s keeps 1–2 px edges and small labels crisp at 1080p and above. */
const VIDEO_BITS_PER_SECOND = 8_000_000;

export interface Recording {
  recorder: MediaRecorder;
  /** Resolves with the whole video once the recorder has stopped. */
  done: Promise<Blob>;
}

/** A MediaRecorder for `stream`; not started. Chunks are collected every second. */
export function createRecording(stream: MediaStream, type: RecordingType): Recording {
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
  } catch {
    recorder = new MediaRecorder(stream);
  }
  const chunks: Blob[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: recorder.mimeType || type.mime })));
    recorder.addEventListener("error", (e) => reject((e as Event & { error?: unknown }).error ?? e));
  });
  return { recorder, done };
}
