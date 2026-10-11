import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import type { EditorApi } from "../../editor/types";
import type { Stencil } from "../../model/types";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { paletteHost } from "../../palette/host";
import { getStencil } from "../../stencils/registry";
import { type AiError, type DiagramOp } from "../index";
import {
  choiceIsCurrent,
  failedRef,
  pickCandidate,
  planTurn,
  swapStencil,
  type StencilChoice,
  type TurnPlan,
} from "./apply";
import { shadowOverlay, showApplied } from "./feedback";
import { buildFixPrompt, buildPrompt } from "./prompt";
import { parseReply, type ParsedReply } from "./reply";
import { LOCAL_ONLY_MESSAGE, describeForAi } from "../privacy";
import { isLocalOnly } from "../../lib/localOnly";
import { useParsedReply } from "./useParsedReply";
import { useDictation } from "./useDictation";
import "./ai.css";

// "Build with AI": describe a change, copy a prompt for your own chatbot, paste its reply, apply.
// A floating panel (not modal) so the diagram stays visible and editable while you iterate; each
// applied turn is one undo step, and the panel keeps the turns so you can keep refining.

interface Turn {
  id: number;
  request: string;
  summary: string;
  choices: StencilChoice[];
  warnings: string[];
  documentId?: string;
}

interface Failure {
  error: AiError;
  /** The reply that failed, as pasted (for the fix-up prompt). */
  reply: string;
  /** The ops that failed, when the reply had ops (a candidate click patches them). */
  ops?: DiagramOp[];
  layout?: Extract<ParsedReply, { kind: "ops" }>["layout"];
}

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

let turnSeq = 0;

