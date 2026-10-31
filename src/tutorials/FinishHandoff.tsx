import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { formatDate } from "../i18n/format";
import { chapters } from "./chapters";
import { justEarnedSeals, leaveLesson, lessonNumber, startNextLesson } from "./handoff";
import { nextTutorial, type StoredTutorials } from "./progress";
import { lessonProgress, seals } from "./seals";
import { Seal } from "./Seal";
import { BlueprintBoard } from "./BlueprintBoard";
import { stepInput } from "./blueprint";
import { KeyText } from "./KeyText";
import type { Tutorial } from "./types";
import "./handoff.css";

export function FinishHandoff({
  tutorial,
  catalog,
  before,
  progress,
}: {
  tutorial: Tutorial;
  catalog: readonly Tutorial[];
  before: StoredTutorials;
  progress: StoredTutorials;
}) {
  const [dismissed, setDismissed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const next = nextTutorial(tutorial, catalog, progress);
  const chapter = chapters[tutorial.track];
  const list = catalog.filter((lesson) => lesson.track === tutorial.track && !lesson.quarantined);
  const done = list.filter((lesson) => lessonProgress(progress, lesson)?.completed).length;
  const whole = catalog
    .filter((lesson) => !lesson.quarantined)
    .every((lesson) => lessonProgress(progress, lesson)?.completed);
  const awards = justEarnedSeals(before, progress, catalog);
  const award = seals.find((seal) => seal.id === (whole ? "whole-syllabus" : chapter.seal));
  const earned = !!award && awards.includes(award.id);
  const name = whole ? t("tutorials.syllabus.whole") : chapter.label();
  const at = lessonProgress(progress, tutorial)?.completedAt;
  const logged =
    at === undefined
      ? t("tutorials.handoff.logged")
      : new Date(at).toDateString() === new Date().toDateString()
        ? t("tutorials.handoff.loggedToday")
        : t("tutorials.handoff.loggedDate", { date: formatDate(at) });
  const dismissSheet = () => {
    setDismissed(true);
    document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus();
  };
  useEffect(() => {
    if (dismissed) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      dismissSheet();
    };
    // A modal can close on this same Escape. Focus and listen after its cleanup and that event finish.
    const frame = requestAnimationFrame(() => {
      heading.current?.focus();
      window.addEventListener("keydown", dismiss);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", dismiss);
    };
  }, [dismissed]);
  if (dismissed) return null;
  return (
    <>
      <div className="handoff-scrim" data-testid="tutorial-handoff-scrim" aria-hidden onClick={dismissSheet} />
      <section className="tutorial-handoff" data-testid="tutorial-handoff" aria-labelledby="tutorial-handoff-title">
        <header className="handoff-header">
          <div className="handoff-heading-row">
            <span data-testid={earned || whole ? `tutorial-handoff-seal-${award?.id}` : undefined}>
              <Seal
                numeral={whole ? "✓" : chapter.numeral}
                earned={whole || done === list.length}
                label={name}
                size={44}
              />
            </span>
            <div>
              <p className="handoff-logged" data-testid="tutorial-handoff-logged">
                {logged}
              </p>
              <h2 id="tutorial-handoff-title" ref={heading} tabIndex={-1} data-testid="tutorial-handoff-heading">
                {whole
                  ? t("tutorials.handoff.finished")
                  : done === list.length
                    ? t("tutorials.handoff.chapterComplete", { chapter: chapter.numeral })
                    : t("tutorials.handoff.chapterProgress", { chapter: chapter.numeral, done, total: list.length })}
              </h2>
              <p className="handoff-chapter">{earned ? t("tutorials.handoff.sealEarned", { name }) : name}</p>
            </div>
          </div>
          <ol className="handoff-ticks" aria-hidden>
            {list.map((lesson) => (
              <li
                key={lesson.id}
                data-state={
                  lessonProgress(progress, lesson)?.completed ? "done" : lesson.id === next?.id ? "next" : "todo"
                }
              />
            ))}
          </ol>
          <p className="tutorial-handoff-recap" data-testid="tutorial-handoff-recap">
            {tutorial.finish.text()}
          </p>
        </header>
        {/* Native scroll keys stay in the reading region instead of reaching the canvas. */}
        <div
          className="handoff-body"
          data-testid="tutorial-handoff-body"
          role={next ? "region" : undefined}
          aria-label={next ? t("tutorials.handoff.nextLesson") : undefined}
          tabIndex={next ? 0 : undefined}
          onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
              event.stopPropagation();
          }}
        >
          {next && (
            <div className="tutorial-handoff-next" data-testid="tutorial-handoff-next">
              <BlueprintBoard key={next.id} lesson={next} catalog={catalog} />
              <p className="handoff-summary">{next.summary()}</p>
              <ol className="handoff-steps" data-testid="tutorial-handoff-steps">
                {next.steps.map((step, i) => (
                  <li key={step.id} data-testid={`tutorial-handoff-step-${i + 1}`}>
                    <span className="handoff-mark" aria-hidden>
                      {i + 1}
                    </span>
                    <div>
                      <div className="handoff-step-row">
                        <b data-testid="tutorial-handoff-step-title">{step.title()}</b>
                        <span className="handoff-input">
                          <KeyText text={stepInput(step)} />
                        </span>
                      </div>
                      <p className="handoff-outcome">{(step.done ?? step.goal)()}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <footer className="handoff-footer" data-testid="tutorial-handoff-footer">
          {next && (
            <button
              className="btn btn-primary tutorial-handoff-start"
              data-testid="tutorial-next"
              onClick={() => startNextLesson(next)}
            >
              {t("tutorials.handoff.start", { number: lessonNumber(next, catalog) })}
            </button>
          )}
          <button className="btn btn-ghost handoff-stay" data-testid="tutorial-handoff-dismiss" onClick={dismissSheet}>
            {t("tutorials.handoff.stay")}
          </button>
          <button
            className="btn handoff-pick"
            data-testid="tutorial-pick-chapter"
            onClick={() => leaveLesson(tutorial)}
          >
            {t("tutorials.handoff.pickChapter")}
          </button>
          <button
            className="btn btn-ghost handoff-all"
            data-testid="tutorial-done-exit"
            onClick={() => leaveLesson(tutorial)}
          >
            {t("tutorials.handoff.all")}
          </button>
        </footer>
      </section>
    </>
  );
}
