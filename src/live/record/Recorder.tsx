import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../../interop/ui/Dialog";
import { notify } from "../../interop/ui/toast";
import type { LiveController, LiveState } from "../controller";
import { LiveIcon } from "../icons";
import { canFrameToElement, captureSupport, createRecording, frameTo, requestTabCapture, stopStream } from "./capture";
import type { Recording } from "./capture";
import { RECORDING_ATTR, setPresentation, setRecordingActive } from "./framing";
import {
  captureErrorMessage,
  describeMime,
  formatBytes,
  formatDuration,
  isCapturing,
  recordingFilename,
  unsupportedReason,
  type CropMode,
  type RecordEvent,
  type RecordResult,
  type RecordState,
} from "./recordModel";
import { fixWebmDuration } from "./webmDuration";

/** After the run finishes, keep recording this long so the last messages land and "Done" shows. */
const END_TAIL_MS = 1500;
/** A pausing note in an unattended take holds this long, then the story continues. */
const NOTE_HOLD_MS = 5000;
/** Undo for Discard, before the video is released. */
const UNDO_MS = 8000;

interface Options {
  /** Play the selected simulation from 0:00 and stop when it ends. */
  fromStart: boolean;
  /** Presentation view for the take (hides editing chrome, larger type). */
  present: boolean;
}

export interface RecorderProps {
  rec: RecordState;
  dispatch: Dispatch<RecordEvent>;
  controller: LiveController;
  state: LiveState;
  /** The element the video is framed to (the canvas area). */
  target: () => Element | null;
  /** The diagram's title (for the file name). */
  title: () => string;
  /** Already in presentation mode. */
  presenting: boolean;
  /** Presentation mode exists here (the canvas; not the Lab). */
  canPresent: boolean;
}

/**
 * "Record video" for the live view: the setup dialog, the 3-2-1 countdown, the recording indicator
 * (elapsed time, Stop, Esc) and the review dialog (preview, size, Download / Discard). The state
 * machine is `recordReducer`; this component runs its side effects.
 */
