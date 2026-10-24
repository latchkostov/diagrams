import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { ensureLazySurfacesLoaded } from "../../lib/lazySurfaces";
import { Dialog } from "../../interop/ui/Dialog";
import { notify } from "../../interop/ui/toast";
import type { LiveController, LiveState } from "../controller";
import { LiveIcon } from "../icons";
import { canFrameToElement, captureSupport, createRecording, frameTo, requestTabCapture, stopStream } from "./capture";
import { useRecordingSession } from "./useRecordingSession";
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
import type { SlowMotion } from "../slowmo/session";

/** After the run finishes, keep recording this long so the last messages land and "Done" shows. */
const END_TAIL_MS = 1500;
/** A pausing note in an unattended take holds this long, then the story continues. */
const NOTE_HOLD_MS = 5000;
/** Undo for Discard, before the video is released. */
const UNDO_MS = 8000;

interface Options {
  /** Play the selected simulation from 0:00 and stop when it ends. */
  fromStart: boolean;
  /** Play the slow motion from its first beat and stop at its end. */
  slowmo?: boolean;
  /** Presentation view for the take (hides editing chrome, larger type); always, where it exists. */
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
  /** Slow motion: while it plays, the one option is to record it from the start. */
  slowmo?: SlowMotion;
}

/**
 * "Record video" for the live view: the setup dialog, the 3-2-1 countdown, the recording indicator
 * (elapsed time, Stop, Esc) and the review dialog (preview, size, Download / Discard). The state
 * machine is `recordReducer`; this component runs its side effects.
 */
