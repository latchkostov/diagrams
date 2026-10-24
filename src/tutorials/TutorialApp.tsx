import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { LazyCanvasView as CanvasView } from "../canvas/loadCanvasView";
import { TUTORIAL_SLUG } from "../lib/diagramIO";
import { showDiagram } from "../lib/urlState";
import { Icon } from "../components/Icon";
import { Dialog } from "../interop/ui/Dialog";
import { CommandPalette } from "../palette/CommandPalette";
import { t, useLocale } from "../i18n";
import { tRich } from "../i18n/rich";
import { findTutorial, trackLabel } from "./catalog";
import { Coachmark } from "./Coachmark";
import { inStep, type RunnerEvent } from "./machine";
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
const NO_DIAGRAMS: never[] = [];

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
  const step = inStep(state) ? tutorial.steps[state.index] : undefined;
  // The ring points while a step is being done; once its check holds (completing), there's nothing left to point at.
  const spot = !!step && state.value !== "completing" && (state.highlights || state.value === "hinting");

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
      {state.value === "intro" && <Intro tutorial={tutorial} snap={snap} send={runner.send} />}
      {spot && <Coachmark targets={step.targets} subjects={snap.subjects} selected={snap.selected} />}
      {/* Ctrl+K works here as on any canvas: actions, nodes, stencils. There are no other diagrams to open. */}
      <CommandPalette view="canvas" diagrams={NO_DIAGRAMS} currentSlug={TUTORIAL_SLUG} onOpenDiagram={noop} />
      <div className="sr-only" role="status" aria-live="polite" data-testid="tutorial-announce">
        {snap.announcement}
      </div>
    </div>
  );
}

/**
 * The intro: one focused card with one primary action. It's a dialog, so its Start takes the keyboard as a dialog's
 * first action does (Enter starts) and Esc or "Not now" leaves the tutorial.
 */
function Intro({ tutorial, snap, send }: { tutorial: Tutorial; snap: RunnerSnapshot; send: (e: RunnerEvent) => void }) {
  const { resumeAt } = snap.state;
  return (
    <Dialog
      title={tutorial.title()}
      subtitle={`${t("tutorials.meta", { track: trackLabel(tutorial.track), minutes: tutorial.minutes })} · ${t("tutorials.sandbox")}`}
      onClose={() => send({ type: "exit" })}
      testId="tutorial-intro"
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => send({ type: "exit" })} data-testid="tutorial-not-now">
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
function Strip({ tutorial, snap, send }: { tutorial: Tutorial; snap: RunnerSnapshot; send: (e: RunnerEvent) => void }) {
  const { state } = snap;
  const phase = state.value;
  const step = inStep(state) ? tutorial.steps[state.index] : undefined;
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
          <div className="tutorial-words">
            <p className="tutorial-goal" data-testid="tutorial-goal">
              <strong>
                {step.title()}. {step.goal()}
              </strong>
            </p>
            {snap.nearMiss && phase !== "completing" ? (
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
                <Icon name="check" size={13} /> {step.done?.() ?? ""} {t("tutorials.finishUp")}
              </p>
            ) : phase === "hinting" && step.hint ? (
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
          </div>
          <div className="tutorial-actions">
            {phase === "active" && (
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
