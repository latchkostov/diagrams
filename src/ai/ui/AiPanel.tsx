import { t, msg, useLocale } from "../../i18n";
import { stencilLabel } from "../../i18n/stencils";
import { isolateKeys, legacyKeyHint } from "../../editor/keyHints";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { notify } from "../../interop/ui/toast";
import { paletteHost } from "../../palette/host";
import { getStencil } from "../../stencils/registry";
import { canUseAiHistory, canUseOnDevice, privacyOf } from "../../lib/localOnly";
import { AI_TOOLS, ON_DEVICE } from "../../lib/deployment";
import { choiceIsCurrent, diffDiagrams, summarize, swapStencil, type StencilChoice } from "./apply";
import { dismissAppliedToast, markElements, showApplied } from "./feedback";
import { aiDock, clampWidth, collapseDock, useAiDock } from "./dock";
import { sameContent, turnId, type ThreadTurn } from "./thread";
import { threads, useThread } from "./threadStore";
import type { TurnRecord } from "./commitTurn";
import { Advanced } from "./Advanced";
import { readAdvancedOpen } from "./advancedPref";
import { ChoiceRow, OnDevicePreference } from "./parts";
import { resolveScope } from "./context";
import { AgentStatus, HowTo } from "./HowTo";
import type { PanelRequest } from "./AiMount";
import { useModelAvailability } from "../ondevice/useModelAvailability";
import { readOnDevice, rememberOnDevice } from "../ondevice/onDevicePref";
import "./ai.css";

// The AI panel: a docked column beside the canvas where you see and control what AI did to this
// diagram. Browser agents change the diagram through the page's WebMCP tools; each change is a turn
// here with Undo this change, Revert to here and a highlight of what it touched. The manual
// copy-and-paste flow lives in Advanced, closed by default.

// Chrome's built-in model: its request box loads only where the Prompt API is and it's turned on.
// A copy deployed without it (src/lib/deployment.ts) has neither the box nor its chunk.
const OnDeviceInput = ON_DEVICE ? lazy(() => import("../ondevice/OnDeviceInput")) : null;

const editorNow = (): EditorApi | null => paletteHost.get().canvas?.editor ?? null;

let mergeSeq = 0;
const FRESH_MS = 5000;
/** How long the canvas settles before the panel re-reads it. */
const SNAP_MS = 200;

/** Does this browser offer the page's tools to its AI assistant (WebMCP)? */
const hasModelContext = () =>
  typeof document !== "undefined" && ("modelContext" in document || "modelContext" in navigator);

