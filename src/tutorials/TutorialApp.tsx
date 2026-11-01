import { surfaceCatalogs } from "../i18n/surfaces";
import { ModeSwitch, HistoryButtons } from "../components/ModeSwitch";
import { Suspense, use, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LazyCanvasView as CanvasView } from "../canvas/loadCanvasView";
import {
  createLibraryDiagram,
  deleteLibraryDiagram,
  duplicateLibraryDiagram,
  renameLibraryDiagram,
  getDiagramIdentity,
  TUTORIAL_SLUG,
  withPrivacyField,
} from "../lib/diagramIO";
import { diagramOpenActions } from "../lib/openDiagram";
import { showDiagram } from "../lib/urlState";
import { Icon } from "../components/Icon";
import { Dialog } from "../interop/ui/Dialog";
import { loadingDialog } from "../interop/ui/lazyDialogs";
import { CommandPalette } from "../palette/CommandPalette";
import { t, useLocale } from "../i18n";
import { tRich } from "../i18n/rich";
import { trackLabel, tracks, tutorials } from "./catalog";
import { lazyComponent, loadOnce } from "../lib/lazyLoad";
import { readTutorials, subscribeTutorials, tutorialsSnapshot } from "./progress";
import { FinishHandoff } from "./FinishHandoff";
import { cancelLessonStart, justEarnedSeals, leaveLesson, takeLessonStart } from "./handoff";
import { seals } from "./seals";
import { createTutorialStart } from "./start";
import { TopBar } from "../components/TopBar";
import { ToolRail } from "../canvas/chrome/ToolRail";
import { useInterop, useInteropCanvasActions } from "../interop/useInterop";
import type { CanvasHandle } from "../canvas/CanvasView";
import type { DiagramFile, Simulation } from "../model/types";
import { paletteHost } from "../palette/host";
import { toast } from "../interop/ui/toast";
import { useLibrary } from "../lib/useLibrary";
import { tutorialMetadata } from "./metadata";
import { CoachCard } from "./CoachCard";
import { isEditableTarget } from "../editor/shortcuts";
import { CoachText, KeyText } from "./KeyText";
import { useCoachHelp } from "./coachHelp";
import { useTutorialLayout } from "./useTutorialLayout";
import { inStep, targetsShown, type RunnerEvent } from "./machine";
import { createTutorialRunner, type RunnerSnapshot } from "./runner";
import { tutorialRoute } from "./route";
import type { Tutorial } from "./types";
import { solutionNow, type ResolvedUiStep } from "./solution";
import { keyboardSolutionNow, type ResolvedKeyboardStep } from "./keyboard";
import { createPracticeImport, createPracticePrivacy, tutorialFilePolicy } from "./filePolicy";
import { beginObservedWork, cancelObservedWork, observationPorts } from "../lib/observations";
import { canUseAiTools, canUseOnDevice } from "../lib/localOnly";
import { currentObservationSource } from "../palette/observationSource";
import "./tutorials.css";