export function Recorder({ rec, dispatch, controller, state, target, title, presenting, canPresent }: RecorderProps) {
  const stream = useRef<MediaStream | null>(null);
  const recording = useRef<Recording | null>(null);
  const crop = useRef<CropMode>("none");
  const framed = useRef<{ target: Element | null; presented: boolean }>({ target: null, presented: false });
  const options = useRef<Options>({ fromStart: false, present: false });
  /** This take plays the simulation from the start (auto-stop, notes hold then continue). */
  const [fromStart, setFromStart] = useState(false);
  const startedAt = useRef(0);
  const phase = useRef(rec.phase);
  useLayoutEffect(() => {
    phase.current = rec.phase;
  }, [rec.phase]);
  const sim = state.simulation;

  /** Puts the chrome back (presentation off if the take turned it on). */
  const unframe = useCallback(() => {
    const f = framed.current;
    f.target?.removeAttribute(RECORDING_ATTR);
    if (f.presented) setPresentation(false);
    framed.current = { target: null, presented: false };
  }, []);

  /** Stops the capture: the recorder hands its video over, then the review opens. */
  const stop = useCallback(() => {
    const p = phase.current;
    if (p === "countdown" || p === "requesting") {
      dispatch({ type: "stop" });
      stopStream(stream.current);
      stream.current = null;
      recording.current = null;
      unframe();
      return;
    }
    if (p !== "recording") return;
    dispatch({ type: "stop" });
    const take = recording.current;
    const durationMs = startedAt.current ? performance.now() - startedAt.current : 0;
    unframe();
    if (!take || take.recorder.state === "inactive") {
      stopStream(stream.current);
      dispatch({ type: "failed", message: "Nothing was recorded. Start again and keep this tab open." });
      return;
    }
    take.done
      .then(async (raw) => {
        if (!raw.size) throw new Error("empty");
        const blob = await fixWebmDuration(raw, durationMs);
        const kind = describeMime(blob.type || take.recorder.mimeType);
        const diagram = title();
        const result: RecordResult = {
          blob,
          url: URL.createObjectURL(blob),
          mime: blob.type,
          format: kind.label,
          filename: recordingFilename(diagram, controller.getState().simulation?.title ?? null, kind.ext),
          durationMs,
          crop: crop.current,
        };
        dispatch({ type: "finished", result });
      })
      .catch(() => dispatch({ type: "failed", message: "Nothing was recorded. Start again and keep this tab open." }))
      .finally(() => {
        stopStream(stream.current);
        stream.current = null;
        recording.current = null;
      });
    take.recorder.stop();
  }, [dispatch, unframe, title, controller]);
  const stopRef = useRef(stop);
  useLayoutEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Start (a click: the share prompt needs the user gesture, so nothing awaits before it). */
  const start = useCallback(
    (opts: Options) => {
      const support = captureSupport();
      if (unsupportedReason(support) || !support.type) return;
      const type = support.type;
      options.current = opts;
      setFromStart(opts.fromStart);
      dispatch({ type: "start" });
      let prompt: Promise<MediaStream>;
      try {
        prompt = requestTabCapture();
      } catch (err) {
        dispatch({ type: "denied", message: captureErrorMessage(err) });
        return;
      }
      prompt.then(
        async (media) => {
          if (phase.current !== "requesting") return stopStream(media);
          stream.current = media;
          // The browser's own "Stop sharing" ends the take like Stop does.
          media.getVideoTracks()[0]?.addEventListener("ended", () => stopRef.current());
          const el = target();
          el?.setAttribute(RECORDING_ATTR, "");
          framed.current = { target: el, presented: opts.present && setPresentation(true) };
          try {
            crop.current = await frameTo(media, el);
            recording.current = createRecording(media, type);
          } catch (err) {
            stopStream(media);
            stream.current = null;
            unframe();
            dispatch({ type: "failed", message: captureErrorMessage(err) });
            return;
          }
          if (phase.current !== "requesting") return;
          // Frame 0 shows 0:00 through the countdown; playback starts with the recorder.
          if (opts.fromStart) {
            controller.restart();
            controller.setPlaying(false);
          }
          dispatch({ type: "granted" });
        },
        (err) => dispatch({ type: "denied", message: captureErrorMessage(err) }),
      );
    },
    [dispatch, target, controller, unframe],
  );

  // 3, 2, 1: one second each.
  useEffect(() => {
    if (rec.phase !== "countdown") return;
    const t = window.setTimeout(() => dispatch({ type: "tick", at: performance.now() }), 1000);
    return () => window.clearTimeout(t);
  }, [rec.phase, rec.count, dispatch]);

  // Recording: start the recorder once the countdown has left the screen (two frames), then play.
  useEffect(() => {
    if (rec.phase !== "recording") return;
    const take = recording.current;
    if (!take || take.recorder.state !== "inactive") return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        try {
          take.recorder.start(1000);
        } catch (err) {
          stopStream(stream.current);
          unframe();
          dispatch({ type: "failed", message: captureErrorMessage(err) });
          return;
        }
        startedAt.current = performance.now();
        if (options.current.fromStart) controller.setPlaying(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [rec.phase, controller, dispatch, unframe]);

  // From the start: stop a moment after the run finishes, and let pausing notes hold, then continue.
  const auto = rec.phase === "recording" && fromStart;
  const done = !!state.run?.done;
  const waiting = !!state.run?.waiting;
  const noteAt = state.run?.note?.atMs;
  useEffect(() => {
    if (!auto || !done) return;
    const t = window.setTimeout(() => stopRef.current(), END_TAIL_MS);
    return () => window.clearTimeout(t);
  }, [auto, done]);
  useEffect(() => {
    if (!auto || !waiting) return;
    const t = window.setTimeout(() => controller.resume(), NOTE_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [auto, waiting, noteAt, controller]);

  // While the capture is live: Esc stops (before presentation, panels or live view see it).
  const capturing = isCapturing(rec.phase);
  useEffect(() => {
    setRecordingActive(capturing);
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stopRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setRecordingActive(false);
    };
  }, [capturing]);

  // Leaving live view (or the page) mid-take: stop everything and put the chrome back.
  useEffect(
    () => () => {
      const take = recording.current;
      if (take && take.recorder.state !== "inactive") take.recorder.stop();
      stopStream(stream.current);
      unframe();
    },
    [unframe],
  );

  // The finished video is released when it's downloaded (after the browser has it) or discarded.
  const release = useRef<number | undefined>(undefined);
  const result = rec.result;
  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.filename;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    dispatch({ type: "close" });
    notify(`Downloaded ${result.filename}.`, { kind: "success" });
    window.setTimeout(() => URL.revokeObjectURL(result.url), 60_000);
  };
  const discard = () => {
    if (!result) return;
    dispatch({ type: "close" });
    window.clearTimeout(release.current);
    release.current = window.setTimeout(() => URL.revokeObjectURL(result.url), UNDO_MS + 500);
    notify("Discarded the recording.", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        testId: "record-discard-undo",
        run: () => {
          window.clearTimeout(release.current);
          dispatch({ type: "reopen", result });
        },
      },
    });
  };

  return (
    <>
      {(rec.phase === "setup" || rec.phase === "requesting") && (
        <SetupDialog
          rec={rec}
          simulation={sim?.title ?? null}
          canPresent={canPresent && !presenting}
          onStart={start}
          onClose={() => (rec.phase === "requesting" ? stop() : dispatch({ type: "close" }))}
        />
      )}
      {rec.phase === "countdown" &&
        createPortal(
          <div className="lv-rec-count" data-testid="record-countdown" role="status" aria-live="assertive">
            <span key={rec.count} className="lv-rec-count-n" data-count={rec.count}>
              {rec.count}
            </span>
            <span className="lv-rec-count-hint">
              Recording starts… <kbd>Esc</kbd> cancels
            </span>
          </div>,
          document.body,
        )}
      {(rec.phase === "recording" || rec.phase === "stopping") &&
        createPortal(<Indicator rec={rec} onStop={stop} />, document.body)}
      {rec.phase === "review" && result && <ReviewDialog result={result} onDownload={download} onDiscard={discard} />}
    </>
  );
}

