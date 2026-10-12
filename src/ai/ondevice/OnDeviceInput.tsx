import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import type { TurnRecord } from "../ui/commitTurn";
import type { ScopeItem } from "../ui/context";
import { DictationField } from "../ui/DictationField";
import { useDictation } from "../ui/useDictation";
import type { OnDeviceStatus } from "./pipeline";
import type { ModelAvailability } from "./promptApi";
import { primedSession } from "./session";
import { useOnDeviceRequest } from "./useOnDeviceRequest";

// The AI panel's request box for Chrome's built-in model (lazy-loaded, only where the Prompt API is and
// the person turned it on in Advanced). Enter sends; the model's ops land as one turn with Undo, like an
// agent's change. The model runs on this device: no key, no server. Dictation says where it runs.

const STATUS: Record<OnDeviceStatus, string> = {
  thinking: "Thinking…",
  retrying: "Checking and trying again…",
  applying: "Applying…",
};

const SPEECH_NOTE = "Dictation may use your browser's speech service (in Chrome, Google).";

export default function OnDeviceInput({
  availability,
  onAvailability,
  documentId,
  live,
  localOnly,
  scope,
  onTurn,
}: {
  availability: Exclude<ModelAvailability, "unavailable">;
  onAvailability: (a: ModelAvailability) => void;
  documentId: string | undefined;
  live: boolean;
  localOnly: boolean;
  /** The selection, from the panel's settled snapshot (not read per keystroke or drag frame). */
  scope: readonly ScopeItem[];
  onTurn: (turn: TurnRecord) => void;
}) {
  const id = useId();
  const blocked = live || localOnly || !documentId;
  const [request, setRequest] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { status, busy, error, setError, send, cancel } = useOnDeviceRequest({ documentId, blocked, onTurn });

  const pendingCaret = useRef<number | null>(null);
  const dictation = useDictation(
    () => ({
      value: inputRef.current?.value ?? request,
      caret: inputRef.current?.selectionStart ?? request.length,
    }),
    (t) => {
      pendingCaret.current = t.caret;
      setRequest(t.value);
    },
  );
  useEffect(() => {
    const el = inputRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [request]);
  // Whatever hides the mic (live view, a local-only diagram) stops dictation, a pending start included.
  const cancelDictation = useRef(dictation.cancel);
  useEffect(() => {
    cancelDictation.current = dictation.cancel;
  });
  useEffect(() => {
    if (blocked) cancelDictation.current();
  }, [blocked]);

  // Until a dictation session confirms speech stays on this device, the box says it may not (asking the
  // browser up front, SpeechRecognition.available(), is what the mic does when it starts).
  const speechLeaves = !dictation.onDevice;

  const download = async () => {
    setError(null);
    setProgress(0);
    try {
      await primedSession((loaded) => setProgress(loaded));
      onAvailability("available");
    } catch (err) {
      setError(`The model didn't download. ${err instanceof Error ? err.message : ""}`.trim());
    } finally {
      setProgress(null);
    }
  };

  const submit = async () => {
    if (!request.trim() || busy || blocked) return;
    dictation.stop();
    if (await send(request)) setRequest("");
  };

  // Esc cancels the request (or dictation) first, before the panel hands the keyboard to the canvas:
  // captured, because the panel's own Esc listener runs before React's bubbling handlers.
  const onKeyDownCapture = (e: ReactKeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key !== "Escape") return;
    if (!busy && dictation.status === "idle") return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) cancel();
    else dictation.stop();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void submit();
    }
  };

  const placeholder = localOnly
    ? "AI is off for this local-only diagram"
    : live
      ? "Back to editing to change the diagram"
      : "Describe a change…";

  return (
    <section
      className="ai-ondevice"
      aria-label="On-device model"
      data-testid="ai-ondevice"
      data-state={availability}
      onKeyDownCapture={onKeyDownCapture}
    >
      {availability !== "available" ? (
        <div className="ai-ondevice-download">
          {progress === null ? (
            <button
              className="btn"
              onClick={() => void download()}
              disabled={localOnly}
              data-testid="ai-ondevice-download"
            >
              <Icon name="download" size={14} /> Download the on-device model
            </button>
          ) : (
            <div className="ai-ondevice-progress" data-testid="ai-ondevice-progress">
              <span>Downloading the on-device model… {Math.round(progress * 100)}%</span>
              <progress
                max={1}
                value={progress}
                aria-label="Download progress"
                data-testid="ai-ondevice-progress-bar"
              />
            </div>
          )}
          <p className="ai-ondevice-note">One-time download from Chrome. It then runs on this device.</p>
        </div>
      ) : (
        <>
          {scope.length > 0 && !blocked && (
            <p className="ai-ondevice-scope" data-testid="ai-ondevice-scope">
              <Icon name="select-all" size={12} />
              <span>{scope.length === 1 ? scope[0].label : `${scope.length} selected`}</span>
            </p>
          )}
          <DictationField
            id={`${id}-ondevice`}
            label="Describe a change"
            inputRef={inputRef}
            value={request}
            onChange={(v) => {
              setRequest(v);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={2}
            disabled={blocked}
            dictation={dictation}
            testIds={{
              input: "ai-ondevice-input",
              mic: "ai-ondevice-mic",
              interim: "ai-ondevice-interim",
              message: "ai-ondevice-dictation-message",
            }}
          />
          <div className="ai-composer-row">
            <span className="ai-hint" role="status" data-testid="ai-ondevice-status">
              {busy && status ? STATUS[status] : "Runs on this device with Chrome's built-in model"}
            </span>
            {busy ? (
              <button className="btn" onClick={cancel} data-testid="ai-ondevice-stop">
                <Icon name="close" size={13} /> Stop
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={blocked || !request.trim()}
                data-testid="ai-ondevice-send"
              >
                Send
              </button>
            )}
          </div>
          {speechLeaves && dictation.supported && !blocked && (
            <p className="ai-ondevice-note" data-testid="ai-ondevice-speech-note">
              {SPEECH_NOTE}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="ai-note is-error" role="alert" data-testid="ai-ondevice-error">
          {error}
        </p>
      )}
    </section>
  );
}