export default function AiDialog({ onClose }: { onClose: () => void }) {
  const host = useSyncExternalStore(paletteHost.subscribe, paletteHost.get);
  const localOnly = isLocalOnly(host.canvas);
  const titleId = useId();
  const [request, setRequest] = useState("");
  const [reply, setReply] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copied, setCopied] = useState<"prompt" | "fix" | null>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const historyEnd = useRef<HTMLLIElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // The canvas's fit keeps the diagram clear of this panel.
  useEffect(() => (panelRef.current ? shadowOverlay(panelRef.current) : undefined), []);
  /** The last request a prompt was copied for: the turn's title once applied. */
  const promptedFor = useRef("");

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

  const { parsed, pending } = useParsedReply(reply);

  useEffect(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    requestRef.current?.focus();
    return () => {
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) {
        const fallback =
          document.querySelector<HTMLElement>('[data-testid="file-button"]') ??
          document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
        (target?.isConnected && target !== document.body ? target : fallback)?.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(
    () =>
      paletteHost.subscribe(() => {
        const currentHost = paletteHost.get();
        const editor = currentHost.canvas?.editor;
        if (!editor) return;
        const current = editor.getDiagram();
        setTurns((all) => {
          let changed = false;
          const next = all.map((turn) => ({
            ...turn,
            choices: turn.choices.map((choice) => {
              if (
                choice.stale ||
                (turn.documentId === currentHost.canvas?.documentId && choiceIsCurrent(current, choice))
              )
                return choice;
              changed = true;
              return { ...choice, stale: true };
            }),
          }));
          return changed ? next : all;
        });
      }),
    [],
  );

  useEffect(() => {
    historyEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const flashCopied = (what: "prompt" | "fix") => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  };

  const copyPrompt = async () => {
    const editor = editorNow();
    if (!editor) return;
    promptedFor.current = request.trim();
    const ok = await copyText(buildPrompt({ request, describe: describeForAi(editor, paletteHost.get().canvas) }));
    if (!ok) return notify("The browser didn't allow copying. Try again.", { kind: "error" });
    flashCopied("prompt");
    replyRef.current?.focus();
  };

  const copyFix = async () => {
    const editor = editorNow();
    if (!editor || !failure) return;
    if (isLocalOnly(paletteHost.get().canvas)) {
      const ok = await copyText(buildPrompt({ request, describe: LOCAL_ONLY_MESSAGE }));
      if (ok) flashCopied("fix");
      return;
    }
    const ok = await copyText(
      buildFixPrompt({
        request: request || promptedFor.current,
        describe: describeForAi(editor, paletteHost.get().canvas),
        reply: failure.reply,
        error: failure.error,
      }),
    );
    if (!ok) return notify("The browser didn't allow copying. Try again.", { kind: "error" });
    flashCopied("fix");
    replyRef.current?.select();
  };

  /** Applies a plan as one undo step and records the turn. */
  const commit = useCallback((editor: EditorApi, plan: Extract<TurnPlan, { ok: true }>, title: string) => {
    editor.applyDiagram(plan.next, { merge: `ai:dialog:${++turnSeq}` });
    showApplied(plan.summary, plan.changed, editor);
    setTurns((t) => [
      ...t,
      {
        id: turnSeq,
        request: title,
        summary: plan.summary,
        choices: plan.choices,
        warnings: plan.warnings,
        documentId: paletteHost.get().canvas?.documentId,
      },
    ]);
    setFailure(null);
    setReply("");
    setRequest("");
    promptedFor.current = "";
    requestRef.current?.focus();
  }, []);

  const runPlan = (editor: EditorApi, p: ParsedReply, pastedReply: string) => {
    if (isLocalOnly(paletteHost.get().canvas)) {
      setFailure({ error: { i: -1, error: LOCAL_ONLY_MESSAGE }, reply: pastedReply });
      return;
    }
    const plan = planTurn(editor.getDiagram(), p);
    if (!plan.ok) {
      setFailure({
        error: plan.error,
        reply: pastedReply,
        ...(p.ok && p.kind === "ops" ? { ops: p.ops, layout: p.layout } : {}),
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
      commit(editor, plan, (request.trim() || promptedFor.current || "Pasted reply").slice(0, 400));
    } catch (err) {
      setFailure({
        error: { i: -1, error: err instanceof Error ? err.message : String(err) },
        reply: pastedReply,
      });
    }
  };

  const apply = () => {
    dictation.stop();
    const editor = editorNow();
    if (!editor || !reply.trim()) return;
    runPlan(editor, parseReply(reply), reply);
  };

  const choose = (candidateId: string) => {
    const editor = editorNow();
    if (!editor || !failure?.ops) return;
    const ref = failure.error.ref ?? failedRef(failure.error.error);
    const ops = ref ? pickCandidate(failure.ops, failure.error.i, ref, candidateId) : null;
    if (!ops) return;
    const fixed = `\`\`\`json\n${JSON.stringify(ops, null, 2)}\n\`\`\``;
    setReply(fixed);
    runPlan(editor, { ok: true, kind: "ops", ops, ...(failure.layout ? { layout: failure.layout } : {}) }, fixed);
  };

  const swap = (turnId: number, choice: StencilChoice, stencilId: string) => {
    const editor = editorNow();
    const turn = turns.find((t) => t.id === turnId);
    if (
      !editor ||
      localOnly ||
      !turn ||
      choice.stale ||
      turn.documentId !== host.canvas?.documentId ||
      !choiceIsCurrent(editor.getDiagram(), choice)
    )
      return notify("This stencil choice is stale. Ask for a new turn.", { kind: "error" });
    const plan = swapStencil(editor.getDiagram(), choice.nodeId, stencilId, choice.node);
    if (!plan.ok) return notify(plan.error.error, { kind: "error" });
    editor.applyDiagram(plan.next, { merge: `ai:swap:${++turnSeq}` });
    const s = getStencil(stencilId);
    const label = editor.getNode(choice.nodeId)?.label || choice.nodeId;
    showApplied(`${label} is now ${s.label}`, [choice.nodeId], editor);
    setTurns((all) =>
      all.map((t) =>
        t.id !== turnId
          ? t
          : {
              ...t,
              choices: t.choices.map((c) =>
                c.nodeId !== choice.nodeId
                  ? c
                  : {
                      ...c,
                      stale: false,
                      node: plan.next.nodes.find((n) => n.id === c.nodeId),
                      stencil: {
                        ...c.stencil,
                        id: s.id,
                        label: s.label,
                        confidence: "high",
                        alternatives: [c.stencil.id, ...c.stencil.alternatives.filter((a) => a !== s.id)],
                      },
                    },
              ),
            },
      ),
    );
  };

  // Esc stops listening first, then closes. Ctrl+Shift+M dictates. Ctrl+Enter applies.
  const onKeyDownCapture = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (dictation.status !== "idle") dictation.stop();
      else onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && hasReply) {
      e.preventDefault();
      apply();
    }
  };
  useEffect(() => {
    if (!dictation.supported) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (dictation.status === "idle") requestRef.current?.focus();
        dictation.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dictation]);

  const listening = dictation.status !== "idle";
  const hasReply = !!reply.trim();
  const replyStatus = pending
    ? "Checking reply…"
    : parsed
      ? parsed.ok
        ? parsed.kind === "ops"
          ? `${parsed.ops.length} ${parsed.ops.length === 1 ? "op" : "ops"} ready`
          : "A whole diagram: it replaces this one"
        : parsed.error
      : null;

  return createPortal(
    <aside
      ref={panelRef}
      className="ai-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="ai-dialog"
      data-editor-overlay
      onKeyDownCapture={onKeyDownCapture}
      onContextMenu={(e) => {
        if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      }}
    >
      <header className="ai-head">
        <span className="ai-head-icon" aria-hidden>
          <Icon name="ai" size={16} />
        </span>
        <div className="ai-head-titles">
          <h2 id={titleId}>Build with AI</h2>
          <p>Use ChatGPT, Claude or Gemini. Nothing is sent from here.</p>
        </div>
        <button className="icon-btn icon-btn-quiet" onClick={onClose} aria-label="Close" data-testid="ai-dialog-close">
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="ai-body">
        {localOnly && (
          <p className="ai-note" role="status" data-testid="ai-privacy-note">
            {LOCAL_ONLY_MESSAGE}
          </p>
        )}
        {turns.length > 0 && (
          <ol className="ai-history" aria-label="Applied changes" data-testid="ai-history">
            {turns.map((t, n) => (
              <li key={t.id} className="ai-turn" data-testid={`ai-turn-${n}`}>
                <p className="ai-turn-request">{t.request}</p>
                <p className="ai-turn-summary" data-testid={`ai-turn-${n}-summary`}>
                  <Icon name="check" size={13} /> {t.summary}
                </p>
                {t.warnings.length > 0 && (
                  <ul className="ai-turn-warnings">
                    {t.warnings.slice(0, 3).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                {t.choices.map((c) => (
                  <ChoiceRow key={c.nodeId} choice={c} onSwap={(id) => swap(t.id, c, id)} />
                ))}
              </li>
            ))}
            <li ref={historyEnd} aria-hidden className="ai-history-end" />
          </ol>
        )}

        <section className="ai-step">
          <label className="ai-step-label" htmlFor={`${titleId}-request`}>
            <span className="ai-step-num" aria-hidden>
              1
            </span>
            {turns.length ? "Describe the next change" : "Describe what you want"}
          </label>
          <div className={`ai-request${listening ? " is-listening" : ""}`}>
            <textarea
              id={`${titleId}-request`}
              ref={requestRef}
              className="ix-input ai-textarea"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={
                turns.length
                  ? "e.g. Add a dead-letter queue after billing-worker"
                  : "e.g. A Kafka topic orders.created consumed by a .NET service billing-worker that writes to Postgres"
              }
              rows={4}
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
        </section>

        <section className="ai-step">
          <div className="ai-step-label">
            <span className="ai-step-num" aria-hidden>
              2
            </span>
            Ask your AI
          </div>
          <div className="ai-copy-row">
            <button
              className={`btn${hasReply ? "" : " btn-primary"}`}
              onClick={() => void copyPrompt()}
              data-testid="ai-copy-prompt"
            >
              <Icon name={copied === "prompt" ? "check" : "copy"} size={14} />
              {copied === "prompt" ? "Copied" : "Copy prompt for your AI"}
            </button>
            <span className="ai-hint">Paste it into ChatGPT, Claude or Gemini.</span>
          </div>
        </section>

        <section className="ai-step">
          <label className="ai-step-label" htmlFor={`${titleId}-reply`}>
            <span className="ai-step-num" aria-hidden>
              3
            </span>
            Paste the reply
          </label>
          <textarea
            id={`${titleId}-reply`}
            ref={replyRef}
            className="ix-input ix-mono ai-textarea ai-reply"
            value={reply}
            onChange={(e) => {
              setReply(e.target.value);
              setFailure(null);
            }}
            placeholder={'```json\n[{ "op": "add_node", "kind": "Kafka topic", "label": "orders" }]\n```'}
            rows={5}
            spellCheck={false}
            data-testid="ai-reply"
          />
          {replyStatus && !failure && (
            <p className={`ai-reply-status${parsed?.ok ? " is-ok" : ""}`} data-testid="ai-reply-status">
              {replyStatus}
            </p>
          )}
        </section>

        {failure && <FailureBox failure={failure} copied={copied === "fix"} onCopyFix={copyFix} onChoose={choose} />}
      </div>

      <footer className="ai-foot">
        <span className="ai-foot-hint">
          {hasReply ? `${MOD}+Enter applies · one undo step` : "Each change is one undo step"}
        </span>
        <button
          className={`btn${hasReply && !failure ? " btn-primary" : ""}`}
          disabled={!hasReply}
          onClick={apply}
          data-testid="ai-apply"
        >
          <Icon name="ai" size={14} /> Apply
        </button>
      </footer>
    </aside>,
    document.body,
  );
}

/** A stencil icon on its light tile, as on the canvas (brand marks are dark ink). */
function Tile({ stencil, size }: { stencil: Stencil; size: number }) {
  return (
    <span className="ai-tile" style={{ "--tile-accent": stencil.accent } as CSSProperties}>
      <StencilIcon stencil={stencil} size={size} />
    </span>
  );
}

function ChoiceRow({ choice, onSwap }: { choice: StencilChoice; onSwap: (stencilId: string) => void }) {
  const s = getStencil(choice.stencil.id);
  const sure = choice.stencil.confidence === "high";
  return (
    <div className="ai-choice" data-testid={`ai-choice-${choice.nodeId}`}>
      <span className="ai-choice-pick">
        <Tile stencil={s} size={16} />
        <span>
          <strong>{s.label}</strong>
          {!sure && (
            <>
              {" "}
              for “{choice.kind}”{" "}
              <span className={`ai-confidence is-${choice.stencil.confidence}`}>
                {choice.stencil.confidence === "low" ? "a guess" : "not sure"}
              </span>
            </>
          )}
        </span>
      </span>
      {choice.stale && (
        <span className="ai-hint" data-testid={`ai-choice-stale-${choice.nodeId}`}>
          This node changed or was removed. Ask for a new turn.
        </span>
      )}
      {choice.stencil.alternatives.length > 0 && (
        <span className="ai-choice-alts" role="group" aria-label={`Other stencils for ${choice.kind}`}>
          {choice.stencil.alternatives.slice(0, 3).map((id) => {
            const alt = getStencil(id);
            return (
              <button
                key={id}
                className="ai-alt"
                onClick={() => onSwap(id)}
                title={
                  choice.stale
                    ? "This node changed or was removed. Ask for a new turn."
                    : `Use ${alt.label} (${alt.vendor})`
                }
                aria-label={`Use ${alt.label}`}
                data-testid={`ai-swap-${choice.nodeId}-${id}`}
                data-node={choice.nodeId}
                data-stencil={id}
                disabled={choice.stale}
              >
                <Tile stencil={alt} size={13} />
                {alt.label}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}

function FailureBox({
  failure,
  copied,
  onCopyFix,
  onChoose,
}: {
  failure: Failure;
  copied: boolean;
  onCopyFix: () => void;
  onChoose: (id: string) => void;
}) {
  const { error } = failure;
  const canPick = !!failure.ops && !!(error.ref ?? failedRef(error.error));
  const candidates = error.candidates?.slice(0, 8) ?? [];
  return (
    <section className="ai-failure" role="alert" data-testid="ai-error">
      <p className="ai-failure-title">
        <Icon name="info" size={14} />
        <span>
          Nothing was applied.{" "}
          {error.i >= 0 && failure.ops ? (
            <>
              Op {error.i + 1} of {failure.ops.length}:{" "}
            </>
          ) : null}
          <span data-testid="ai-error-message">{error.error}</span>
        </span>
      </p>
      {candidates.length > 0 && (
        <div className="ai-candidates">
          <p className="ai-candidates-label">
            {canPick ? "Did you mean one of these? Pick one to apply." : "Elements it could mean:"}
          </p>
          <ul data-testid="ai-candidates">
            {candidates.map((c) => {
              const s = c.stencil ? getStencil(c.stencil) : undefined;
              const body = (
                <>
                  {s && <Tile stencil={s} size={14} />}
                  <span className="ai-candidate-label">{c.label || c.id}</span>
                  <code>{c.id}</code>
                </>
              );
              return (
                <li key={c.id}>
                  {canPick ? (
                    <button
                      className="ai-candidate"
                      onClick={() => onChoose(c.id)}
                      data-testid={`ai-candidate-${c.id}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <span className="ai-candidate" data-testid={`ai-candidate-${c.id}`}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error.hint && !canPick && <p className="ai-failure-hint">{error.hint}</p>}
      <div className="ai-copy-row">
        <button className="btn btn-primary" onClick={onCopyFix} data-testid="ai-copy-fix">
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy fix-up prompt"}
        </button>
        <span className="ai-hint">Your AI corrects its reply; paste it back above.</span>
      </div>
    </section>
  );
}
