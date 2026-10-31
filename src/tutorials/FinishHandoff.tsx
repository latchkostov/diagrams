import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { formatDate } from "../i18n/format";
import { chapters } from "./chapters";
import { justEarnedSeals, leaveLesson, lessonNumber, startNextLesson } from "./handoff";
import { nextTutorial, type StoredTutorials } from "./progress";
import { lessonProgress, seals } from "./seals";
import { Seal } from "./Seal";
import type { Tutorial } from "./types";

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
  const list = catalog.filter((lesson) => lesson.track === tutorial.track);
  const done = list.filter((lesson) => lessonProgress(progress, lesson)?.completed).length;
  const whole = catalog.every((lesson) => lessonProgress(progress, lesson)?.completed);
  const awards = justEarnedSeals(before, progress, catalog);
  const shown = seals.filter((seal) => awards.includes(seal.id) || (whole && seal.id === "whole-syllabus"));
  const at = lessonProgress(progress, tutorial)?.completedAt;
  const today = new Date();
  const logged =
    at === undefined
      ? t("tutorials.handoff.logged")
      : new Date(at).toDateString() === today.toDateString()
        ? t("tutorials.handoff.loggedToday")
        : t("tutorials.handoff.loggedDate", { date: formatDate(at) });
  const dismissSheet = () => {
    setDismissed(true);
    document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus();
  };
  useEffect(() => {
    if (dismissed) return;
    heading.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      dismissSheet();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [dismissed]);
  if (dismissed) return null;
  return (
    <section className="tutorial-handoff" data-testid="tutorial-handoff" aria-labelledby="tutorial-handoff-title">
      <header>
        <p className="tutorials-eyebrow" data-testid="tutorial-handoff-logged">
          {logged}
        </p>
        <h2 id="tutorial-handoff-title" ref={heading} tabIndex={-1} data-testid="tutorial-handoff-heading">
          {whole
            ? t("tutorials.handoff.finished")
            : done === list.length
              ? t("tutorials.handoff.chapterComplete", { chapter: chapter.numeral })
              : t("tutorials.handoff.chapterProgress", { chapter: chapter.numeral, done, total: list.length })}
        </h2>
        {shown.map((seal) => {
          const name = seal.track ? chapters[seal.track].label() : t("tutorials.syllabus.whole");
          return (
            <p className="tutorial-handoff-seal" key={seal.id} data-testid={`tutorial-handoff-seal-${seal.id}`}>
              <Seal numeral={seal.numeral} earned label={name} size={36} />
              {awards.includes(seal.id) ? t("tutorials.handoff.sealEarned", { name }) : name}
            </p>
          );
        })}
      </header>
      <p className="tutorial-handoff-recap" data-testid="tutorial-handoff-recap">
        {tutorial.finish.text()}
      </p>
      {next && (
        <div className="tutorial-handoff-next" data-testid="tutorial-handoff-next">
          <p className="tutorials-eyebrow">
            {t("tutorials.handoff.next", { number: lessonNumber(next, catalog), minutes: next.minutes })}
          </p>
          <h3>{next.title()}</h3>
          <p>{next.summary()}</p>
          <h4 className="tutorial-intro-head">{t("tutorials.youWill")}</h4>
          <ol className="tutorial-intro-steps" data-testid="tutorial-handoff-steps">
            {next.steps.map((step) => (
              <li key={step.id}>{step.title()}</li>
            ))}
          </ol>
        </div>
      )}
      <footer>
        {next && (
          <button
            className="btn btn-primary tutorial-handoff-start"
            data-testid="tutorial-next"
            onClick={() => startNextLesson(next)}
          >
            {t("tutorials.handoff.start", { number: lessonNumber(next, catalog) })}
          </button>
        )}
        <button className="btn" data-testid="tutorial-pick-chapter" onClick={() => leaveLesson(tutorial)}>
          {t("tutorials.handoff.pickChapter")}
        </button>
        <button className="btn btn-ghost" data-testid="tutorial-done-exit" onClick={() => leaveLesson(tutorial)}>
          {t("tutorials.handoff.all")}
        </button>
        <button className="btn btn-ghost" data-testid="tutorial-handoff-dismiss" onClick={dismissSheet}>
          {t("tutorials.handoff.stay")}
        </button>
      </footer>
    </section>
  );
}
