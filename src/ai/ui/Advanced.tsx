import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { paletteHost } from "../../palette/host";
import { isLocalOnly } from "../../lib/localOnly";
import { LOCAL_ONLY_MESSAGE, describeForAi } from "../privacy";
import { failedRef, pickCandidate, planTurn } from "./apply";
import { commitPlan, type TurnRecord } from "./commitTurn";
import { aiPlace, liveText, type AiIntent } from "./context";
import { buildExplainPrompt, buildFixPrompt, buildPrompt, buildSimulationPrompt } from "./prompt";
import { parseReply, type ParsedReply } from "./reply";
import { useDictation } from "./useDictation";
import { useParsedReply } from "./useParsedReply";
import { FailureBox, type Failure } from "./parts";
import { rememberAdvancedOpen } from "./advancedPref";

// The AI panel's Advanced section: the manual flow for people without a browser agent. Copy a prompt for
// any chatbot, paste its reply, apply it as one undo step (or, for Explain, only copy). Closed by
// default; open or closed is remembered.

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

export function Advanced({
  open,
  onOpenChange,
  focusSeq,
  current,
  live,
  onTurn,
  onDevice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Changes when something asks for the request box (Build with AI): it opens and takes focus. */
  focusSeq: number | undefined;
  current: DiagramFile | null;
  live: boolean;
  onTurn: (turn: TurnRecord) => void;
  /** "Try the on-device model": offered only where Chrome's built-in model can run. */
  onDevice?: { on: boolean; set: (on: boolean) => void };
}) {
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
    if (!open) cancelDictation.current();
  }, [open]);
  useEffect(() => {
    if (!dictation.supported || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (dictation.status === "idle") requestRef.current?.focus();
        dictation.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dictation, open]);

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
    if (!ed) return;
    promptedFor.current = request.trim();
    const input = { request, describe: describeForAi(ed, paletteHost.get().canvas), context: contextFor(intent) };
    const prompt = explaining
      ? buildExplainPrompt(input)
      : place === "live"
        ? buildSimulationPrompt(input)
        : buildPrompt(input);
    const ok = await copyText(prompt);
    if (!ok) return notify("The browser didn't allow copying. Try again.", { kind: "error" });
    flashCopied("prompt");
    if (!explaining) replyRef.current?.focus();
  };

  const copyFix = async () => {
    const ed = editorNow();
    if (!ed || !failure) return;
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
    if (!ok) return notify("The browser didn't allow copying. Try again.", { kind: "error" });
    flashCopied("fix");
    replyRef.current?.select();
  };

  const runPlan = (ed: EditorApi, p: ParsedReply, pastedReply: string) => {
    if (isLocalOnly(paletteHost.get().canvas)) {
      setFailure({ error: { i: -1, error: LOCAL_ONLY_MESSAGE }, reply: pastedReply });
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

  const listening = dictation.status !== "idle";
  const hasReply = !!reply.trim();
  const placeholder = explaining
    ? "e.g. Where could this fail under load?"
    : place === "create"
      ? "e.g. A Kafka topic orders.created consumed by a .NET service billing-worker that writes to Postgres"
      : place === "live"
        ? "e.g. A storm of 100 new members at 9am, then the payment API fails"
        : `e.g. Add a dead-letter queue after ${current?.nodes.find((n) => n.label)?.label ?? "the first service"}`;
  const replyStatus = pending
    ? "Checking reply…"
    : parsed
      ? parsed.ok
        ? parsed.kind === "ops"
          ? `${parsed.ops.length} ${parsed.ops.length === 1 ? "op" : "ops"} ready`
          : parsed.kind === "simulation"
            ? `Simulation “${parsed.spec.title}” ready`
            : "A whole diagram: it replaces this one"
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
        <span>Advanced</span>
        <span className="ai-advanced-hint">Copy and paste with any chatbot</span>
      </button>
      {open && (
        <div id={`${id}-body`} className="ai-composer" data-testid="ai-composer" onKeyDownCapture={onKeyDownCapture}>
          {onDevice && (
            <label className="ai-ondevice-pref" data-testid="ai-ondevice-pref">
              <input
                type="checkbox"
                checked={onDevice.on}
                onChange={(e) => onDevice.set(e.target.checked)}
                data-testid="ai-ondevice-toggle"
              />
              <span>
                Try the on-device model
                <small>Chrome&apos;s built-in model, on this device: a request box at the panel&apos;s foot.</small>
              </span>
            </label>
          )}
          {failure && <FailureBox failure={failure} copied={copied === "fix"} onCopyFix={copyFix} onChoose={choose} />}
          {place !== "create" && (
            <div className="ai-intent" role="group" aria-label="What to do">
              <button
                className={intent === "change" ? "is-on" : ""}
                aria-pressed={intent === "change"}
                onClick={() => setIntent("change")}
                data-testid="ai-intent-change"
              >
                {place === "live" ? "Simulate" : "Change"}
              </button>
              <button
                className={intent === "explain" ? "is-on" : ""}
                aria-pressed={intent === "explain"}
                onClick={() => setIntent("explain")}
                data-testid="ai-intent-explain"
              >
                Explain
              </button>
            </div>
          )}
          <div className={`ai-request${listening ? " is-listening" : ""}`}>
            <label className="sr-only" htmlFor={`${id}-request`}>
              {place === "create" ? "Describe the diagram" : "Describe what you want"}
            </label>
            <textarea
              id={`${id}-request`}
              ref={requestRef}
              className="ix-input ai-textarea"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={placeholder}
              rows={3}
              spellCheck
              data-testid="ai-request"
            />
            {dictation.supported && (
              <button
                type="button"
                className={`ai-mic${listening ? " is-on" : ""}${dictation.hearing ? " is-hearing" : ""}`}
                onClick={() => {
                  if (!listening) requestRef.current?.focus();
                  dictation.toggle();
                }}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictating" : "Dictate"}
                title={`${listening ? "Stop dictating" : "Dictate"} (${MOD}+Shift+M)`}
                data-testid="ai-mic"
                data-status={dictation.status}
              >
                <Icon name="mic" size={15} />
              </button>
            )}
          </div>
          {(listening || dictation.interim) && (
            <p className="ai-interim" aria-live="polite" data-testid="ai-interim">
              {dictation.status === "starting" ? (
                <span className="ai-listening">Allow the microphone if your browser asks…</span>
              ) : dictation.interim ? (
                dictation.interim
              ) : (
                <span className="ai-listening">Listening{dictation.onDevice ? " on this device" : ""}…</span>
              )}
            </p>
          )}
          {dictation.message && (
            <p
              className={`ai-note${dictation.message.tone === "error" ? " is-error" : ""}`}
              role={dictation.message.tone === "error" ? "alert" : "status"}
              data-testid="ai-dictation-message"
            >
              {dictation.message.text}
            </p>
          )}
          <div className="ai-composer-row">
            <button
              className={`btn${hasReply ? "" : " btn-primary"}`}
              onClick={() => void copyPrompt()}
              disabled={!editor}
              data-testid="ai-copy-prompt"
            >
              <Icon name={copied === "prompt" ? "check" : "copy"} size={14} />
              {copied === "prompt" ? "Copied" : "Copy prompt"}
            </button>
            <span className="ai-hint" data-testid={explaining ? "ai-explain-note" : undefined}>
              {explaining
                ? "Your AI answers in its own chat; nothing to paste back."
                : "Paste it into any chatbot, then its reply below."}
            </span>
          </div>
          {!explaining && (
            <>
              <label className="sr-only" htmlFor={`${id}-reply`}>
                Paste the reply
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
                placeholder="Paste the reply"
                rows={3}
                spellCheck={false}
                data-testid="ai-reply"
              />
              <div className="ai-composer-row">
                <span className={`ai-reply-status${parsed?.ok ? " is-ok" : ""}`} data-testid="ai-reply-status">
                  {!failure && replyStatus ? replyStatus : hasReply ? "" : `${MOD}+Enter applies · one undo step`}
                </span>
                <button
                  className={`btn${hasReply && !failure ? " btn-primary" : ""}`}
                  disabled={!hasReply || !editor}
                  onClick={apply}
                  data-testid="ai-apply"
                >
                  <Icon name="ai" size={14} /> Apply
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
