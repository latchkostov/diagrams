import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile, Stencil } from "../../model/types";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { paletteHost } from "../../palette/host";
import { getStencil } from "../../stencils/registry";
import { type AiError, type DiagramOp } from "../index";
import {
  choiceIsCurrent,
  diffDiagrams,
  failedRef,
  pickCandidate,
  planTurn,
  summarize,
  swapStencil,
  type StencilChoice,
  type TurnPlan,
} from "./apply";
import { markElements, showApplied } from "./feedback";
import { buildExplainPrompt, buildFixPrompt, buildPrompt, buildSimulationPrompt } from "./prompt";
import { aiPlace, emptyHeading, liveText, resolveScope, scopeText, suggestions, type AiIntent } from "./context";
import { parseReply, type ParsedReply } from "./reply";
import { LOCAL_ONLY_MESSAGE, describeForAi } from "../privacy";
import { isLocalOnly } from "../../lib/localOnly";
import { useParsedReply } from "./useParsedReply";
import { useDictation } from "./useDictation";
import { aiDock, clampWidth, collapseDock, useAiDock } from "./dock";
import { latestTurn, loadThread, saveThread, sameContent, turnId, type ThreadTurn } from "./thread";
import type { PanelRequest } from "./AiMount";
import { useModelTurn, type ModelTurnDone } from "./useModelTurn";
import { ConnectModel } from "./ConnectModel";
import { modelLabel, useConnection } from "../engine/settings";
import "./ai.css";

// "Ask AI": a docked panel beside the canvas, part of the tooling. Describe a change, get it applied as
// one undo step, and keep going; the thread remembers each turn for this diagram (in this browser only)
// with Undo this change, Revert to here, and a highlight of what it touched.

interface Failure {
  error: AiError;
  /** The reply that failed, as pasted (for the fix-up prompt). */
  reply: string;
  /** The ops that failed, when the reply had ops (a candidate click patches them). */
  ops?: DiagramOp[];
  layout?: Extract<ParsedReply, { kind: "ops" }>["layout"];
  /** The reply was a simulation (the fix-up prompt asks for one again). */
  simulation?: boolean;
}

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

let mergeSeq = 0;
const FRESH_MS = 5000;

