import { describe, expect, it } from "vitest";
import {
  captureErrorMessage,
  describeMime,
  fileSlug,
  formatBytes,
  formatDuration,
  initialRecordState,
  isCapturing,
  pickRecordingType,
  recordingFilename,
  recordReducer,
  unsupportedReason,
  type RecordEvent,
  type RecordResult,
  type RecordState,
} from "./recordModel";

const result: RecordResult = {
  blob: new Blob(["x"]),
  url: "blob:x",
  mime: "video/webm",
  format: "WebM",
  filename: "a-b.webm",
  durationMs: 1000,
  crop: "element",
};
const run = (...events: RecordEvent[]) => events.reduce(recordReducer, initialRecordState);

describe("record state machine", () => {
  it("goes idle → setup → requesting → countdown 3, 2, 1 → recording → stopping → review → idle", () => {
    let s: RecordState = run({ type: "open" });
    expect(s.phase).toBe("setup");
    s = recordReducer(s, { type: "start" });
    expect(s.phase).toBe("requesting");
    s = recordReducer(s, { type: "granted" });
    expect(s).toMatchObject({ phase: "countdown", count: 3 });
    s = recordReducer(s, { type: "tick", at: 10 });
    s = recordReducer(s, { type: "tick", at: 20 });
    expect(s).toMatchObject({ phase: "countdown", count: 1 });
    s = recordReducer(s, { type: "tick", at: 1234 });
    expect(s).toMatchObject({ phase: "recording", startedAt: 1234 });
    s = recordReducer(s, { type: "stop" });
    expect(s.phase).toBe("stopping");
    s = recordReducer(s, { type: "finished", result });
    expect(s).toMatchObject({ phase: "review", result });
    expect(recordReducer(s, { type: "close" })).toEqual(initialRecordState);
  });

  it("a refused share prompt goes back to the dialog with a message", () => {
    const s = run({ type: "open" }, { type: "start" }, { type: "denied", message: "Not allowed" });
    expect(s).toMatchObject({ phase: "setup", error: "Not allowed" });
    // Starting again clears it.
    expect(recordReducer(s, { type: "start" })).toMatchObject({ phase: "requesting", error: null });
  });

  it("stopping before anything is recorded cancels", () => {
    expect(run({ type: "open" }, { type: "start" }, { type: "granted" }, { type: "stop" })).toEqual(initialRecordState);
    expect(run({ type: "open" }, { type: "start" }, { type: "stop" })).toEqual(initialRecordState);
    // Recording, but the recorder hadn't started yet.
    const unstarted = run(
      { type: "open" },
      { type: "start" },
      { type: "granted", count: 0 },
      { type: "stop", unstarted: true },
    );
    expect(unstarted).toEqual(initialRecordState);
  });

  it("a recorder failure lands in the dialog with its message, never stuck", () => {
    const s = run(
      { type: "open" },
      { type: "start" },
      { type: "granted", count: 0 },
      { type: "failed", message: "Boom" },
    );
    expect(s).toMatchObject({ phase: "setup", error: "Boom" });
  });

  it("a zero countdown records at once", () => {
    expect(run({ type: "open" }, { type: "start" }, { type: "granted", count: 0 }).phase).toBe("recording");
  });

  it("ignores events that don't apply", () => {
    expect(run({ type: "start" })).toEqual(initialRecordState);
    expect(run({ type: "stop" })).toEqual(initialRecordState);
    expect(run({ type: "tick", at: 1 })).toEqual(initialRecordState);
    expect(run({ type: "finished", result })).toEqual(initialRecordState);
    const recording = run({ type: "open" }, { type: "start" }, { type: "granted", count: 0 });
    expect(recordReducer(recording, { type: "open" })).toBe(recording);
    expect(recordReducer(recording, { type: "close" })).toBe(recording);
  });

  it("an undone discard reopens the review", () => {
    expect(run({ type: "reopen", result })).toMatchObject({ phase: "review", result });
  });

  it("knows when the capture is live", () => {
    expect(["requesting", "countdown", "recording", "stopping"].every((p) => isCapturing(p as never))).toBe(true);
    expect(["idle", "setup", "review"].some((p) => isCapturing(p as never))).toBe(false);
  });
});

describe("recording formats", () => {
  it("prefers VP9 WebM, then VP8, then H.264 MP4", () => {
    expect(pickRecordingType(() => true)?.mime).toBe("video/webm;codecs=vp9");
    expect(pickRecordingType((m) => m.includes("vp8"))?.label).toBe("WebM (VP8)");
    // Safari: MP4 only.
    expect(pickRecordingType((m) => m.startsWith("video/mp4"))).toMatchObject({ ext: "mp4", label: "MP4 (H.264)" });
    expect(pickRecordingType(() => false)).toBeNull();
    expect(
      pickRecordingType(() => {
        throw new Error("nope");
      }),
    ).toBeNull();
  });

  it("describes what the recorder actually wrote", () => {
    expect(describeMime("video/webm;codecs=vp9")).toEqual({ ext: "webm", label: "WebM (VP9)" });
    expect(describeMime("video/webm;codecs=VP8,opus")).toEqual({ ext: "webm", label: "WebM (VP8)" });
    expect(describeMime("video/x-matroska")).toEqual({ ext: "webm", label: "WebM" });
    expect(describeMime("video/mp4;codecs=avc1.42E01E")).toEqual({ ext: "mp4", label: "MP4 (H.264)" });
    expect(describeMime("video/mp4")).toEqual({ ext: "mp4", label: "MP4" });
  });

  it("names the file <diagram>-<simulation>.webm", () => {
    expect(recordingFilename("Kafka order pipeline", "Payments service goes down")).toBe(
      "kafka-order-pipeline-payments-service-goes-down.webm",
    );
    expect(recordingFilename("Kafka order pipeline", null)).toBe("kafka-order-pipeline-free-play.webm");
    expect(recordingFilename("  ", "Black Friday: 2,000 orders/s", "mp4")).toBe(
      "diagram-black-friday-2-000-orders-s.mp4",
    );
    expect(fileSlug("Café Ünïcode — système")).toBe("cafe-unicode-systeme");
    expect(fileSlug("x".repeat(80) + " tail").length).toBeLessThanOrEqual(60);
  });

  it("formats durations and sizes for the review", () => {
    expect(formatDuration(7_400)).toBe("0:07");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(81_200)).toBe("81 KB");
    expect(formatBytes(4_321_000)).toBe("4.3 MB");
    expect(formatBytes(43_210_000)).toBe("43 MB");
  });
});

describe("recording support", () => {
  it("says what's missing in plain words", () => {
    const webm = pickRecordingType(() => true);
    expect(unsupportedReason({ displayMedia: true, type: webm })).toBeNull();
    expect(unsupportedReason({ displayMedia: false, type: webm })).toMatch(/can't record a tab/);
    expect(unsupportedReason({ displayMedia: true, type: null })).toMatch(/can't save video/);
  });

  it("explains a refused or failed capture", () => {
    expect(captureErrorMessage(new DOMException("x", "NotAllowedError"))).toMatch(/wasn't allowed/);
    expect(captureErrorMessage(new DOMException("x", "NotReadableError"))).toMatch(/couldn't capture/);
    expect(captureErrorMessage(new TypeError("x"))).toMatch(/can't record a tab/);
    expect(captureErrorMessage("??")).toMatch(/didn't start/);
  });
});
