import { t, useLocale } from "../../i18n";
import { isolateKeys, legacyKeyHint } from "../../editor/keyHints";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { paletteHost } from "../../palette/host";
import { isLocalOnly, privacyOf } from "../../lib/localOnly";
import { LOCAL_ONLY_MESSAGE, aiOffMessage, describeForAi } from "../privacy";
import { failedRef, pickCandidate, planTurn } from "./apply";
import { commitPlan, type TurnRecord } from "./commitTurn";
import { aiPlace, liveText, type AiIntent } from "./context";
import { buildExplainPrompt, buildFixPrompt, buildPrompt, buildSimulationPrompt } from "./prompt";
import { parseReply, type ParsedReply } from "./reply";
import { useDictation } from "./useDictation";
import { useParsedReply } from "./useParsedReply";
import { FailureBox, OnDevicePreference, type Failure } from "./parts";
import { rememberAdvancedOpen } from "./advancedPref";
import { DictationField } from "./DictationField";

// The AI panel's Advanced section: the manual flow for people without a browser agent. Copy a prompt for
// any chatbot, paste its reply, apply it as one undo step (or, for Explain, only copy). Closed by
// default; open or closed is remembered.

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

export function Advanced({
  active,
  open,
  onOpenChange,
  focusSeq,
  current,
  live,
  onTurn,
  onDevice,
  privateDiagram = false,
}: {
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Changes when something asks for the request box (Build with AI): it opens and takes focus. */
  focusSeq: number | undefined;
  current: DiagramFile | null;
  live: boolean;
  onTurn: (turn: TurnRecord) => void;
  /** "Try the on-device model": offered only where Chrome's built-in model can run. */
  onDevice?: { on: boolean; set: (on: boolean) => void };
  /** A Private diagram: no prompt is copied and no reply applied (the boxes stay, off, saying why). */
  privateDiagram?: boolean;
}) {
  useLocale();
  const id = useId();
  const [request, setRequest] = useState("");
  const [reply, setReply] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copied, setCopied] = useState<"prompt" | "fix" | null>(null);
  const [intent, setIntent] = useState<AiIntent>("change");
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  /** The last request a prompt was copied for: the turn's title once applied. */
  const promptedFor = useRef("");
  const place = aiPlace(current, live);
  const explaining = intent === "explain" && place !== "create";
  const editor = editorNow();

  useEffect(() => rememberAdvancedOpen(open), [open]);
  useEffect(() => {
    if (focusSeq !== undefined) requestRef.current?.focus();
  }, [focusSeq]);

  // Dictation writes into the request box at the caret.
  const pendingCaret = useRef<number | null>(null);
  const dictation = useDictation(
    () => ({
      value: requestRef.current?.value ?? request,
      caret: requestRef.current?.selectionStart ?? request.length,
    }),
    (t) => {
      pendingCaret.current = t.caret;
      setRequest(t.value);
    },
  );
  useEffect(() => {
    const el = requestRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [request]);
  // Folding Advanced hides the request box, the microphone and its shortcut: the microphone goes off
  // too, a pending start included (closing the panel or switching diagrams unmounts all this instead).
  const cancelDictation = useRef(dictation.cancel);
  useEffect(() => {
    cancelDictation.current = dictation.cancel;
  });
  useEffect(() => {
    if (!active || !open || privateDiagram) cancelDictation.current();
  }, [active, open, privateDiagram]);
  useEffect(() => {
    if (!active || !dictation.supported || !open || privateDiagram) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (dictation.status === "idle") requestRef.current?.focus();
        dictation.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, dictation, open, privateDiagram]);

  const { parsed, pending } = useParsedReply(reply);

  const flashCopied = (what: "prompt" | "fix") => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  };

  /** In live view, what's running goes with an Explain prompt. */
  const contextFor = (forIntent: AiIntent): string => {
    const canvas = paletteHost.get().canvas;
    const session = paletteHost.get().session;
    const ed = editorNow();
    if (isLocalOnly(canvas) || !live || forIntent !== "explain" || !session?.state || !ed) return "";
    return liveText(session.state(), ed.getDiagram());
  };

  const copyPrompt = async () => {
    const ed = editorNow();
    if (!ed || privacyOf(paletteHost.get().canvas) === "private") return;
    promptedFor.current = request.trim();
    const input = { request, describe: describeForAi(ed, paletteHost.get().canvas), context: contextFor(intent) };
    const prompt = explaining
      ? buildExplainPrompt(input)
      : place === "live"
        ? buildSimulationPrompt(input)
        : buildPrompt(input);
    const ok = await copyText(prompt);
    if (!ok) return notify(t("ai.theBrowserDidnTAllowCopyingTry"), { kind: "error" });
    flashCopied("prompt");
    if (!explaining) replyRef.current?.focus();
  };

  const copyFix = async () => {
    const ed = editorNow();
    if (!ed || !failure) return;
    // Asked when it acts: a private diagram copies nothing, not even the request's words.
    if (privacyOf(paletteHost.get().canvas) === "private") return;
    if (isLocalOnly(paletteHost.get().canvas)) {
      const ok = await copyText(buildPrompt({ request, describe: LOCAL_ONLY_MESSAGE }));
      if (ok) flashCopied("fix");
      return;
    }
    const ok = await copyText(
      buildFixPrompt({
        request: request || promptedFor.current,
        describe: describeForAi(ed, paletteHost.get().canvas),
        reply: failure.reply,
        error: failure.error,
        simulation: failure.simulation,
      }),
    );
    if (!ok) return notify(t("ai.theBrowserDidnTAllowCopyingTry"), { kind: "error" });
    flashCopied("fix");
    replyRef.current?.select();
  };

  const runPlan = (ed: EditorApi, p: ParsedReply, pastedReply: string) => {
    if (isLocalOnly(paletteHost.get().canvas)) {
      setFailure({ error: { i: -1, error: aiOffMessage(paletteHost.get().canvas) }, reply: pastedReply });
      return;
    }
    const plan = planTurn(ed.getDiagram(), p);
    if (!plan.ok) {
      setFailure({
        error: plan.error,
        reply: pastedReply,
        ...(p.ok && p.kind === "ops" ? { ops: p.ops, layout: p.layout } : {}),
        ...(p.ok && p.kind === "simulation" ? { simulation: true } : {}),
      });
      return;
    }
    if (!plan.hasChanges) {
      setFailure({
        reason: "no-change",
        error: { i: -1, error: "The reply didn't change anything.", hint: "Check the request, or ask your AI again." },
        reply: pastedReply,
      });
      return;
    }
    try {
      onTurn(commitPlan(ed, plan, { request: (request.trim() || promptedFor.current).slice(0, 400), engine: "paste" }));
      // In live view, a new or replaced simulation plays at once (and shows in the live bar's picker).
      if (plan.simulationId && paletteHost.get().canvas?.live) paletteHost.runSimulation(plan.simulationId);
      setFailure(null);
      setReply("");
      setRequest("");
      promptedFor.current = "";
      requestRef.current?.focus();
    } catch (err) {
      setFailure({ error: { i: -1, error: err instanceof Error ? err.message : String(err) }, reply: pastedReply });
    }
  };

  const apply = () => {
    dictation.stop();
    const ed = editorNow();
    if (!ed || !reply.trim()) return;
    runPlan(ed, parseReply(reply), reply);
  };

  const choose = (candidateId: string) => {
    const ed = editorNow();
    if (!ed || !failure?.ops) return;
    const ref = failure.error.ref ?? failedRef(failure.error.error);
    const ops = ref ? pickCandidate(failure.ops, failure.error.i, ref, candidateId) : null;
    if (!ops) return;
    const fixed = `\`\`\`json\n${JSON.stringify(ops, null, 2)}\n\`\`\``;
    setReply(fixed);
    runPlan(ed, { ok: true, kind: "ops", ops, ...(failure.layout ? { layout: failure.layout } : {}) }, fixed);
  };

  // Esc stops listening first; Ctrl+Enter applies. An input method's Enter or Esc is never ours.
  const onKeyDownCapture = (e: ReactKeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape" && dictation.status !== "idle") {
      e.preventDefault();
      e.stopPropagation();
      dictation.stop();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && reply.trim() && !explaining) {
      e.preventDefault();
      apply();
    }
  };

  const hasReply = !!reply.trim();
  const placeholder = explaining
    ? t("ai.eGWhereCouldThisFailUnder")
    : place === "create"
      ? t("ai.eGAKafkaTopicOrdersCreated")
      : place === "live"
        ? t("ai.eGAStormOf100New")
        : t("ai.exampleChange", { name: current?.nodes.find((n) => n.label)?.label ?? t("ai.firstService") });
  const replyStatus = pending
    ? t("ai.checkingReply")
    : parsed
      ? parsed.ok
        ? parsed.kind === "ops"
          ? t("ai.opsReady", { count: parsed.ops.length })
          : parsed.kind === "simulation"
            ? t("ai.simulationReady", { title: parsed.spec.title })
            : t("ai.aWholeDiagramItReplacesThisOne")
        : parsed.error
      : null;

  return (
    <section className={`ai-advanced${open ? " is-open" : ""}`} data-testid="ai-advanced">
      <button
        className="ai-advanced-toggle"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => onOpenChange(!open)}
        data-testid="ai-advanced-toggle"
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
        <span>{t("ai.advanced")}</span>
        <span className="ai-advanced-hint">{t("ai.copyAndPasteWithAnyChatbot")}</span>
      </button>
      {open && (
        <div id={`${id}-body`} className="ai-composer" data-testid="ai-composer" onKeyDownCapture={onKeyDownCapture}>
          {onDevice && <OnDevicePreference on={onDevice.on} set={onDevice.set} />}
          {failure && (
            <FailureBox
              failure={failure}
              copied={copied === "fix"}
              onCopyFix={copyFix}
              onChoose={choose}
              fixOff={privateDiagram}
            />
          )}
          {place !== "create" && (
            <div className="ai-intent" role="group" aria-label={t("ai.whatToDo")}>
              <button
                className={intent === "change" ? "is-on" : ""}
                aria-pressed={intent === "change"}
                onClick={() => setIntent("change")}
                data-testid="ai-intent-change"
              >
                {place === "live" ? t("ai.simulate") : t("ai.change")}
              </button>
              <button
                className={intent === "explain" ? "is-on" : ""}
                aria-pressed={intent === "explain"}
                onClick={() => setIntent("explain")}
                data-testid="ai-intent-explain"
              >
                {t("ai.explain")}
              </button>
            </div>
          )}
          <DictationField
            id={`${id}-request`}
            label={place === "create" ? t("ai.describeTheDiagram") : t("ai.describeWhatYouWant")}
            inputRef={requestRef}
            value={request}
            onChange={setRequest}
            placeholder={placeholder}
            rows={3}
            disabled={privateDiagram}
            dictation={dictation}
            shortcut
            testIds={{
              input: "ai-request",
              mic: "ai-mic",
              interim: "ai-interim",
              // eslint-disable-next-line local/no-literal-ui-text -- a test id, not display text
              message: "ai-dictation-message",
              service: "ai-speech-service",
            }}
          />
          <div className="ai-composer-row">
            <button
              className={`btn${hasReply ? "" : " btn-primary"}`}
              onClick={() => void copyPrompt()}
              disabled={!editor || privateDiagram}
              data-testid="ai-copy-prompt"
            >
              <Icon name={copied === "prompt" ? "check" : "copy"} size={14} />
              {copied === "prompt" ? t("ai.copied") : t("ai.copyPrompt")}
            </button>
            {privateDiagram ? (
              <span className="ai-hint" data-testid="ai-private-hint">
                {t("ai.offForThisPrivateDiagram")}
              </span>
            ) : (
              <span className="ai-hint" data-testid={explaining ? "ai-explain-note" : undefined}>
                {explaining ? t("ai.yourAIAnswersInItsOwnChat") : t("ai.pasteItIntoAnyChatbotThenIts")}
              </span>
            )}
          </div>
          {!explaining && (
            <>
              <label className="sr-only" htmlFor={`${id}-reply`}>
                {t("ai.pasteTheReply")}
              </label>
              <textarea
                id={`${id}-reply`}
                ref={replyRef}
                className="ix-input ix-mono ai-textarea ai-reply"
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  setFailure(null);
                }}
                placeholder={t("ai.pasteTheReply")}
                rows={3}
                disabled={privateDiagram}
                spellCheck={false}
                data-testid="ai-reply"
              />
              <div className="ai-composer-row">
                <span className={`ai-reply-status${parsed?.ok ? " is-ok" : ""}`} data-testid="ai-reply-status">
                  {!failure && replyStatus
                    ? replyStatus
                    : hasReply
                      ? ""
                      : t("ai.applyKeys", { keys: isolateKeys(legacyKeyHint("Mod+Enter")) })}
                </span>
                <button
                  className={`btn${hasReply && !failure ? " btn-primary" : ""}`}
                  disabled={!hasReply || !editor || privateDiagram}
                  onClick={apply}
                  data-testid="ai-apply"
                >
                  <Icon name="ai" size={14} />
                  {t("ai.apply")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