export default function AiPanel({ request: opened }: { request: PanelRequest | null }) {
  useLocale();
  const host = useSyncExternalStore(paletteHost.subscribe, paletteHost.get);
  const canvas = host.canvas;
  const editor = canvas?.editor ?? null;
  const documentId = canvas?.documentId;
  // One privacy decision (src/lib/localOnly.ts): a built-in local-only example, or a Private diagram.
  const privacy = privacyOf(canvas);
  const localOnly = privacy !== null;
  const privateDiagram = privacy === "private";
  /** A private diagram may use the on-device model once the person allows it (a local-only one never). */
  const onDeviceAllowed = canUseOnDevice(canvas);
  /** Undo this change, Revert to here and stencil choices on turns already made (whichever AI made them). */
  const historyAllowed = canUseAiHistory(canvas);
  const titleId = useId();
  const turns = useThread(documentId);
  const historyEnd = useRef<HTMLLIElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [mcp] = useState(() => AI_TOOLS && hasModelContext());
  const live = !!canvas?.live;
  // The on-device model: offered (in Advanced) where Chrome has it; its box shows once turned on.
  const [model, setModel] = useModelAvailability();
  const [onDeviceOn, setOnDeviceOn] = useState(readOnDevice);
  const offerOnDevice = ON_DEVICE && !!model && model !== "unavailable";
  // A private diagram shows the box only once its on-device model is allowed (the note has the switch).
  const onDevice = offerOnDevice && onDeviceOn && (!privateDiagram || onDeviceAllowed);
  /** The box is there to type in (not still waiting for its download). */
  const typeHere = onDevice && model === "available";
  const toggleOnDevice = (on: boolean) => {
    setOnDeviceOn(on);
    rememberOnDevice(on);
  };
  // With a conversation, the how-to folds to one link.
  const [showHowTo, setShowHowTo] = useState(false);

  // The diagram as it is now and the step Undo would reverse, read once the canvas settles (the host
  // republishes on every drag frame and selection), and at once after the panel's own changes.
  const readSnap = useCallback(() => {
    const ed = editorNow();
    return ed ? { diagram: ed.getDiagram(), undoTarget: ed.undoTarget(), selection: ed.getSelection() } : null;
  }, []);
  const [snap, setSnap] = useState(readSnap);
  const refresh = useCallback(() => setSnap(readSnap()), [readSnap]);
  useEffect(() => {
    const t = setTimeout(refresh, SNAP_MS);
    return () => clearTimeout(t);
  }, [editor, host, turns, refresh]);
  const current: DiagramFile | null = snap?.diagram ?? null;
  // The selection the on-device box names, from the settled snapshot (never per drag frame).
  const selection = snap?.selection;
  const scope = useMemo(
    () =>
      current && selection
        ? resolveScope(current, [...selection.nodeIds, ...selection.edgeIds, ...selection.groupIds])
        : [],
    [current, selection],
  );

  // Each open request (the rail, Ctrl+I, a menu) brings the keyboard here; Build with AI
  // opens Advanced, ready to describe the diagram. A request made just now still counts when this panel
  // mounts after it (Build with AI opens a new diagram first); an old one is only why the dock is open.
  const [fresh] = useState(() => !!opened && Date.now() - opened.at < FRESH_MS);
  const [advancedOpen, setAdvancedOpen] = useState(() => readAdvancedOpen() || (fresh && !!opened?.advanced));
  const [focusSeq, setFocusSeq] = useState<number | undefined>(() =>
    fresh && opened?.advanced ? opened.seq : undefined,
  );
  /** The how-to's "Open Advanced": open it and put the keyboard in its request box. */
  const openAdvanced = () => {
    setAdvancedOpen(true);
    setFocusSeq((n) => (n ?? 0) - 1);
  };
  const [seenRequest, setSeenRequest] = useState(opened?.seq);
  if (opened && opened.seq !== seenRequest) {
    setSeenRequest(opened.seq);
    if (opened.advanced) {
      setAdvancedOpen(true);
      setFocusSeq(opened.seq);
    }
  }
  const focusedFor = useRef(fresh ? undefined : opened?.seq);
  useEffect(() => {
    if (!opened || focusedFor.current === opened.seq) return;
    focusedFor.current = opened.seq;
    if (!opened.advanced) panelRef.current?.focus({ preventScroll: true });
  }, [opened]);

  // Opening, the turns take over the Undo of a toast for an agent change made while folded. Leaving
  // (the panel unmounts with a diagram switch) clears any highlight.
  useEffect(() => {
    dismissAppliedToast();
    return () => markElements([]);
  }, []);

  useEffect(() => {
    historyEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);

  const addTurn = useCallback(
    (turn: TurnRecord) => {
      if (documentId) threads.append(documentId, turn);
      refresh();
    },
    [documentId, refresh],
  );
  const setTurns = (fn: (t: ThreadTurn[]) => ThreadTurn[]) => {
    if (documentId) threads.update(documentId, fn);
  };

  const swap = (turn: ThreadTurn, choice: StencilChoice, stencilId: string) => {
    const ed = editorNow();
    if (!ed || !historyAllowed || !choiceIsCurrent(ed.getDiagram(), choice))
      return notify(t("ai.thisStencilChoiceIsStaleItsNode"), { kind: "error" });
    const plan = swapStencil(ed.getDiagram(), choice.nodeId, stencilId, choice.node);
    if (!plan.ok) return notify(plan.error.error, { kind: "error" });
    ed.applyDiagram(plan.next, { merge: `ai:swap:${++mergeSeq}` });
    const s = getStencil(stencilId);
    const label = ed.getNode(choice.nodeId)?.label || choice.nodeId;
    // The swap is its own undo step, which no turn offers: the toast keeps its Undo.
    showApplied(t("ai.stencilChanged", { label, stencil: stencilLabel(s) }), [choice.nodeId], ed, {
      turnUndo: false,
      reveal: true,
    });
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
    refresh();
  };

  /**
   * Undo this change: offered only while the turn's own history step is the one Undo would reverse, so
   * it never undoes something else (a move made since, say).
   */
  const undoTurn = (turn: ThreadTurn) => {
    const ed = editorNow();
    if (!ed || !turn.historyKey || ed.undoTarget() !== turn.historyKey) {
      refresh();
      return notify(t("ai.somethingChangedSinceThisTurnUseRevert"), { kind: "error" });
    }
    ed.undo();
    setTurns((all) => all.map((t) => (t.id === turn.id ? { ...t, undone: true } : t)));
    refresh();
  };

  /** Revert to here: the diagram as it was after this turn, as one undo step (and a turn of its own). */
  const revertTo = (turn: ThreadTurn) => {
    const ed = editorNow();
    if (!ed || !turn.after || !historyAllowed) return;
    const before = ed.getDiagram();
    const historyKey = `ai:${turnId()}`;
    try {
      ed.applyDiagram(turn.after, { merge: historyKey });
    } catch (err) {
      return notify(t("ai.revertFailed", { error: err instanceof Error ? err.message : String(err) }), {
        kind: "error",
      });
    }
    const after = ed.getDiagram();
    const diff = diffDiagrams(before, after);
    const label = turn.revertLabel ?? (turn.request || turn.reply || turn.summary || "");
    addTurn({
      kind: "revert",
      request: "",
      revertLabel: label.length > 60 ? `${label.slice(0, 60)}…` : label,
      summary: summarize(diff),
      changed: diff.changed,
      after,
      historyKey,
    });
  };

  const clearConversation = () => {
    if (!documentId) return;
    const previous = turns;
    threads.set(documentId, []);
    markElements([]);
    notify(t("ai.conversationCleared"), {
      action: {
        label: t("ai.undo"),
        run: () => threads.update(documentId, (t) => (t.length ? t : previous)),
        testId: "ai-clear-undo",
      },
    });
  };

  // Esc hands the keyboard back to the canvas (Advanced's dictation stops first, in its own handler).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229 || e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
    };
    panel.addEventListener("keydown", onKey);
    return () => panel.removeEventListener("keydown", onKey);
  }, []);

  // Per turn: is the diagram as this turn left it (content, not positions)? Recomputed only when the
  // diagram or the thread changes; content keys are cached per diagram object.
  const atTurn = useMemo(
    () => new Map(turns.map((t) => [t.id, !!t.after && !!current && sameContent(current, t.after)])),
    [turns, current],
  );
  const undoTarget = snap?.undoTarget;

  return (
    <section
      ref={panelRef}
      className="ai-panel"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="ai-panel"
      data-editor-overlay
    >
      <ResizeHandle />
      <header className="ai-head">
        <span className="ai-head-icon" aria-hidden>
          <Icon name="ai" size={15} />
        </span>
        <div className="ai-head-titles">
          <h2 id={titleId}>{t("ai.aI")}</h2>
          <p>{t("ai.whatAIAgentsChangedInThisDiagram")}</p>
        </div>
        {turns.length > 0 && (
          <button
            className="icon-btn icon-btn-quiet"
            onClick={clearConversation}
            aria-label={t("ai.clearConversation")}
            title={t("ai.clearConversation")}
            data-testid="ai-clear"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
        <button
          className="icon-btn icon-btn-quiet"
          onClick={collapseDock}
          aria-label={t("ai.hideTheAIPanel")}
          title={t("ai.hideKeys", { keys: isolateKeys(legacyKeyHint("Mod+I")) })}
          data-testid="ai-collapse"
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </header>

      <div className="ai-body">
        {privacy === "local-only" && (
          <p className="ai-note" role="status" data-testid="ai-privacy-note">
            {t("ai.localOnlyNotice")}
          </p>
        )}
        {privateDiagram && (
          <div className="ai-note ai-private-note" role="status" data-testid="ai-privacy-note">
            <p className="ai-private-title">
              <Icon name="lock" size={13} /> {t("ai.privateOff")}
            </p>
            {AI_TOOLS && <p>{t("ai.agentsCopyForAIAndCopiedPrompts")}</p>}
            {offerOnDevice && (
              <label className="ai-ondevice-pref" data-testid="ai-private-ondevice">
                <input
                  type="checkbox"
                  checked={onDeviceAllowed}
                  onChange={(e) => canvas?.allowOnDevice?.(e.target.checked)}
                  data-testid="ai-private-ondevice-toggle"
                />
                <span>{t("ai.allowTheOnDeviceModelStaysOn")}</span>
              </label>
            )}
          </div>
        )}
        {turns.length > 0 ? (
          <ol className="ai-history" aria-label={t("ai.conversation")} data-testid="ai-history">
            {turns.map((t, n) => (
              <TurnItem
                key={t.id}
                turn={t}
                n={n}
                current={current}
                atThisTurn={atTurn.get(t.id) ?? false}
                canUndo={!!t.historyKey && t.historyKey === undoTarget}
                canChange={!!editor && historyAllowed}
                onUndo={() => undoTurn(t)}
                onRevert={() => revertTo(t)}
                onSwap={(c, id) => swap(t, c, id)}
              />
            ))}
            <li ref={historyEnd} aria-hidden className="ai-history-end" />
          </ol>
        ) : privateDiagram ? null : (
          <div className="ai-empty" data-testid="ai-empty">
            <h3>{localOnly ? t("ai.aIIsOffForThisDiagram") : t("ai.changeThisDiagramWithAI")}</h3>
            {!localOnly && AI_TOOLS && <p>{typeHere ? t("ai.emptyType") : t("ai.emptyAgent")}</p>}
            {/* A copy deployed without AI tools (src/lib/deployment.ts): only Chrome's built-in model, here. */}
            {!localOnly && !AI_TOOLS && (
              <p data-testid="ai-tools-off">
                {onDevice
                  ? t("ai.emptyDevice")
                  : offerOnDevice
                    ? t("ai.emptyDeviceOff")
                    : t("ai.emptyDeviceUnavailable")}
              </p>
            )}
          </div>
        )}
        {AI_TOOLS && !localOnly && turns.length === 0 && (
          <HowTo mcp={mcp} live={live} current={current} onOpenAdvanced={openAdvanced} />
        )}
        {AI_TOOLS && !localOnly && turns.length > 0 && (
          <div className="ai-howto-fold">
            <button
              className="ai-howto-link"
              onClick={() => setShowHowTo((v) => !v)}
              aria-expanded={showHowTo}
              data-testid="ai-howto-link"
            >
              <Icon name={showHowTo ? "chevron-down" : "info"} size={13} />
              {t("ai.howToUseAIHere")}
            </button>
            {showHowTo && <HowTo mcp={mcp} live={live} current={current} onOpenAdvanced={openAdvanced} />}
          </div>
        )}
      </div>

      {/* The foot (the on-device box, the status line and Advanced) never takes more than its share of the panel,
          so the conversation above it stays readable; past that share, the foot scrolls. */}
      <div className="ai-foot" data-testid="ai-foot">
        {onDevice && OnDeviceInput && (
          <Suspense fallback={null}>
            <OnDeviceInput
              availability={model}
              onAvailability={setModel}
              documentId={documentId}
              live={live}
              localOnly={!onDeviceAllowed}
              privateDiagram={privateDiagram}
              scope={scope}
              onTurn={addTurn}
            />
          </Suspense>
        )}

        {/* Without AI tools there's no Advanced, which otherwise holds this switch: it stays here instead. */}
        {!AI_TOOLS && offerOnDevice && <OnDevicePreference on={onDeviceOn} set={toggleOnDevice} />}

        {/* The agents' status and Advanced's copied prompts are AI outside the app: only with AI tools. */}
        {AI_TOOLS && (
          <>
            <AgentStatus
              available={mcp}
              localOnly={localOnly}
              privateDiagram={privateDiagram}
              live={live}
              typeHere={typeHere}
            />

            <Advanced
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              focusSeq={focusSeq}
              current={current}
              live={live}
              onTurn={addTurn}
              onDevice={offerOnDevice ? { on: onDeviceOn, set: toggleOnDevice } : undefined}
              privateDiagram={privateDiagram}
            />
          </>
        )}
      </div>
    </section>
  );
}

/** A turn's name in words: the agent's note or the request, else what changed. */
function turnTitle(turn: ThreadTurn): string {
  if (turn.kind === "revert" && turn.revertLabel !== undefined)
    return t("ai.reverted", { label: turn.revertLabel || t("ai.thisChange") });
  return turn.request || turn.reply || turn.summary || t("ai.thisChange");
}

/** Drag (or ←/→) the dock's left edge; the width is remembered. */
function ResizeHandle() {
  useLocale();
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
    aiDock.set({
      width: clampWidth(
        start.current.w +
          (document.documentElement.dir === "rtl" ? e.clientX - start.current.x : start.current.x - e.clientX),
      ),
    });
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
      aria-label={t("ai.resizeTheAIPanel")}
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
        aiDock.set({
          width: clampWidth(shown + ((e.key === "ArrowLeft") !== (document.documentElement.dir === "rtl") ? 24 : -24)),
        });
      }}
      data-testid="ai-resize"
    />
  );
}

