import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import { paletteHost } from "../../palette/host";
import { isLocalOnly } from "../../lib/localOnly";
import { LOCAL_ONLY_MESSAGE } from "../privacy";
import { planTurn } from "../ui/apply";
import { commitPlan, type TurnRecord } from "../ui/commitTurn";
import { resolveScope } from "../ui/context";
import { useDictation } from "../ui/useDictation";
import { isAbort, runOnDevice, type OnDeviceStatus } from "./pipeline";
import type { ModelAvailability, ModelSession } from "./promptApi";
import { primedSession } from "./session";

// The AI panel's request box for Chrome's built-in model (lazy-loaded, only where the Prompt API is and
// the person turned it on in Advanced). Enter sends; the model's ops land as one turn with Undo, like an
// agent's change. Runs on this device: no key, no server, nothing leaves the browser.

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

const STATUS: Record<OnDeviceStatus, string> = {
  thinking: "Thinking…",
  retrying: "Checking and trying again…",
  applying: "Applying…",
};

export default function OnDeviceInput({
  availability,
  onAvailability,
  live,
  onTurn,
}: {
  availability: Exclude<ModelAvailability, "unavailable">;
  onAvailability: (a: ModelAvailability) => void;
  live: boolean;
  onTurn: (turn: TurnRecord) => void;
}) {
  const id = useId();
  const host = useSyncExternalStore(paletteHost.subscribe, paletteHost.get);
  const localOnly = isLocalOnly(host.canvas);
  const editor = host.canvas?.editor ?? null;
  const [request, setRequest] = useState("");
  const [status, setStatus] = useState<OnDeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

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

  // The selection goes with the request, as Copy for AI names it.
  const diagram = editor?.getDiagram();
  const sel = editor?.getSelection();
  const scope = diagram && sel ? resolveScope(diagram, [...sel.nodeIds, ...sel.edgeIds, ...sel.groupIds]) : [];

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

  const busy = status !== null;
  const blocked = localOnly || live || !editor;

  const send = async () => {
    const text = request.trim();
    const ed = editorNow();
    if (!text || busy || !ed) return;
    // Provenance is read again at send time: a local-only diagram never reaches the model.
    if (isLocalOnly(paletteHost.get().canvas)) return setError(LOCAL_ONLY_MESSAGE);
    dictation.stop();
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    setStatus("thinking");
    let session: ModelSession | null = null;
    let base: ModelSession | null = null;
    try {
      base = await primedSession();
      session = base.clone ? await base.clone({ signal: controller.signal }) : base;
      const current = ed.getDiagram();
      const s = ed.getSelection();
      const result = await runOnDevice({
        session,
        diagram: current,
        request: text,
        scope: resolveScope(current, [...s.nodeIds, ...s.edgeIds, ...s.groupIds]),
        signal: controller.signal,
        onStatus: setStatus,
      });
      if (!result.ok) {
        setError(
          result.tooBig
            ? "This diagram is too big for the on-device model. Select the part to change and try again."
            : "Couldn't apply that. Try rephrasing.",
        );
        return;
      }
      // Planned again on the diagram as it is now (the person may have edited it meanwhile).
      const now = editorNow();
      if (!now || isLocalOnly(paletteHost.get().canvas)) return;
      const plan = planTurn(now.getDiagram(), { ok: true, kind: "ops", ops: result.ops });
      if (!plan.ok || !plan.hasChanges) return setError("Couldn't apply that. Try rephrasing.");
      onTurn(commitPlan(now, plan, { request: text.slice(0, 400), engine: "on-device", reply: result.summary }));
      setRequest("");
    } catch (err) {
      if (!isAbort(err)) setError("Couldn't apply that. Try rephrasing.");
    } finally {
      if (session && session !== base) session.destroy();
      if (abort.current === controller) abort.current = null;
      setStatus(null);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape" && (busy || dictation.status !== "idle")) {
      e.preventDefault();
      e.stopPropagation();
      if (busy) abort.current?.abort();
      else dictation.stop();
    }
  };

  const listening = dictation.status !== "idle";
  const placeholder = localOnly
    ? "AI is off for this local-only diagram"
    : live
      ? "Back to editing to change the diagram"
      : "Describe a change…";

  return (
    <section className="ai-ondevice" aria-label="On-device model" data-testid="ai-ondevice" data-state={availability}>
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
          <div className={`ai-request ai-ondevice-box${listening ? " is-listening" : ""}`}>
            <label className="sr-only" htmlFor={`${id}-ondevice`}>
              Describe a change
            </label>
            <textarea
              id={`${id}-ondevice`}
              ref={inputRef}
              className="ix-input ai-textarea"
              value={request}
              onChange={(e) => {
                setRequest(e.target.value);
                setError(null);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={2}
              disabled={blocked}
              spellCheck
              data-testid="ai-ondevice-input"
            />
            {dictation.supported && !blocked && (
              <button
                type="button"
                className={`ai-mic${listening ? " is-on" : ""}${dictation.hearing ? " is-hearing" : ""}`}
                onClick={() => {
                  if (!listening) inputRef.current?.focus();
                  dictation.toggle();
                }}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictating" : "Dictate"}
                title={listening ? "Stop dictating" : "Dictate"}
                data-testid="ai-ondevice-mic"
              >
                <Icon name="mic" size={15} />
              </button>
            )}
          </div>
          {dictation.interim && <p className="ai-interim">{dictation.interim}</p>}
          <div className="ai-composer-row">
            <span className="ai-hint" role="status" data-testid="ai-ondevice-status">
              {busy ? STATUS[status] : "Runs on this device with Chrome's built-in model"}
            </span>
            {busy ? (
              <button className="btn" onClick={() => abort.current?.abort()} data-testid="ai-ondevice-stop">
                <Icon name="close" size={13} /> Stop
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => void send()}
                disabled={blocked || !request.trim()}
                data-testid="ai-ondevice-send"
              >
                Send
              </button>
            )}
          </div>
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
