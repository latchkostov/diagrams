import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { LazyCanvasView as CanvasView } from "../canvas/loadCanvasView";
import { TUTORIAL_SLUG } from "../lib/diagramIO";
import { showDiagram } from "../lib/urlState";
import { Icon } from "../components/Icon";
import { t, useLocale } from "../i18n";
import { findTutorial, trackLabel } from "./catalog";
import { Coachmark } from "./Coachmark";
import { createTutorialRunner, type RunnerSnapshot } from "./runner";
import { tutorialRoute } from "./route";
import type { Tutorial } from "./types";
import { solutionNow, type ResolvedUiStep } from "./solution";
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
const focusOnMount = (el: HTMLButtonElement | null) => el?.focus({ preventScroll: true });

/**
 * A tutorial: its bar in place of the top bar, the step strip under it, and the canvas on a sandbox diagram of its
 * own (TUTORIAL_SLUG is never stored). Leaving goes back to where it was opened from.
 */
export function TutorialApp({ id }: { id: string }) {
  useLocale();
  const tutorial = findTutorial(id);
  if (!tutorial) return <Unknown id={id} />;
  return <Running key={tutorial.id} tutorial={tutorial} />;
}

function Running({ tutorial }: { tutorial: Tutorial }) {
  const [runner] = useState(() => {
    startFresh();
    return createTutorialRunner(tutorial, { close: () => tutorialRoute.close() });
  });
  const [start] = useState(tutorial.start);
  useEffect(() => runner.connect(), [runner]);
  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === "1")) return;
    window.__tutorial = {
      snapshot: runner.getSnapshot,
      journal: runner.journal,
      solution: () => solutionNow(tutorial, runner.getSnapshot()),
    };
    return () => void delete window.__tutorial;
  }, [runner, tutorial]);
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const { state } = snap;
  const step = state.value === "step" ? tutorial.steps[state.index] : undefined;
  const spot = !!step && (state.highlights || state.shown);

  return (
    <div className="app tutorial-app" data-testid="tutorial-app" data-tutorial={tutorial.id}>
      <header className="topbar tutorial-bar" data-testid="tutorial-bar">
        <span className="tutorial-chip">{t("tutorials.tutorial")}</span>
        <span className="tutorial-name" data-testid="tutorial-title">
          {tutorial.title()}
        </span>
        <Progress tutorial={tutorial} snap={snap} />
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
          <button className="btn" onClick={() => runner.send({ type: "restart" })} data-testid="tutorial-restart">
            <Icon name="reset" size={14} /> {t("tutorials.restart")}
          </button>
        )}
        <button className="btn" onClick={() => runner.send({ type: "exit" })} data-testid="tutorial-exit">
          <Icon name="close" size={14} /> {t("tutorials.exit")}
        </button>
      </header>
      <Strip tutorial={tutorial} snap={snap} send={runner.send} />
      <div className="app-body">
        <div className="app-main">
          <Suspense fallback={<div className="view-loading" data-testid="view-loading" />}>
            <CanvasView slug={TUTORIAL_SLUG} initial={start} presenting={false} onExitPresent={noop} />
          </Suspense>
        </div>
      </div>
      {spot && <Coachmark targets={step.targets} subjects={snap.subjects} selected={snap.selected} />}
      <div className="sr-only" role="status" aria-live="polite" data-testid="tutorial-announce">
        {snap.announcement}
      </div>
    </div>
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
          const done = finished || state.observed[i] || state.latched[i];
          const here = state.value === "step" && i === state.index;
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

function Strip({
  tutorial,
  snap,
  send,
}: {
  tutorial: Tutorial;
  snap: RunnerSnapshot;
  send: ReturnType<typeof createTutorialRunner>["send"];
}) {
  const { state } = snap;
  const phase = state.value;
  const step = phase === "step" ? tutorial.steps[state.index] : undefined;
  const last = state.last !== null ? tutorial.steps[state.last] : undefined;
  return (
    <section
      className="tutorial-strip"
      aria-label={t("tutorials.tutorial")}
      data-testid="tutorial-step"
      data-phase={phase}
      data-step={step?.id ?? ""}
    >
      {phase === "intro" && (
        <>
          <div className="tutorial-words">
            <p className="tutorial-goal">{tutorial.summary()}</p>
            <p className="tutorial-aside">
              {t("tutorials.meta", { track: trackLabel(tutorial.track), minutes: tutorial.minutes })} ·{" "}
              {t("tutorials.sandbox")}
            </p>
          </div>
          <div className="tutorial-actions">
            {state.resumeAt > 0 && (
              <button className="btn" onClick={() => send({ type: "start" })} data-testid="tutorial-start-over">
                {t("tutorials.startOver")}
              </button>
            )}
            <button
              className="btn btn-primary"
              // The intro's one action takes focus: the tutorial replaced the whole view, like a dialog opening.
              ref={focusOnMount}
              onClick={() => send({ type: state.resumeAt > 0 ? "resume" : "start" })}
              data-testid="tutorial-start"
            >
              {state.resumeAt > 0 ? t("tutorials.resume", { step: state.resumeAt + 1 }) : t("tutorials.start")}
            </button>
          </div>
        </>
      )}
      {step && (
        <>
          <div className="tutorial-words">
            {/* One line above the goal: the hint once asked for, else what was just done. The strip keeps its height. */}
            {state.shown && step.hint ? (
              <p className="tutorial-aside" data-testid="tutorial-hint">
                {step.hint()}
              </p>
            ) : (
              last?.done && (
                <p className="tutorial-done" data-testid="tutorial-done">
                  <Icon name="check" size={13} /> {last.done()}
                </p>
              )
            )}
            <p className="tutorial-goal" data-testid="tutorial-goal">
              <strong>{step.title()}.</strong> {step.goal()}
            </p>
          </div>
          <div className="tutorial-actions">
            {!state.shown && (
              <button className="btn" onClick={() => send({ type: "showMe" })} data-testid="tutorial-show-me">
                {t("tutorials.showMe")}
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => send({ type: "skip" })}
              title={t("tutorials.skipTitle")}
              data-testid="tutorial-skip"
            >
              {t("tutorials.skip")}
            </button>
          </div>
        </>
      )}
      {phase === "finished" && (
        <>
          <div className="tutorial-words">
            {last?.done && (
              <p className="tutorial-done">
                <Icon name="check" size={13} /> {last.done()}
              </p>
            )}
            <p className="tutorial-goal" data-testid="tutorial-finished">
              <strong>{t("tutorials.finished")}.</strong> {tutorial.finish.text()}
            </p>
          </div>
          <div className="tutorial-actions">
            {tutorial.finish.example && (
              <a
                className="btn"
                href={`?view=canvas&example=${encodeURIComponent(tutorial.finish.example.slug)}`}
                data-testid="tutorial-example"
              >
                {tutorial.finish.example.label()}
              </a>
            )}
            <button className="btn btn-primary" onClick={() => send({ type: "exit" })} data-testid="tutorial-done-exit">
              {t("tutorials.done")}
            </button>
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
      /** The current step's solution path, its subjects and words filled in. */
      solution(): ResolvedUiStep[];
    };
  }
}