/** Live's address keys belong to the diagram that set them: a tutorial starts in editing, on its own diagram. */
const LIVE_KEYS = ["live", "sim", "speed", "paused", "traffic"];
function startFresh() {
  showDiagram(null);
  const query = new URLSearchParams(window.location.search);
  if (!LIVE_KEYS.some((k) => query.has(k))) return;
  for (const k of LIVE_KEYS) query.delete(k);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}${window.location.hash}`);
}

const noop = () => {};
const NO_DIAGRAMS: never[] = [];

/**
 * A tutorial: a progress bar, an anchored coach, and a canvas on a sandbox diagram of its
 * own (TUTORIAL_SLUG is never stored). Leaving goes back to where it was opened from.
 */
export function TutorialApp({ id }: { id: string }) {
  useLocale();
  const catalog =
    (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") && id.startsWith("lab-tutorial-")
      ? use(loadRuntimeFixtures())(id)
      : tutorials;
  const tutorial = catalog.find((x) => x.id === id && !x.quarantined);
  if (!tutorial) return <Unknown id={id} />;
  return (
    <Suspense
      fallback={
        <div className="view-loading" data-testid="view-loading" role="status">
          {t("tutorials.loading")}
        </div>
      }
    >
      <Prepared key={tutorial.id} tutorial={tutorial} catalog={catalog} />
    </Suspense>
  );
}

const LibraryDialog = lazyComponent(
  () => import("../components/LibraryDialog").then((m) => m.LibraryDialog),
  loadingDialog(() => t("topbar.yourDiagrams")),
);
const ExamplesDialog = lazyComponent(
  () => import("../components/ExamplesDialog").then((m) => m.ExamplesDialog),
  loadingDialog(() => t("topbar.examples")),
);
const loadRuntimeFixtures = loadOnce(() =>
  import("../lab/tutorialRuntimeFixture").then((m) => m.tutorialRuntimeCatalog),
);
function Prepared({ tutorial, catalog }: { tutorial: Tutorial; catalog: readonly Tutorial[] }) {
  const [loader] = useState(() => createTutorialStart(tutorial, undefined, cancelLessonStart));
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  useEffect(() => loader.connect(), [loader]);
  if (state.value === "ready" && state.diagram)
    return <Running tutorial={tutorial} initial={state.diagram} catalog={catalog} />;
  return (
    <div className="view-loading tutorial-loading" data-testid="view-loading" role="status">
      <p>{state.value === "failed" ? t("tutorials.loadFailed") : t("tutorials.loading")}</p>
      {state.value === "failed" && (
        <button className="btn btn-primary" data-testid="tutorial-load-retry" onClick={loader.retry}>
          {t("common.retry")}
        </button>
      )}
      <button className="btn" data-testid="tutorial-exit" onClick={() => leaveLesson(tutorial)}>
        {t("tutorials.exit")}
      </button>
    </div>
  );
}

function Running({
  tutorial,
  initial,
  catalog,
}: {
  tutorial: Tutorial;
  initial: DiagramFile;
  catalog: readonly Tutorial[];
}) {
  useTutorialLayout();
  const [before, setBefore] = useState(readTutorials);
  const raw = useSyncExternalStore(subscribeTutorials, tutorialsSnapshot);
  const progress = readTutorials(raw);
  const [presenting, setPresenting] = useState(false);
  const [temporaryPrivacy] = useState(createPracticePrivacy);
  const practicePrivacy = useSyncExternalStore(temporaryPrivacy.subscribe, temporaryPrivacy.get);
  const [practiceImport] = useState(createPracticeImport);
  useEffect(() => {
    if (!presenting) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresenting(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [presenting]);
  const [runner] = useState(() => {
    startFresh();
    return createTutorialRunner(tutorial, {
      close: () => leaveLesson(tutorial),
      initial,
      documentId: getDiagramIdentity(TUTORIAL_SLUG),
      present: setPresenting,
      importPractice: practiceImport.run,
    });
  });
  const [start] = useState(() => structuredClone(initial));
  const [diagramTitle, setDiagramTitle] = useState(initial.title);
  const [coachAttempt, setCoachAttempt] = useState(0);
  const canvas = useRef<CanvasHandle | null>(null);
  const library = useLibrary();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryUndo, setLibraryUndo] = useState<{ message: string; run: () => void } | null>(null);
  const openCopy = tutorialRoute.openDiagram;
  const { openDiagram, openShared, newDiagram } = useMemo(
    () => diagramOpenActions(TUTORIAL_SLUG, openCopy),
    [openCopy],
  );
  const libraryAction = (action: string, operation: () => void) => {
    setLibraryError(null);
    try {
      operation();
    } catch (error) {
      const message = t("library.failed", {
        action,
        error: error instanceof Error ? error.message : t("library.storageFull"),
      });
      setLibraryError(message);
      toast.error(message);
    }
  };
  const saveCopy = () => {
    const diagram = paletteHost.get().canvas?.editor.getDiagram();
    if (!diagram) return;
    try {
      const slug = filePolicy.saveCopy(withPrivacyField(diagram, temporaryPrivacy.get().private));
      if (!slug) return;
      const source = currentObservationSource();
      if (source) observationPorts.copied.publish({ ...source, slug });
      toast.success(t("tutorials.saved"), {
        action: { label: t("tutorials.openCopy"), run: () => openCopy(slug), testId: "tutorial-open-copy" },
      });
    } catch {
      toast.error(t("tutorials.saveFailed"));
    }
  };
  const [filePolicy] = useState(() =>
    tutorialFilePolicy(tutorial.id, {
      replace: (diagram) => {
        const editor = paletteHost.get().canvas?.editor;
        if (!editor) throw new Error(t("common.tryAgain"));
        temporaryPrivacy.setPrivate(!!diagram.private);
        editor.applyDiagram(diagram);
      },
      copy: createLibraryDiagram,
      cancel: () => {
        const source = currentObservationSource();
        if (source) cancelObservedWork(source);
      },
    }),
  );
  const interop = useInterop({
    view: "canvas",
    slug: TUTORIAL_SLUG,
    canvas,
    openDiagram,
    openShared,
    isPublicExample: () => false,
    temporaryPrivacy,
    importDestination: tutorial.id === "import-and-review" ? filePolicy.import : undefined,
  });
  const sharing = "dialogKind" in interop && interop.dialogKind === "chooser";
  const importFiles = interop.importFiles;
  useEffect(() => {
    return practiceImport.connect(async (runnerSignal) => {
      const work = beginObservedWork(currentObservationSource());
      const signal = AbortSignal.any([runnerSignal, work.signal]);
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}tutorial-status-compose.yaml`, { signal });
        if (!response.ok) throw new Error("Fixture unavailable");
        const text = await response.text();
        signal.throwIfAborted();
        return await importFiles(
          [new File([text], "tutorial-status-compose.yaml", { type: "text/yaml" })],
          undefined,
          signal,
        );
      } finally {
        work.finish();
      }
    });
  }, [importFiles, practiceImport]);
  useEffect(() => runner.appChanged({ presenting, sharing }), [runner, presenting, sharing]);
  // Ownership requires the library lesson's named Save a copy action. File shortcuts never save practice edits.
  const files = {
    ...interop,
    tutorial: true as const,
    save: interop.exportNative,
    saveAs: interop.exportNative,
    saveTo: async () => {},
  };
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void files.save();
    };
    window.addEventListener("keydown", save, true);
    return () => window.removeEventListener("keydown", save, true);
  });
  const canvasRef = useInteropCanvasActions(canvas, files);
  useEffect(() => runner.connect(), [runner]);
  useEffect(() => {
    if (!takeLessonStart(tutorial.id)) return;
    runner.send({ type: "start" });
  }, [runner, tutorial]);
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === "1")) return;
    window.__tutorial = {
      snapshot: runner.getSnapshot,
      journal: runner.journal,
      runs: runner.runs,
      solution: () => solutionNow(tutorial, runner.getSnapshot()),
      keyboardSolution: () => keyboardSolutionNow(tutorial, runner.getSnapshot()),
      diagram: () => paletteHost.get().canvas?.editor.getDiagram(),
      aiAllowed: () => canUseAiTools(paletteHost.get().canvas),
      onDeviceAllowed: () => canUseOnDevice(paletteHost.get().canvas),
      allowOnDevice: (on) => paletteHost.get().canvas?.allowOnDevice?.(on),
    };
    return () => void delete window.__tutorial;
  }, [runner, tutorial]);
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const { state } = snap;

  return (
    <div
      className={`app tutorial-app${tutorial.chrome === "app" && !presenting ? " tutorial-app-chrome" : ""}${presenting ? " is-presenting" : ""}`}
      data-testid="tutorial-app"
      data-tutorial={tutorial.id}
    >
      {tutorial.chrome === "app" && !presenting && (
        <TopBar
          view="canvas"
          diagramTitle={diagramTitle}
          documentId={getDiagramIdentity(TUTORIAL_SLUG)}
          onView={tutorialRoute.openView}
          exampleOptions={[{ slug: TUTORIAL_SLUG, title: tutorial.title(), group: "yours" }]}
          example={TUTORIAL_SLUG}
          onExample={noop}
          onBrowseExamples={() => setExamplesOpen(true)}
          interop={files}
          onPresent={() => setPresenting(true)}
          onNewDiagram={newDiagram}
          onLibrary={() => setLibraryOpen(true)}
          libraryCount={library.entries.length}
        />
      )}
      {!presenting && (
        <header className="topbar tutorial-bar" data-testid="tutorial-bar">
          <span className="tutorial-chip">{t("tutorials.tutorial")}</span>
          <span className="tutorial-name" data-testid="tutorial-title">
            {tutorial.title()}
          </span>
          <Progress tutorial={tutorial} snap={snap} />
          <div className="topbar-spacer" />
          {state.value !== "intro" && (
            <button
              className="btn"
              aria-label={t("tutorials.restart")}
              title={t("tutorials.restart")}
              onClick={() => {
                setBefore(readTutorials());
                setCoachAttempt((attempt) => attempt + 1);
                runner.send({ type: "restart" });
                interop.resetImports();
                temporaryPrivacy.reset();
              }}
              data-testid="tutorial-restart"
            >
              <Icon name="reset" size={14} /> <span className="tutorial-action-label">{t("tutorials.restart")}</span>
            </button>
          )}
          <button
            className="btn"
            aria-label={t("tutorials.exit")}
            title={t("tutorials.exit")}
            onClick={() => runner.send({ type: "exit" })}
            data-testid="tutorial-exit"
          >
            <Icon name="close" size={14} /> <span className="tutorial-action-label">{t("tutorials.exit")}</span>
          </button>
        </header>
      )}
      <div hidden={presenting} style={presenting ? undefined : { display: "contents" }}>
        {state.value !== "intro" && state.value !== "closed" && (
          <LessonCoach
            key={`${coachAttempt}:${state.index}`}
            tutorial={tutorial}
            snap={snap}
            send={runner.send}
            saveCopy={saveCopy}
          />
        )}
      </div>
      {!presenting && tutorial.chrome !== "app" && (
        <div
          className="tutorial-tools"
          data-testid="tutorial-tools"
          role="group"
          aria-label={t("shortcuts.group.edit")}
        >
          <span className="sr-only" data-testid="diagram-title">
            {diagramTitle}
          </span>
          <HistoryButtons />
          <ModeSwitch />
        </div>
      )}
      <div className="app-body">
        {!presenting && <ToolRail view="canvas" onView={tutorialRoute.openView} />}
        <div className="app-main tutorial-practice">
          {state.value === "finished" && !presenting && !libraryOpen && (
            <FinishHandoff tutorial={tutorial} catalog={catalog} before={before} progress={progress} />
          )}
          <Suspense fallback={<div className="view-loading" data-testid="view-loading" />}>
            <CanvasView
              bezel
              temporaryPrivacy={practicePrivacy}
              onAllowOnDevice={temporaryPrivacy.setOnDevice}
              onTitleChange={setDiagramTitle}
              ref={canvasRef}
              slug={TUTORIAL_SLUG}
              initial={start}
              presenting={presenting}
              onExitPresent={() => setPresenting(false)}
              onTutorials={() => tutorialRoute.openView("tutorials")}
            />
          </Suspense>
        </div>
      </div>
      {state.value === "intro" && (
        <Intro tutorial={tutorial} snap={snap} send={runner.send} onCancel={() => tutorialRoute.close()} />
      )}
      {/* Ctrl+K works here as on any canvas: actions, nodes, stencils. There are no other diagrams to open. */}
      <CommandPalette
        view="canvas"
        diagrams={NO_DIAGRAMS}
        currentSlug={TUTORIAL_SLUG}
        onOpenDiagram={noop}
        onPresent={tutorial.chrome === "app" && !presenting ? () => setPresenting(true) : undefined}
        tutorials={tutorialMetadata.map((x) => ({ id: x.id, title: x.title() }))}
        onOpenTutorial={tutorialRoute.open}
        onTutorials={() => tutorialRoute.openView("tutorials")}
      />
      {interop.layer}
      {examplesOpen && <ExamplesDialog onClose={() => setExamplesOpen(false)} onOpen={tutorialRoute.openDiagram} />}
      {libraryOpen && (
        <LibraryDialog
          entries={library.entries}
          current={TUTORIAL_SLUG}
          error={libraryError}
          undo={libraryUndo}
          onClose={() => setLibraryOpen(false)}
          onOpen={openCopy}
          onNew={newDiagram}
          onRename={(slug, title) => libraryAction("rename", () => renameLibraryDiagram(slug, title))}
          onDuplicate={(slug) => {
            libraryAction("duplicate", () => {
              duplicateLibraryDiagram(slug);
            });
          }}
          onDelete={(slug) => {
            libraryAction("delete", () => {
              const undo = deleteLibraryDiagram(slug);
              const message = t("library.deleted", {
                title: library.entries.find((e) => e.slug === slug)?.title ?? "",
              });
              const restore = () =>
                libraryAction("restore", () => {
                  if (!undo()) throw new Error(t("library.restoreFull"));
                  setLibraryUndo(null);
                });
              setLibraryUndo({ message, run: restore });
              toast.info(message, {
                action: { label: t("shortcuts.undo"), run: restore, testId: "delete-undo" },
              });
            });
          }}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite" data-testid="tutorial-announce">
        {snap.announcement}
        {state.value === "finished" &&
          seals
            .filter((seal) => justEarnedSeals(before, progress, catalog).includes(seal.id))
            .map((seal) =>
              t("tutorials.handoff.sealEarned", {
                name: seal.track
                  ? tracks.find((track) => track.id === seal.track)!.label()
                  : t("tutorials.syllabus.whole"),
              }),
            )
            .join(". ")}
      </div>
    </div>
  );
}

/**
 * The intro: one focused card with one primary action. It's a dialog, so its Start takes the keyboard as a dialog's
 * first action does (Enter starts) and Esc or "Not now" leaves the tutorial.
 */
function Intro({
  tutorial,
  snap,
  send,
  onCancel,
}: {
  tutorial: Tutorial;
  snap: RunnerSnapshot;
  send: (e: RunnerEvent) => void;
  onCancel(): void;
}) {
  const { resumeAt } = snap.state;
  return (
    <Dialog
      title={tutorial.title()}
      subtitle={`${t("tutorials.meta", { track: trackLabel(tutorial.track), minutes: tutorial.minutes })} · ${t("tutorials.sandbox")}`}
      onClose={onCancel}
      testId="tutorial-intro"
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} data-testid="tutorial-not-now">
            {t("tutorials.notNow")}
          </button>
          {resumeAt > 0 && (
            <button className="btn" onClick={() => send({ type: "start" })} data-testid="tutorial-start-over">
              {t("tutorials.startOver")}
            </button>
          )}
          <button
            className="btn btn-primary tutorial-start"
            data-autofocus
            onClick={() => send({ type: resumeAt > 0 ? "resume" : "start" })}
            data-testid="tutorial-start"
          >
            {resumeAt > 0 ? t("tutorials.resume", { step: resumeAt + 1 }) : t("tutorials.start")}
          </button>
        </>
      }
    >
      <p className="tutorial-intro-summary">{tutorial.summary()}</p>
      <h3 className="tutorial-intro-head">{t("tutorials.youWill")}</h3>
      <ol className="tutorial-intro-steps">
        {tutorial.steps.map((s, i) => (
          <li key={s.id} className={i < resumeAt ? "is-done" : undefined}>
            {s.title()}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

function Progress({ tutorial, snap }: { tutorial: Tutorial; snap: RunnerSnapshot }) {
  const { state } = snap;
  const finished = state.value === "finished";
  const current = finished ? tutorial.steps.length : state.index;
  return (
    <div className="tutorial-progress">
      <ol className="tutorial-dots" aria-label={t("tutorials.steps")}>
        {tutorial.steps.map((s, i) => {
          const done = finished || state.latched[i] || (state.observed[i] && state.settled[i]);
          const here = inStep(state) && i === state.index;
          return (
            <li
              key={s.id}
              className={`${done ? "is-done" : ""}${here ? " is-current" : ""}`}
              data-testid={`tutorial-dot-${s.id}`}
              aria-current={here ? "step" : undefined}
              title={s.title()}
            >
              <span className="sr-only">{done ? t("tutorials.stepDone", { title: s.title() }) : s.title()}</span>
            </li>
          );
        })}
      </ol>
      {state.value !== "intro" && (
        <span className="tutorial-count" data-testid="tutorial-progress">
          {finished
            ? t("tutorials.finished")
            : t("tutorials.stepOf", { step: current + 1, total: tutorial.steps.length })}
        </span>
      )}
    </div>
  );
}

/**
 * The step strip: the instruction first, in bold; under it, smaller, the hint once asked for, or what was just done.
 * Three lines high whatever it says, so the canvas never jumps.
 */
/** Display-only help and routes never participate in a completion check or demo. */
function LessonCoach({
  tutorial,
  snap,
  send,
  saveCopy,
}: {
  tutorial: Tutorial;
  snap: RunnerSnapshot;
  send(e: RunnerEvent): void;
  saveCopy(): void;
}) {
  const step = tutorial.steps[snap.state.index];
  const waiting = snap.state.value === "active" || snap.state.value === "hinting";
  const help = useCoachHelp(waiting);
  const routes = step?.coach?.routes;
  return (
    <CoachCard
      targets={routes?.[help.state.route]?.targets ?? step?.targets ?? []}
      subjects={snap.subjects}
      edges={snap.edges}
      selected={snap.selected}
      anchored={inStep(snap.state) && (!tutorial.study || snap.state.value === "hinting")}
      ring={targetsShown(snap.state, !!tutorial.study)}
      collapsed={help.state.folded}
      complete={snap.state.value === "finished"}
      onProgress={help.progress}
    >
      {(now) => (
        <CoachInstructions
          tutorial={tutorial}
          snap={snap}
          send={send}
          saveCopy={saveCopy}
          card={{
            folded: help.state.folded,
            onFold: () => help.send({ type: "fold" }),
            route: help.state.route,
            onRoute: (route) => help.send({ type: "route", route }),
            now,
            hint: help.state.hint,
            onHint: () => help.send({ type: "hint" }),
            nudged: waiting && help.state.value === "nudged",
          }}
        />
      )}
    </CoachCard>
  );
}

function CoachInstructions({
  tutorial,
  snap,
  send,
  saveCopy,
  card,
}: {
  tutorial: Tutorial;
  snap: RunnerSnapshot;
  send: (e: RunnerEvent) => void;
  saveCopy(): void;
  /** Coach: the strip's content as an anchored card, with a head (step count, title) that folds the rest. */
  card: {
    folded: boolean;
    onFold(): void;
    /** The chosen way to do the step (step.coach.routes), and the next move on it (its pointed target's tip). */
    route: number;
    onRoute(index: number): void;
    now: string | null;
    /** The first rung of help: the hint, shown in the card without forcing the ring. */
    hint: boolean;
    onHint(): void;
    /** No progress for a while: the help rungs say they're there. */
    nudged: boolean;
  };
}) {
  const { state } = snap;
  const phase = state.value;
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase !== "failed" || isEditableTarget(document.activeElement)) return;
    const frame = requestAnimationFrame(() => retry.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  const step = inStep(state) || phase === "failed" ? tutorial.steps[state.index] : undefined;
  const last = state.last !== null ? tutorial.steps[state.last] : undefined;
  return (
    <section
      className="tutorial-strip coach-strip"
      aria-label={t("tutorials.tutorial")}
      data-testid="tutorial-step"
      data-phase={inStep(state) ? "step" : phase}
      data-state={phase}
      data-step={step?.id ?? ""}
    >
      {(step || phase === "finished") && (
        <div className="coach-head">
          <span className="coach-count" aria-hidden="true">
            {phase === "finished"
              ? `${tutorial.steps.length}/${tutorial.steps.length}`
              : `${state.index + 1}/${tutorial.steps.length}`}
          </span>
          <span className="coach-title" data-testid="coach-title">
            <KeyText text={step ? step.title() : t("tutorials.finished")} />
          </span>
          {step && (
            <label className="coach-highlights" title={t("tutorials.highlightsTitle")}>
              <input
                type="checkbox"
                checked={state.highlights}
                onChange={(e) => send({ type: "highlights", on: e.target.checked })}
                data-testid="tutorial-highlights"
                aria-label={t("tutorials.highlights")}
              />
            </label>
          )}
          {step && (
            <button
              className="icon-btn icon-btn-quiet coach-fold"
              aria-expanded={!card.folded}
              aria-label={card.folded ? t("tutorials.coach.show") : t("tutorials.coach.hide")}
              title={card.folded ? t("tutorials.coach.show") : t("tutorials.coach.hide")}
              onClick={card.onFold}
              data-testid="coach-fold"
            >
              <Icon name="chevron-down" size={14} />
            </button>
          )}
        </div>
      )}
      {step && (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native scroll keys must stay in the instruction region, away from canvas shortcuts. */}
          <div
            className="tutorial-words"
            role="region"
            aria-label={t("tutorials.steps")}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Overflowing instructions need a keyboard scroll target.
            tabIndex={0}
            data-testid="tutorial-words"
            onKeyDown={(event) => {
              if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
                event.stopPropagation();
            }}
          >
            <p className="tutorial-goal" data-testid="tutorial-goal">
              <CardGoal step={step} card={card} />
            </p>
            <span className="tutorial-target-hint" data-testid="tutorial-target-hint" />
            {phase === "failed" ? (
              <p className="tutorial-near-miss" role="status" data-testid="tutorial-recovery">
                {t("tutorials.demoFailed")}
              </p>
            ) : snap.nearMiss && phase !== "completing" ? (
              <p className="tutorial-near-miss" data-testid="tutorial-near-miss" role="status">
                {tRich("tutorials.nearMiss", {
                  b: (chunks) => <strong>{chunks}</strong>,
                  expected: snap.nearMiss.expected,
                  typed: snap.nearMiss.typed,
                })}{" "}
                <button className="link-btn" onClick={() => send({ type: "fix" })} data-testid="tutorial-use-expected">
                  {t("tutorials.useExpected", { expected: snap.nearMiss.expected })}
                </button>
              </p>
            ) : phase === "completing" ? (
              <p className="tutorial-done" data-testid="tutorial-completing">
                <Icon name="check" size={13} />
                {step.done && <KeyText text={step.done()} />}{" "}
                <KeyText
                  text={
                    typeof step.settle === "object"
                      ? step.settle.tip()
                      : step.settle === "annotation"
                        ? t("tutorials.finishAnnotation")
                        : t("tutorials.finishUp")
                  }
                />
              </p>
            ) : phase === "hinting" || card.hint ? (
              <p className="tutorial-aside" id="tutorial-hint" data-testid="tutorial-hint">
                <KeyText
                  text={
                    step.hint?.() ??
                    (otherRoute(step, card.route)
                      ? t("tutorials.coach.noHint", { route: otherRoute(step, card.route)!.summary() })
                      : t("tutorials.coach.hintFallback"))
                  }
                />
              </p>
            ) : (
              last?.done && (
                <p className="tutorial-done" data-testid="tutorial-done">
                  <Icon name="check" size={13} />
                  <KeyText text={last.done()} />
                </p>
              )
            )}
          </div>
          <CardRoutes step={step} card={card} />
          {step.check.kind !== "acknowledge" && (phase === "active" || phase === "hinting") ? (
            <CardHelp step={step} phase={phase} send={send} card={card}>
              {tutorial.id === "import-and-review" && step.id === "import" && (
                <a
                  className="btn"
                  data-testid="tutorial-fixture"
                  href={`${import.meta.env.BASE_URL}tutorial-status-compose.yaml`}
                  download
                >
                  {t("tutorials.importAndReview.download")}
                </a>
              )}
              {tutorial.id === "library-reuse" && step.check.kind === "ownedCopy" && (
                <button className="btn" data-testid="tutorial-save-copy" onClick={saveCopy}>
                  {t("tutorials.saveCopy")}
                </button>
              )}
            </CardHelp>
          ) : (
            <div className="tutorial-actions" key={step.id}>
              {tutorial.id === "library-reuse" && step.check.kind === "ownedCopy" && (
                <button className="btn" data-testid="tutorial-save-copy" onClick={saveCopy}>
                  {t("tutorials.saveCopy")}
                </button>
              )}
              {tutorial.id === "import-and-review" && step.id === "import" && (
                <a
                  className="btn"
                  data-testid="tutorial-fixture"
                  href={`${import.meta.env.BASE_URL}tutorial-status-compose.yaml`}
                  download
                >
                  {t("tutorials.importAndReview.download")}
                </a>
              )}
              {(phase === "active" || phase === "hinting") && (
                <button
                  className="btn"
                  onClick={() => send({ type: "showMe" })}
                  data-testid="tutorial-show-me"
                  aria-expanded={phase === "hinting"}
                  aria-controls={phase === "hinting" && step.hint ? "tutorial-hint" : undefined}
                >
                  {t("tutorials.showMe")}
                </button>
              )}
              {phase === "failed" ? (
                <button
                  className="btn"
                  ref={retry}
                  data-testid="tutorial-retry"
                  onClick={() => send({ type: "retry" })}
                >
                  {t("common.retry")}
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={(e) => {
                    if (e.detail < 2) send({ type: "skip", stepId: step.id });
                  }}
                  title={step.check.kind === "acknowledge" ? t("tutorials.done") : t("tutorials.skipTitle")}
                  data-testid="tutorial-skip"
                >
                  {step.check.kind === "acknowledge" ? t("tutorials.done") : t("tutorials.skip")}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {phase === "finished" && (
        <>
          <div className="tutorial-words">
            <p className="tutorial-goal" data-testid="tutorial-finished">
              <strong>{t("tutorials.finished")}.</strong>
            </p>
          </div>
          <div className="tutorial-actions">
            {tutorial.id === "library-reuse" && (
              <button className="btn" data-testid="tutorial-save-copy" onClick={saveCopy}>
                {t("tutorials.saveCopy")}
              </button>
            )}
            {tutorial.finish.example && (
              <button
                className="btn"
                onClick={() => tutorialRoute.openDiagram(tutorial.finish.example!.slug)}
                data-testid="tutorial-example"
              >
                {tutorial.finish.example.label()}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type CardProps = Parameters<typeof CoachInstructions>[0]["card"];
type Step = Tutorial["steps"][number];
const otherRoute = (step: Step, route: number) => step.coach?.routes.find((_, i) => i !== route);

/** Keep the lesson objective beside the chosen route's next move; use its summary when no target is available. */
function CardGoal({ step, card }: { step: Step; card: CardProps }) {
  const routes = step.coach?.routes;
  if (!routes) return <CoachText title={step.title()} goal={step.goal()} tip={card.now} />;
  const chosen = routes[card.route] ?? routes[0];
  return <CoachText title={step.title()} goal={step.goal()} tip={card.now ?? chosen.summary()} />;
}

function CardRoutes({ step, card }: { step: Step; card: CardProps }) {
  const routes = step.coach?.routes;
  if (!routes) return null;
  return (
    <span className="coach-routes" role="group" aria-label={t("tutorials.coach.ways")}>
      {routes.map((r, i) => (
        <button
          key={r.kind}
          type="button"
          className="coach-route"
          aria-pressed={i === card.route}
          onClick={() => card.onRoute(i)}
          data-testid={`coach-route-${r.kind}`}
        >
          <Icon name={r.kind === "pointer" ? "pointer" : r.kind === "keyboard" ? "keyboard" : "sliders"} size={13} />
          {r.kind === "pointer"
            ? t("tutorials.coach.pointer")
            : r.kind === "keyboard"
              ? t("tutorials.coach.keyboard")
              : t("tutorials.coach.menu")}
        </button>
      ))}
    </span>
  );
}

/**
 * Coach: help as a ladder in the card, beside what you're doing: a hint, then Show me (the ring and the hint), then
 * Do it for me (the step's demonstration, which moves on). Every rung is always there; after a while without progress
 * the ladder says so.
 */
function CardHelp({
  step,
  phase,
  send,
  card,
  children,
}: {
  step: Step;
  phase: string;
  send: (e: RunnerEvent) => void;
  card: CardProps;
  children?: ReactNode;
}) {
  return (
    <div className={`tutorial-actions coach-help${card.nudged ? " is-nudged" : ""}`} data-testid="coach-help">
      <span className="coach-stuck" role={card.nudged ? "status" : undefined}>
        {card.nudged ? t("tutorials.coach.nudge") : t("tutorials.coach.stuck")}
      </span>
      <span className="coach-rungs">
        {children}
        <button
          className="btn btn-ghost"
          aria-expanded={card.hint || phase === "hinting"}
          aria-controls="tutorial-hint"
          onClick={card.onHint}
          data-testid="coach-hint"
        >
          {t("tutorials.coach.hint")}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => send({ type: "showMe" })}
          aria-pressed={phase === "hinting"}
          aria-expanded={phase === "hinting"}
          aria-controls={phase === "hinting" ? "tutorial-hint" : undefined}
          data-testid="tutorial-show-me"
        >
          {t("tutorials.showMe")}
        </button>
        <button
          className="btn"
          onClick={(e) => {
            if (e.detail < 2) send({ type: "skip", stepId: step.id });
          }}
          title={t("tutorials.skipTitle")}
          data-testid="tutorial-skip"
        >
          {t("tutorials.coach.doIt")}
          <Icon name="chevron-right" size={13} />
        </button>
      </span>
    </div>
  );
}

function Unknown({ id }: { id: string }) {
  return (
    <div className="app tutorial-app" data-testid="tutorial-app">
      <header className="topbar tutorial-bar" data-testid="tutorial-bar">
        <span className="tutorial-chip">{t("tutorials.tutorial")}</span>
        <div className="topbar-spacer" />
        <button className="btn" onClick={() => tutorialRoute.close()} data-testid="tutorial-exit">
          <Icon name="close" size={14} /> {t("tutorials.exit")}
        </button>
      </header>
      <section className="tutorial-strip" data-testid="tutorial-step" data-phase="unknown">
        <p className="tutorial-goal" role="alert">
          {t("tutorials.unknown", { id })}
        </p>
      </section>
    </div>
  );
}

declare global {
  interface Window {
    /** Development and e2e builds: the running tutorial, for the generated tutorial tests. */
    __tutorial?: {
      snapshot(): RunnerSnapshot;
      journal(): readonly unknown[];
      /** The sandbox's saved runs and Live's unsaved draft. */
      runs(): { saved: readonly Simulation[]; draft: Simulation | null };
      /** The current step's solution path, its subjects and words filled in. */
      solution(): ResolvedUiStep[];
      keyboardSolution(): ResolvedKeyboardStep[];
      diagram(): DiagramFile | undefined;
      /** The real AI boundary over the canvas host, including temporary provenance. */
      aiAllowed(): boolean;
      onDeviceAllowed(): boolean;
      allowOnDevice(on: boolean): void;
    };
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function tutorialWhenReady() {
  await surfaceCatalogs(["tutorialTitles", "tutorials", "stencils"]);
  return TutorialApp;
}