export default function AiPanel({ request: opened }: { request: PanelRequest | null }) {
  const host = useSyncExternalStore(paletteHost.subscribe, paletteHost.get);
  const canvas = host.canvas;
  const editor = canvas?.editor ?? null;
  const documentId = canvas?.documentId;
  const localOnly = isLocalOnly(canvas);
  const titleId = useId();
  const [request, setRequest] = useState("");
  const [reply, setReply] = useState("");
  const [turns, setTurns] = useState<ThreadTurn[]>(() => (documentId ? loadThread(documentId) : []));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copied, setCopied] = useState<"prompt" | "fix" | null>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const historyEnd = useRef<HTMLLIElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  /** The last request a prompt was copied for: the turn's title once applied. */
  const promptedFor = useRef("");
  const conn = useConnection();
  const [showConnect, setShowConnect] = useState(false);
  /** With a connected model, the user can still copy and paste (this panel session). */
  const [pasteInstead, setPasteInstead] = useState(false);
  const modelMode = !!conn && !pasteInstead;
  // A request made just now (Build with AI opens a new diagram first, so this panel mounts after it);
  // an old one is only the reason the dock is open.
  const [fresh] = useState(() => !!opened && Date.now() - opened.at < FRESH_MS);
  /** Change with AI…: the ids the request is about (a removable chip). */
  const [scope, setScope] = useState<string[]>(() =>
    fresh && opened?.documentId === documentId ? (opened?.scope ?? []) : [],
  );
  const [intent, setIntent] = useState<AiIntent>(() => (fresh && opened?.intent) || "change");

  // The diagram as it is now (re-read on every edit: the host republishes with each revision).
  const current = useMemo<DiagramFile | null>(() => (editor ? editor.getDiagram() : null), [editor, host]); // eslint-disable-line react-hooks/exhaustive-deps

  // The thread is saved per diagram, in this browser only.
  const loadedFor = useRef(documentId);
  useEffect(() => {
    if (!documentId || loadedFor.current !== documentId) return;
    saveThread(documentId, turns);
  }, [documentId, turns]);

  // Each open request (the top bar, the rail, Ctrl+I, a menu) focuses the composer; Change with AI…
  // attaches its selection, and a menu can pick the intent.
  const [seenRequest, setSeenRequest] = useState(opened?.seq);
  if (opened && opened.seq !== seenRequest) {
    setSeenRequest(opened.seq);
    if (opened.scope) setScope(opened.scope);
    if (opened.intent) setIntent(opened.intent);
  }
  const focusedFor = useRef(fresh ? undefined : opened?.seq);
  useEffect(() => {
    if (!opened || focusedFor.current === opened.seq) return;
    focusedFor.current = opened.seq;
    requestRef.current?.focus();
  }, [opened]);

  // Leaving the panel (it unmounts with a diagram switch) clears any highlight.
  useEffect(() => () => markElements([]), []);

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
    historyEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const flashCopied = (what: "prompt" | "fix") => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  };

  const addTurn = useCallback((turn: Omit<ThreadTurn, "id" | "at">) => {
    setTurns((t) => [...t, { ...turn, id: turnId(), at: Date.now() }]);
  }, []);

  const live = !!canvas?.live;
  const place = aiPlace(current, live);
  const scopeItems = useMemo(() => (current ? resolveScope(current, scope) : []), [current, scope]);
  const explaining = intent === "explain" && place !== "create";

  /** The lines after the diagram: the selection the request is about and, to explain live view, what's running. */
  const contextFor = (forIntent: AiIntent): string => {
    if (isLocalOnly(paletteHost.get().canvas)) return "";
    const parts = [scopeText(scopeItems)];
    const session = paletteHost.get().session;
    const ed = editorNow();
    if (live && forIntent === "explain" && session?.state && ed) parts.push(liveText(session.state(), ed.getDiagram()));
    return parts.filter(Boolean).join("\n\n");
  };

  /** In live view, a new or replaced simulation plays at once (and shows in the live bar's picker). */
  const playSimulation = (id: string | undefined) => {
    if (id && paletteHost.get().canvas?.live) paletteHost.runSimulation(id);
  };

  const scopeRecord = () => (scopeItems.length ? scopeItems.map(({ id, label }) => ({ id, label })) : undefined);

  /** The scope at the time a request was sent (the turn records it). */
  const scopeRef = useRef<ThreadTurn["scope"]>(undefined);
  const onModelDone = useCallback(
    ({ turn, simulations }: ModelTurnDone) => {
      addTurn({ ...turn, ...(scopeRef.current ? { scope: scopeRef.current } : {}) });
      playSimulation(simulations[0]);
      setRequest("");
      requestRef.current?.focus();
    },
    [addTurn],
  );
  const model = useModelTurn(onModelDone);

  /** Sends the request to the connected model, with the last few turns for context. */
  const send = () => {
    dictation.stop();
    const text = request.trim();
    if (!text || model.running) return;
    const history = turns
      .filter((t) => t.request && t.kind !== "revert")
      .slice(-6)
      .flatMap((t) => [
        { role: "user" as const, text: t.request },
        { role: "assistant" as const, text: t.reply || t.summary || "Done." },
      ]);
    scopeRef.current = scopeRecord();
    const liveNote =
      live && !explaining
        ? "The user is in live view. Unless they ask to change the diagram itself, describe their scenario as one simulation with set_simulation: it's saved and plays straight away."
        : "";
    const context = [contextFor(intent), liveNote].filter(Boolean).join("\n\n");
    void model.send({ request: text, intent: explaining ? "explain" : "change", context, history });
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
        context: contextFor("change"),
        simulation: failure.simulation,
      }),
    );
    if (!ok) return notify("The browser didn't allow copying. Try again.", { kind: "error" });
    flashCopied("fix");
    replyRef.current?.select();
  };

  /** Applies a plan as one undo step and records the turn. */
  const commit = (ed: EditorApi, plan: Extract<TurnPlan, { ok: true }>, title: string) => {
    ed.applyDiagram(plan.next, { merge: `ai:panel:${++mergeSeq}` });
    showApplied(plan.summary, plan.changed, ed);
    addTurn({
      kind: "change",
      request: title,
      ...(scopeRecord() ? { scope: scopeRecord() } : {}),
      summary: plan.summary,
      changed: plan.changed,
      choices: plan.choices,
      warnings: plan.warnings,
      after: ed.getDiagram(),
      engine: "paste",
    });
    playSimulation(plan.simulationId);
    setFailure(null);
    setReply("");
    setRequest("");
    promptedFor.current = "";
    requestRef.current?.focus();
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
      commit(ed, plan, (request.trim() || promptedFor.current).slice(0, 400));
    } catch (err) {
      setFailure({
        error: { i: -1, error: err instanceof Error ? err.message : String(err) },
        reply: pastedReply,
      });
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

  const swap = (turn: ThreadTurn, choice: StencilChoice, stencilId: string) => {
    const ed = editorNow();
    if (!ed || localOnly || !choiceIsCurrent(ed.getDiagram(), choice))
      return notify("This stencil choice is stale. Ask for a new turn.", { kind: "error" });
    const plan = swapStencil(ed.getDiagram(), choice.nodeId, stencilId, choice.node);
    if (!plan.ok) return notify(plan.error.error, { kind: "error" });
    ed.applyDiagram(plan.next, { merge: `ai:swap:${++mergeSeq}` });
    const s = getStencil(stencilId);
    const label = ed.getNode(choice.nodeId)?.label || choice.nodeId;
    showApplied(`${label} is now ${s.label}`, [choice.nodeId], ed);
    setTurns((all) =>
      all.map((t) =>
        t.id !== turn.id
          ? t
          : {
              ...t,
              choices: t.choices?.map((c) =>
                c.nodeId !== choice.nodeId
                  ? c
                  : {
                      ...c,
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

  /** Undo this change: the latest turn, through the normal undo history. */
  const undoTurn = (turn: ThreadTurn) => {
    const ed = editorNow();
    if (!ed || latestTurn(turns, ed.getDiagram())?.id !== turn.id) return;
    ed.undo();
    setTurns((all) => all.map((t) => (t.id === turn.id ? { ...t, undone: true } : t)));
  };

  /** Revert to here: the diagram as it was after this turn, as one undo step (and a turn of its own). */
  const revertTo = (turn: ThreadTurn) => {
    const ed = editorNow();
    if (!ed || !turn.after || localOnly) return;
    const before = ed.getDiagram();
    try {
      ed.applyDiagram(turn.after, { merge: `ai:revert:${++mergeSeq}` });
    } catch (err) {
      return notify(`Couldn't revert. ${err instanceof Error ? err.message : String(err)}`, { kind: "error" });
    }
    const after = ed.getDiagram();
    const diff = diffDiagrams(before, after);
    const label = turn.request || "a pasted reply";
    addTurn({
      kind: "revert",
      request: `Reverted to “${label.length > 60 ? `${label.slice(0, 60)}…` : label}”`,
      summary: summarize(diff),
      changed: diff.changed,
      after,
    });
    notify(`Reverted to “${label.length > 40 ? `${label.slice(0, 40)}…` : label}”.`, {
      kind: "success",
      action: { label: "Undo", run: () => ed.undo(), testId: "ai-toast-undo" },
    });
  };

  const clearConversation = () => {
    const previous = turns;
    setTurns([]);
    markElements([]);
    notify("Conversation cleared.", {
      action: { label: "Undo", run: () => setTurns((t) => (t.length ? t : previous)), testId: "ai-clear-undo" },
    });
  };

  // Esc stops listening first, then hands the keyboard back to the canvas. Ctrl+Enter applies.
  const onKeyDownCapture = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (dictation.status !== "idle") dictation.stop();
      else document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
    } else if (e.key === "Enter" && modelMode && !e.shiftKey && e.target === requestRef.current) {
      e.preventDefault();
      send();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && hasReply && !modelMode && !explaining) {
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
  const latest = latestTurn(turns, current);
  const heading = emptyHeading(place, scopeItems.length > 0);
  const chips = localOnly ? [] : suggestions(place, scopeItems.length > 0);
  const placeholder = explaining
    ? "e.g. Where could this fail under load?"
    : place === "create"
      ? "e.g. A Kafka topic orders.created consumed by a .NET service billing-worker that writes to Postgres"
      : place === "live"
        ? "e.g. A storm of 100 new members at 9am, then the payment API fails"
        : "e.g. Add a dead-letter queue after billing-worker";
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
    <section
      ref={panelRef}
      className="ai-panel"
      aria-labelledby={titleId}
      data-testid="ai-panel"
      data-editor-overlay
      onKeyDownCapture={onKeyDownCapture}
    >
      <ResizeHandle />
      <header className="ai-head">
        <span className="ai-head-icon" aria-hidden>
          <Icon name="ai" size={15} />
        </span>
        <div className="ai-head-titles">
          <h2 id={titleId}>Ask AI</h2>
          <p data-testid="ai-engine">
            {modelMode ? `${modelLabel(conn.model)} · your key` : "Copy and paste with your chatbot"}
          </p>
        </div>
        <button
          className={`icon-btn icon-btn-quiet${showConnect ? " is-pressed" : ""}`}
          onClick={() => setShowConnect((v) => !v)}
          aria-pressed={showConnect}
          aria-label="Connect a model"
          title="Connect a model (your own key)"
          data-testid="ai-connect-toggle"
        >
          <Icon name="key" size={14} />
        </button>
        {turns.length > 0 && (
          <button
            className="icon-btn icon-btn-quiet"
            onClick={clearConversation}
            aria-label="Clear conversation"
            title="Clear conversation"
            data-testid="ai-clear"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
        <button
          className="icon-btn icon-btn-quiet"
          onClick={collapseDock}
          aria-label="Hide Ask AI"
          title={`Hide Ask AI (${MOD}+I)`}
          data-testid="ai-collapse"
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </header>

      <div className="ai-body">
        {localOnly && (
          <p className="ai-note" role="status" data-testid="ai-privacy-note">
            {LOCAL_ONLY_MESSAGE}
          </p>
        )}
        {showConnect && <ConnectModel onDone={() => setShowConnect(false)} />}
        {turns.length > 0 || model.running ? (
          <ol className="ai-history" aria-label="Conversation" data-testid="ai-history">
            {turns.map((t, n) => (
              <TurnItem
                key={t.id}
                turn={t}
                n={n}
                current={current}
                latest={latest?.id === t.id}
                canChange={!!editor && !localOnly}
                onUndo={() => undoTurn(t)}
                onRevert={() => revertTo(t)}
                onSwap={(c, id) => swap(t, c, id)}
              />
            ))}
            {model.running && (
              <li className="ai-turn is-running" data-testid="ai-running" aria-busy="true">
                <p className="ai-turn-request">{model.running.request}</p>
                <div className="ai-turn-card">
                  <p className="ai-turn-reply" aria-live="polite">
                    {model.running.text || <span className="ai-thinking">Working on it…</span>}
                  </p>
                </div>
              </li>
            )}
            <li ref={historyEnd} aria-hidden className="ai-history-end" />
          </ol>
        ) : (
          <div className="ai-empty" data-testid="ai-empty" data-place={place}>
            <h3>{localOnly ? "AI is off for this diagram" : heading.title}</h3>
            {!localOnly && <p>{heading.text}</p>}
            {chips.length > 0 && (
              <ul className="ai-chips" aria-label="Suggestions">
                {chips.map((c, i) => (
                  <li key={c.label}>
                    <button
                      className="ai-chip"
                      onClick={() => {
                        setRequest(c.request);
                        setIntent(c.intent);
                        requestRef.current?.focus();
                      }}
                      data-testid={`ai-suggestion-${i}`}
                      data-intent={c.intent}
                    >
                      {c.intent === "explain" && <Icon name="info" size={12} />}
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {model.error && (
          <p className="ai-note is-error" role="alert" data-testid="ai-model-error">
            {model.error}
          </p>
        )}
        {failure && <FailureBox failure={failure} copied={copied === "fix"} onCopyFix={copyFix} onChoose={choose} />}
      </div>

      <div className="ai-composer" data-testid="ai-composer">
        {(place !== "create" || scopeItems.length > 0) && (
          <div className="ai-composer-row ai-composer-top">
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
            {scopeItems.length > 0 && (
              <span className="ai-scope" data-testid="ai-scope" title={scopeItems.map((i) => i.label).join(", ")}>
                <span className="ai-scope-label">
                  {scopeItems.length === 1 ? scopeItems[0].label : `${scopeItems.length} selected`}
                </span>
                <button
                  onClick={() => setScope([])}
                  aria-label="Remove the selection from the request"
                  data-testid="ai-scope-clear"
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            )}
          </div>
        )}
        <div className={`ai-request${listening ? " is-listening" : ""}`}>
          <label className="sr-only" htmlFor={`${titleId}-request`}>
            Describe what you want
          </label>
          <textarea
            id={`${titleId}-request`}
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

        {modelMode ? (
          <div className="ai-composer-row">
            <button className="link-btn" onClick={() => setPasteInstead(true)} data-testid="ai-use-paste">
              Copy prompt instead
            </button>
            <span className="ai-grow" />
            {model.running ? (
              <button className="btn" onClick={model.stop} data-testid="ai-stop">
                Stop
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!request.trim() || !editor || localOnly}
                onClick={send}
                title="Send (Enter) · one undo step"
                data-testid="ai-send"
              >
                <Icon name="send" size={14} /> Send
              </button>
            )}
          </div>
        ) : (
          <>
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
                  : "Paste it into your AI, then its reply below."}
              </span>
            </div>
            {!explaining && (
              <>
                <label className="sr-only" htmlFor={`${titleId}-reply`}>
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
            {!conn && !showConnect && (
              <button
                className="link-btn ai-use-model"
                onClick={() => setShowConnect(true)}
                data-testid="ai-connect-link"
              >
                Or connect your own model to apply changes directly
              </button>
            )}
            {conn && (
              <button
                className="link-btn ai-use-model"
                onClick={() => setPasteInstead(false)}
                data-testid="ai-use-model"
              >
                Use {modelLabel(conn.model)} instead
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Drag (or ←/→) the dock's left edge; the width is remembered. */
function ResizeHandle() {
  const { width } = useAiDock();
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);
  const shown = clampWidth(width);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: shown };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    aiDock.set({ width: clampWidth(start.current.w + start.current.x - e.clientX) });
  };
  const end = () => {
    start.current = null;
    setDragging(false);
  };
  return (
    // The ARIA window-splitter pattern: a focusable separator that ←/→ resize.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`ai-resize${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Ask AI"
      aria-valuenow={shown}
      aria-valuemin={300}
      aria-valuemax={640}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        aiDock.set({ width: clampWidth(shown + (e.key === "ArrowLeft" ? 24 : -24)) });
      }}
      data-testid="ai-resize"
    />
  );
}

function TurnItem({
  turn,
  n,
  current,
  latest,
  canChange,
  onUndo,
  onRevert,
  onSwap,
}: {
  turn: ThreadTurn;
  n: number;
  current: DiagramFile | null;
  latest: boolean;
  canChange: boolean;
  onUndo: () => void;
  onRevert: () => void;
  onSwap: (choice: StencilChoice, stencilId: string) => void;
}) {
  const atThisTurn = !!turn.after && !!current && sameContent(current, turn.after);
  const undone = !!turn.undone && !atThisTurn;
  const mark = () => markElements(turn.changed);
  const unmark = () => markElements([]);
  return (
    <li
      className={`ai-turn${undone ? " is-undone" : ""}`}
      data-testid={`ai-turn-${n}`}
      data-kind={turn.kind}
      onMouseEnter={mark}
      onMouseLeave={unmark}
      onFocus={mark}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) unmark();
      }}
    >
      {turn.request && <p className={`ai-turn-request${turn.kind === "revert" ? " is-system" : ""}`}>{turn.request}</p>}
      {turn.scope && turn.scope.length > 0 && (
        <p className="ai-turn-scope">About {turn.scope.map((i) => i.label).join(", ")}</p>
      )}
      <div className="ai-turn-card">
        {turn.reply && <p className="ai-turn-reply">{turn.reply}</p>}
        {turn.summary && (
          <p className="ai-turn-summary" data-testid={`ai-turn-${n}-summary`}>
            <Icon name="check" size={13} /> {turn.summary}
            {undone && (
              <span className="ai-turn-tag" data-testid={`ai-turn-${n}-undone`}>
                Undone
              </span>
            )}
          </p>
        )}
        {turn.warnings && turn.warnings.length > 0 && (
          <ul className="ai-turn-warnings">
            {turn.warnings.slice(0, 3).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {turn.choices?.map((c) => (
          <ChoiceRow
            key={c.nodeId}
            choice={c}
            stale={!current || !canChange || !choiceIsCurrent(current, c)}
            onSwap={(id) => onSwap(c, id)}
          />
        ))}
        {canChange && turn.after && (latest || !atThisTurn) && (
          <div className="ai-turn-actions">
            {latest && (
              <button className="btn btn-ghost" onClick={onUndo} data-testid={`ai-turn-${n}-undo`}>
                <Icon name="undo" size={13} /> Undo this change
              </button>
            )}
            {!atThisTurn && (
              <button
                className="btn btn-ghost"
                onClick={onRevert}
                title="Restore the diagram as it was after this change (one undo step)"
                data-testid={`ai-turn-${n}-revert`}
              >
                <Icon name="reset" size={13} /> Revert to here
              </button>
            )}
          </div>
        )}
      </div>
    </li>
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

function ChoiceRow({
  choice,
  stale,
  onSwap,
}: {
  choice: StencilChoice;
  stale: boolean;
  onSwap: (stencilId: string) => void;
}) {
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
      {stale && (
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
                  stale ? "This node changed or was removed. Ask for a new turn." : `Use ${alt.label} (${alt.vendor})`
                }
                aria-label={`Use ${alt.label}`}
                data-testid={`ai-swap-${choice.nodeId}-${id}`}
                data-node={choice.nodeId}
                data-stencil={id}
                disabled={stale}
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
        <span className="ai-hint">Your AI corrects its reply; paste it back below.</span>
      </div>
    </section>
  );
}