const TOOL_NAMES: Record<string, () => string> = {
  edit_diagram: msg("ai.editedTheDiagram"),
  set_simulation: msg("ai.setASimulation"),
  new_diagram: msg("ai.startedANewDiagram"),
};

function TurnItem({
  turn,
  n,
  current,
  atThisTurn,
  canUndo,
  canChange,
  onUndo,
  onRevert,
  onSwap,
}: {
  turn: ThreadTurn;
  n: number;
  current: DiagramFile | null;
  atThisTurn: boolean;
  canUndo: boolean;
  canChange: boolean;
  onUndo: () => void;
  onRevert: () => void;
  onSwap: (choice: StencilChoice, stencilId: string) => void;
}) {
  useLocale();
  const undone = !!turn.undone && !atThisTurn;
  const agent = turn.engine === "agent";
  const onDevice = turn.engine === "on-device";
  const mark = () => markElements(turn.changed);
  const unmark = () => markElements([]);
  return (
    <li
      className={`ai-turn${undone ? " is-undone" : ""}${agent ? " is-agent" : ""}`}
      data-testid={`ai-turn-${n}`}
      data-kind={turn.kind}
      data-engine={turn.engine}
      onMouseEnter={mark}
      onMouseLeave={unmark}
      onFocus={mark}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) unmark();
      }}
    >
      {(turn.request || turn.kind === "revert") && (
        <p
          className={`ai-turn-request${turn.kind === "revert" ? " is-system" : ""}`}
          data-testid={`ai-turn-${n}-request`}
        >
          {turn.kind === "revert" ? turnTitle(turn) : turn.request}
        </p>
      )}
      <div className="ai-turn-card">
        {onDevice && (
          <p className="ai-turn-who" data-testid={`ai-turn-${n}-who`}>
            <Icon name="ai" size={12} />
            {t("ai.onThisDeviceChromeSBuiltIn")}
          </p>
        )}
        {agent && (
          <p className="ai-turn-who" data-testid={`ai-turn-${n}-who`}>
            <Icon name="ai" size={12} />
            {t("ai.agentChange", { change: TOOL_NAMES[turn.tool ?? ""]?.() ?? t("ai.changedDiagram") })}
          </p>
        )}
        {turn.reply && <p className="ai-turn-reply">{turn.reply}</p>}
        {turn.summary && (
          <p className="ai-turn-summary" data-testid={`ai-turn-${n}-summary`}>
            <Icon name="check" size={13} /> {turn.summary}
            {undone && (
              <span className="ai-turn-tag" data-testid={`ai-turn-${n}-undone`}>
                {t("ai.undone")}
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
        {/* A choice shows only while its node is as this turn left it: after an undo, a revert or an
            edit there's nothing left to swap. */}
        {current &&
          canChange &&
          turn.choices
            ?.filter((c) => choiceIsCurrent(current, c))
            .map((c) => <ChoiceRow key={c.nodeId} choice={c} onSwap={(id) => onSwap(c, id)} />)}
        {/* Undo needs only the turn's history step; Revert to here needs its snapshot (a big diagram's
            isn't kept). */}
        {canChange && (canUndo || (turn.after && !atThisTurn)) && (
          <div className="ai-turn-actions">
            {canUndo && (
              <button className="btn btn-ghost" onClick={onUndo} data-testid={`ai-turn-${n}-undo`}>
                <Icon name="undo" size={13} />
                {t("ai.undoThisChange")}
              </button>
            )}
            {turn.after && !atThisTurn && (
              <button
                className="btn btn-ghost"
                onClick={onRevert}
                title={t("ai.restoreTheDiagramAsItWasAfter")}
                data-testid={`ai-turn-${n}-revert`}
              >
                <Icon name="reset" size={13} />
                {t("ai.revertToHere")}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
