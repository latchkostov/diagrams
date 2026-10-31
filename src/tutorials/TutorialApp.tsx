import { surfaceCatalogs } from "../i18n/surfaces";
import { ModeSwitch, HistoryButtons } from "../components/ModeSwitch";
import { Suspense, use, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { Coachmark } from "./Coachmark";
import { useTutorialLayout } from "./useTutorialLayout";
import { inStep, targetsShown, type RunnerEvent } from "./machine";
import { createTutorialRunner, type RunnerSnapshot } from "./runner";
import { tutorialRoute } from "./route";
import type { Tutorial } from "./types";
import { solutionNow, type ResolvedUiStep } from "./solution";
import { keyboardSolutionNow, type ResolvedKeyboardStep } from "./keyboard";
import { createPracticeImport, createPracticePrivacy, tutorialFilePolicy } from "./filePolicy";
import { beginObservedWork, cancelObservedWork, observationPorts } from "../lib/observations";
import { canUseAiTools } from "../lib/localOnly";
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
 * A tutorial: its bar in place of the top bar, the step strip under it, and the canvas on a sandbox diagram of its
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
    };
    return () => void delete window.__tutorial;
  }, [runner, tutorial]);
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const { state } = snap;
  const step = inStep(state) ? tutorial.steps[state.index] : undefined;
  const spot = !!step && targetsShown(state, !!tutorial.study);

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
          {tutorial.chrome !== "app" && (
            <>
              <span className="sr-only" data-testid="diagram-title">
                {diagramTitle}
              </span>
              <HistoryButtons />
              <ModeSwitch />
            </>
          )}
          <div className="topbar-spacer" />
          <label className="tutorial-switch" title={t("tutorials.highlightsTitle")}>
            <input
              type="checkbox"
              checked={state.highlights}
              onChange={(e) => runner.send({ type: "highlights", on: e.target.checked })}
              data-testid="tutorial-highlights"
            />
            {t("tutorials.highlights")}
          </label>
          {state.value !== "intro" && (
            <button
              className="btn"
              aria-label={t("tutorials.restart")}
              title={t("tutorials.restart")}
              onClick={() => {
                setBefore(readTutorials());
                runner.send({ type: "restart" });
                interop.resetImports();
                temporaryPrivacy.setPrivate(false);
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
      <div hidden={presenting}>
        <Strip tutorial={tutorial} snap={snap} send={runner.send} saveCopy={saveCopy} />
      </div>
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
      {spot && !presenting && (
        <Coachmark targets={step.targets} subjects={snap.subjects} edges={snap.edges} selected={snap.selected} />
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
function Strip({
  tutorial,
  snap,
  send,
  saveCopy,
}: {
  tutorial: Tutorial;
  snap: RunnerSnapshot;
  send: (e: RunnerEvent) => void;
  saveCopy(): void;
}) {
  const { state } = snap;
  const phase = state.value;
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase !== "failed") return;
    const frame = requestAnimationFrame(() => retry.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [phase]);
  const step = inStep(state) || phase === "failed" ? tutorial.steps[state.index] : undefined;
  const last = state.last !== null ? tutorial.steps[state.last] : undefined;
  return (
    <section
      className="tutorial-strip"
      aria-label={t("tutorials.tutorial")}
      data-testid="tutorial-step"
      data-phase={inStep(state) ? "step" : phase}
      data-state={phase}
      data-step={step?.id ?? ""}
    >
      {/* The intro says it all in its card: the strip waits, at its height. */}
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
              <strong>
                {step.title()}. {step.goal()}
              </strong>
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
                <Icon name="check" size={13} /> {step.done?.() ?? ""}{" "}
                {typeof step.settle === "object"
                  ? step.settle.tip()
                  : step.settle === "annotation"
                    ? t("tutorials.finishAnnotation")
                    : t("tutorials.finishUp")}
              </p>
            ) : phase === "hinting" && step.hint ? (
              <p className="tutorial-aside" id="tutorial-hint" data-testid="tutorial-hint">
                {step.hint()}
              </p>
            ) : (
              last?.done && (
                <p className="tutorial-done" data-testid="tutorial-done">
                  <Icon name="check" size={13} /> {last.done()}
                </p>
              )
            )}
          </div>
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
              <button className="btn" ref={retry} data-testid="tutorial-retry" onClick={() => send({ type: "retry" })}>
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
    };
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function tutorialWhenReady() {
  await surfaceCatalogs(["tutorialTitles", "tutorials", "stencils"]);
  return TutorialApp;
}