export function Recorder({
  rec,
  dispatch,
  controller,
  state,
  target,
  title,
  presenting,
  canPresent,
  slowmo,
}: RecorderProps) {
  const [scopeConfirmation, setScopeConfirmation] = useState<(() => void) | null>(null);
  const stoppedDuration = useRef(0);
  const crop = useRef<CropMode>("none");
  const framed = useRef<{ target: Element | null; presented: boolean }>({ target: null, presented: false });
  const options = useRef<Options>({ fromStart: false, present: false });
  /** This take plays the simulation from the start (auto-stop, notes hold then continue). */
  const [fromStart, setFromStart] = useState(false);
  /** This take records the slow motion from its first beat (auto-stop at its end). */
  const [slowTake, setSlowTake] = useState(false);
  const noSlow = useCallback(() => () => {}, []);
  const slow = useSyncExternalStore(slowmo?.subscribe ?? noSlow, () => slowmo?.getState() ?? null);
  const slowOn = slow?.status === "on";
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

  const { stream, recording, begin, valid, cancel } = useRecordingSession(unframe);
  const fail = useCallback(
    (token: number, message: string) => {
      if (!valid(token)) return;
      cancel();
      phase.current = "setup";
      setScopeConfirmation(null);
      dispatch({ type: "failed", message });
    },
    [valid, cancel, dispatch],
  );

  /** Stops the capture: completion/error handlers already own the take's result. */
  const stop = useCallback(() => {
    const p = phase.current;
    if (p === "countdown" || p === "requesting") {
      phase.current = "idle";
      cancel();
      setScopeConfirmation(null);
      dispatch({ type: "stop" });
      return;
    }
    if (p !== "recording") return;
    const take = recording.current;
    // The indicator shows as the countdown ends, but the recorder starts two frames later. A stop in
    // between has nothing to save: it cancels, like a stop during the countdown.
    if (take && take.recorder.state === "inactive" && !startedAt.current) {
      phase.current = "idle";
      cancel();
      dispatch({ type: "stop", unstarted: true });
      return;
    }
    phase.current = "stopping";
    dispatch({ type: "stop" });
    stoppedDuration.current = startedAt.current ? performance.now() - startedAt.current : 0;
    unframe();
    if (!take || take.recorder.state === "inactive") {
      cancel();
      dispatch({ type: "failed", message: "Recording failed. Start again and keep this tab open." });
      return;
    }
    try {
      take.recorder.stop();
    } catch {
      cancel();
      dispatch({ type: "failed", message: "Recording failed. Start again and keep this tab open." });
    }
  }, [dispatch, unframe, cancel, recording]);
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
      const token = begin();
      phase.current = "requesting";
      startedAt.current = 0;
      stoppedDuration.current = 0;
      setScopeConfirmation(null);
      options.current = opts;
      setFromStart(opts.fromStart);
      setSlowTake(!!opts.slowmo);
      dispatch({ type: "start" });
      let prompt: Promise<MediaStream>;
      try {
        prompt = requestTabCapture();
      } catch (err) {
        fail(token, captureErrorMessage(err));
        return;
      }
      void prompt
        .then(async (media) => {
          if (!valid(token)) {
            stopStream(media);
            return;
          }
          stream.current = media;
          const track = media.getVideoTracks()[0];
          const failure = () =>
            fail(token, "Recording failed: the browser lost the capture. Start again and keep this tab open.");
          for (const t of media.getTracks()) {
            t.addEventListener("error", failure, { once: true });
            t.addEventListener(
              "ended",
              () => {
                if (!valid(token)) return;
                if (phase.current === "recording") stopRef.current();
                else if (phase.current !== "stopping") failure();
              },
              { once: true },
            );
          }
          if (!track || track.readyState === "ended") {
            failure();
            return;
          }
          const surfaces = ensureLazySurfacesLoaded();
          if (surfaces) await surfaces;
          if (!valid(token)) {
            stopStream(media);
            return;
          }
          const el = target();
          el?.setAttribute(RECORDING_ATTR, "");
          framed.current = { target: el, presented: opts.present && setPresentation(true) };
          crop.current = await frameTo(media, el, () => valid(token));
          if (!valid(token)) {
            stopStream(media);
            return;
          }
          if (media.getVideoTracks()[0]?.readyState !== "live") {
            failure();
            return;
          }
          const ready = () => {
            if (!valid(token)) return;
            setScopeConfirmation(null);
            try {
              const take = createRecording(media, type);
              recording.current = take;
              // Subscribe immediately: encoder failures can arrive long before Stop.
              void take.done
                .then(async (raw) => {
                  if (!valid(token)) return;
                  const durationMs =
                    stoppedDuration.current || (startedAt.current ? performance.now() - startedAt.current : 0);
                  if (phase.current !== "stopping" && phase.current !== "recording")
                    throw new Error("Capture stopped before recording");
                  phase.current = "stopping";
                  dispatch({ type: "stop" });
                  unframe();
                  if (!raw.size) throw new Error("Empty recording");
                  const blob = await fixWebmDuration(raw, durationMs);
                  if (!valid(token)) return;
                  const kind = describeMime(blob.type || take.recorder.mimeType);
                  const result: RecordResult = {
                    blob,
                    url: URL.createObjectURL(blob),
                    mime: blob.type,
                    format: kind.label,
                    filename: recordingFilename(
                      title(),
                      opts.slowmo && slowmo?.getState().script
                        ? `${slowmo.getState().script!.type} slow motion`
                        : (controller.getState().simulation?.title ?? null),
                      kind.ext,
                    ),
                    durationMs,
                    crop: crop.current,
                  };
                  cancel();
                  dispatch({ type: "finished", result });
                })
                .catch(() =>
                  fail(token, "Recording failed: the video could not be saved. Start again and keep this tab open."),
                );
              if (opts.slowmo) {
                // The journey's fit is already set, so the video never opens with a camera move.
                slowmo?.seek(0);
                slowmo?.pause();
              } else if (opts.fromStart) {
                controller.restart();
                controller.setPlaying(false);
              }
              dispatch({ type: "granted" });
            } catch (err) {
              fail(token, captureErrorMessage(err));
            }
          };
          if (crop.current === "none") setScopeConfirmation(() => ready);
          else ready();
        })
        .catch((err: unknown) => fail(token, captureErrorMessage(err)));
    },
    [dispatch, target, controller, unframe, begin, valid, fail, cancel, stream, recording, title, slowmo],
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
          cancel();
          dispatch({ type: "failed", message: captureErrorMessage(err) });
          return;
        }
        startedAt.current = performance.now();
        if (options.current.slowmo) slowmo?.play();
        else if (options.current.fromStart) controller.setPlaying(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [rec.phase, controller, dispatch, cancel, recording, slowmo]);

  // A slow-motion take stops at the end of the replay (its last beat is already a hold), or when it ends.
  const slowAuto = rec.phase === "recording" && slowTake;
  const slowDone = !!slow?.done || slow?.status !== "on";
  useEffect(() => {
    if (!slowAuto || !slowDone) return;
    const t = window.setTimeout(() => stopRef.current(), 300);
    return () => window.clearTimeout(t);
  }, [slowAuto, slowDone]);

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

  // The finished video is released when it's downloaded (after the browser has it) or discarded.
  const releases = useRef(new Map<string, number>());
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
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(result.url);
      releases.current.delete(result.url);
    }, UNDO_MS + 500);
    releases.current.set(result.url, timer);
    notify("Discarded the recording.", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        testId: "record-discard-undo",
        run: () => {
          window.clearTimeout(releases.current.get(result.url));
          releases.current.delete(result.url);
          dispatch({ type: "reopen", result });
        },
      },
    });
  };

  return (
    <>
      {(rec.phase === "setup" || rec.phase === "requesting") && !scopeConfirmation && (
        <SetupDialog
          rec={rec}
          slowmo={slowOn}
          simulation={sim?.title ?? null}
          canPresent={canPresent && !presenting}
          inPresentation={canPresent || presenting}
          onStart={start}
          onClose={() => (rec.phase === "requesting" ? stop() : dispatch({ type: "close" }))}
        />
      )}
      {scopeConfirmation && rec.phase === "requesting" && (
        <Dialog
          title="Record the shared surface?"
          testId="record-scope"
          onClose={stop}
          width={460}
          footer={
            <>
              <span className="ix-grow" />
              <button className="btn" data-testid="record-scope-cancel" data-autofocus onClick={stop}>
                Cancel
              </button>
              <button className="btn btn-primary" data-testid="record-scope-continue" onClick={scopeConfirmation}>
                Record shared surface
              </button>
            </>
          }
        >
          <p>
            The browser couldn't crop to the diagram. The video will include everything you shared, including content
            outside the diagram. Cancel to choose a different surface, or continue with this one.
          </p>
        </Dialog>
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
  slowmo,
  simulation,
  canPresent,
  inPresentation,
  onStart,
  onClose,
}: {
  rec: RecordState;
  /** Slow motion is on: the one option is to record it from the start. */
  slowmo: boolean;
  simulation: string | null;
  canPresent: boolean;
  /** The take is in presentation view (turned on for it, or already on). The Lab has none. */
  inPresentation: boolean;
  onStart: (o: Options) => void;
  onClose: () => void;
}) {
  const [support] = useState(captureSupport);
  const [fromStart, setFromStart] = useState(!!simulation);
  const [slowFromStart, setSlowFromStart] = useState(true);
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
            onClick={() =>
              onStart({
                fromStart: !slowmo && !!simulation && fromStart,
                slowmo: slowmo && slowFromStart,
                present: canPresent,
              })
            }
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
        {slowmo ? (
          <label className="ix-check">
            <input
              type="checkbox"
              checked={slowFromStart}
              onChange={(e) => setSlowFromStart(e.target.checked)}
              data-testid="record-opt-slowmo"
            />
            <span>
              Record this slow motion
              <small>It plays from the start and the recording stops at its end.</small>
            </span>
          </label>
        ) : (
          simulation && (
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
          )
        )}
        {reason ? (
          <p className="ix-error" role="alert" data-testid="record-unsupported">
            {reason}
          </p>
        ) : (
          <p className="ix-muted" data-testid="record-what">
            Your browser will ask to share this tab: choose it and Allow.{" "}
            {exact ? "We’ll try to record only the diagram" : "The shared surface is recorded as it looks"}
            {inPresentation &&
              (exact ? ", in presentation view (no editing controls, larger text)" : ", in presentation view")}
            , without sound.{exact && " If cropping fails, you can cancel before recording."} Stop with <kbd>Esc</kbd>{" "}
            or the Stop button. The video stays on this computer until you download it.
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