function SetupDialog({
  rec,
  simulation,
  canPresent,
  onStart,
  onClose,
}: {
  rec: RecordState;
  simulation: string | null;
  canPresent: boolean;
  onStart: (o: Options) => void;
  onClose: () => void;
}) {
  const [support] = useState(captureSupport);
  const [fromStart, setFromStart] = useState(!!simulation);
  const [present, setPresent] = useState(true);
  const reason = unsupportedReason(support);
  const asking = rec.phase === "requesting";
  const exact = canFrameToElement();
  return (
    <Dialog
      title="Record video"
      subtitle="A video of this live view, to drop into Slack or a deck."
      icon={<LiveIcon name="record" size={16} />}
      onClose={onClose}
      testId="record-setup"
      width={460}
      footer={
        <>
          <span className="ix-grow" />
          <button
            className="btn"
            onClick={onClose}
            data-testid="record-cancel"
            data-autofocus={reason ? "" : undefined}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onStart({ fromStart: !!simulation && fromStart, present: canPresent && present })}
            disabled={!!reason || asking}
            data-testid="record-start"
            data-autofocus={reason ? undefined : ""}
          >
            <LiveIcon name="record" size={14} /> {asking ? "Waiting for the browser…" : "Start recording"}
          </button>
        </>
      }
    >
      <div className="lv-rec-setup">
        {simulation && (
          <label className="ix-check">
            <input
              type="checkbox"
              checked={fromStart}
              onChange={(e) => setFromStart(e.target.checked)}
              data-testid="record-opt-from-start"
            />
            <span>
              Play “{simulation}” from the start and stop when it ends
              <small>Pausing notes hold for {NOTE_HOLD_MS / 1000} seconds, then the story continues.</small>
            </span>
          </label>
        )}
        {canPresent && (
          <label className="ix-check">
            <input
              type="checkbox"
              checked={present}
              onChange={(e) => setPresent(e.target.checked)}
              data-testid="record-opt-present"
            />
            <span>
              Presentation view
              <small>Hides the editing controls and enlarges text while recording.</small>
            </span>
          </label>
        )}
        {reason ? (
          <p className="ix-error" role="alert" data-testid="record-unsupported">
            {reason}
          </p>
        ) : (
          <p className="ix-muted">
            Your browser will ask to share this tab: choose it and Allow.{" "}
            {exact ? "Only the diagram is recorded" : "The tab is recorded as it looks"}, without sound. Stop with{" "}
            <kbd>Esc</kbd> or the Stop button. The video stays on this computer until you download it.
          </p>
        )}
        {rec.error && (
          <p className="ix-error" role="alert" data-testid="record-error">
            {rec.error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Indicator({ rec, onStop }: { rec: RecordState; onStop: () => void }) {
  const [now, setNow] = useState(() => performance.now());
  const stopping = rec.phase === "stopping";
  useEffect(() => {
    if (stopping) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [stopping]);
  const elapsed = rec.startedAt ? Math.max(0, now - rec.startedAt) : 0;
  return (
    <div className={`lv-rec${stopping ? " is-stopping" : ""}`} data-testid="record-indicator" role="status">
      <span className="lv-rec-dot" aria-hidden />
      <span className="sr-only">{stopping ? "Saving the recording" : "Recording"}</span>
      <span className="lv-rec-time mono" data-testid="record-elapsed" aria-hidden>
        {stopping ? "Saving…" : formatDuration(elapsed)}
      </span>
      <button className="lv-rec-stop" onClick={onStop} disabled={stopping} data-testid="record-stop" title="Stop (Esc)">
        <LiveIcon name="stop" size={12} /> Stop
      </button>
    </div>
  );
}

function ReviewDialog({
  result,
  onDownload,
  onDiscard,
}: {
  result: RecordResult;
  onDownload: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog
      title="Your recording"
      subtitle={
        <span data-testid="record-meta">
          {formatDuration(result.durationMs)} · {formatBytes(result.blob.size)} · {result.format}
        </span>
      }
      icon={<LiveIcon name="record" size={16} />}
      onClose={onDiscard}
      testId="record-review"
      width={640}
      footer={
        <>
          <span className="ix-muted lv-rec-file" title={result.filename}>
            {result.filename}
          </span>
          <span className="ix-grow" />
          <button className="btn" onClick={onDiscard} data-testid="record-discard">
            Discard
          </button>
          <button className="btn btn-primary" onClick={onDownload} data-testid="record-download" data-autofocus>
            <LiveIcon name="save" size={14} /> Download
          </button>
        </>
      }
    >
      <video
        className="lv-rec-preview"
        src={result.url}
        controls
        playsInline
        muted
        preload="metadata"
        data-testid="record-preview"
      />
      {result.crop === "none" && (
        <p className="ix-muted" data-testid="record-uncropped">
          This browser can&apos;t crop to the diagram, so the video shows everything you shared. Trim it in any video
          editor if you need to.
        </p>
      )}
    </Dialog>
  );
}
