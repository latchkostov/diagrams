import { t, msg, useLocale } from "../../i18n";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import type { TurnRecord } from "../ui/commitTurn";
import type { ScopeItem } from "../ui/context";
import { DictationField } from "../ui/DictationField";
import { speechServiceNote, useDictation } from "../ui/useDictation";
import type { OnDeviceStatus } from "./pipeline";
import type { ModelAvailability } from "./promptApi";
import { primedSession } from "./session";
import { onDeviceErrorMessage, useOnDeviceRequest } from "./useOnDeviceRequest";

// The AI panel's request box for Chrome's built-in model (lazy-loaded, only where the Prompt API is and
// the person turned it on in Advanced). Enter sends; the model's ops land as one turn with Undo, like an
// agent's change. The model runs on this device: no key, no server. Dictation says where it runs.

const STATUS: Record<OnDeviceStatus, () => string> = {
  thinking: msg("ai.thinking"),
  retrying: msg("ai.checkingAndTryingAgain"),
  applying: msg("ai.applying"),
};

export default function OnDeviceInput({
  active,
  availability,
  onAvailability,
  documentId,
  live,
  localOnly,
  privateDiagram = false,
  scope,
  onTurn,
}: {
  active: boolean;
  availability: Exclude<ModelAvailability, "unavailable">;
  onAvailability: (a: ModelAvailability) => void;
  documentId: string | undefined;
  live: boolean;
  localOnly: boolean;
  /** A private diagram the person allowed the model for: dictation listens only on this device. */
  privateDiagram?: boolean;
  /** The selection, from the panel's settled snapshot (not read per keystroke or drag frame). */
  scope: readonly ScopeItem[];
  onTurn: (turn: TurnRecord) => void;
}) {
  useLocale();
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
    privateDiagram,
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
    if (!active || blocked) cancelDictation.current();
  }, [active, blocked]);

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
      setError({ reason: "download", detail: err instanceof Error ? err.message : "" });
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
    ? t("ai.aIIsOffForThisLocalOnly")
    : live
      ? t("ai.backToEditingToChangeTheDiagram")
      : t("ai.describeAChange");

  return (
    <section
      className="ai-ondevice"
      aria-label={t("ai.onDeviceModel")}
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
              <Icon name="download" size={14} />
              {t("ai.downloadTheOnDeviceModel")}
            </button>
          ) : (
            <div className="ai-ondevice-progress" data-testid="ai-ondevice-progress">
              <span>{t("ai.downloadPercent", { percent: Math.round(progress * 100) })}</span>
              <progress
                max={1}
                value={progress}
                aria-label={t("ai.downloadProgress")}
                data-testid="ai-ondevice-progress-bar"
              />
            </div>
          )}
          <p className="ai-ondevice-note">{t("ai.oneTimeDownloadFromChromeItThen")}</p>
        </div>
      ) : (
        <>
          {scope.length > 0 && !blocked && (
            <p className="ai-ondevice-scope" data-testid="ai-ondevice-scope">
              <Icon name="select-all" size={12} />
              <span>{scope.length === 1 ? scope[0].label : t("ai.selected", { count: scope.length })}</span>
            </p>
          )}
          <DictationField
            id={`${id}-ondevice`}
            label={t("ai.describeAChange2")}
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
              // eslint-disable-next-line local/no-literal-ui-text -- a test id, not display text
              message: "ai-ondevice-dictation-message",
              service: "ai-ondevice-speech-service",
            }}
          />
          <div className="ai-composer-row">
            <span className="ai-hint" role="status" data-testid="ai-ondevice-status">
              {busy && status ? STATUS[status]() : t("ai.runsOnThisDeviceWithChromeS")}
            </span>
            {busy ? (
              <button className="btn" onClick={cancel} data-testid="ai-ondevice-stop">
                <Icon name="close" size={13} />
                {t("ai.stop")}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={blocked || !request.trim()}
                data-testid="ai-ondevice-send"
              >
                {t("ai.send")}
              </button>
            )}
          </div>
          {speechLeaves && dictation.supported && !blocked && !privateDiagram && dictation.status === "idle" && (
            <p className="ai-ondevice-note" data-testid="ai-ondevice-speech-note">
              {t("ai.dictationService", { notice: speechServiceNote() })}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="ai-note is-error" role="alert" data-testid="ai-ondevice-error">
          {onDeviceErrorMessage(error)}
        </p>
      )}
    </section>
  );
}
