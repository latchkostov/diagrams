import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { surfaceCatalogs } from "../i18n/surfaces";
import { Icon } from "../components/Icon";
import { ContextMenu } from "../components/ContextMenu";
import { t, useLocale } from "../i18n";
import { formatDate } from "../i18n/format";
import { toast } from "../interop/ui/toast";
import { tracks, tutorials } from "./catalog";
import {
  earnedSeals,
  readTutorials,
  subscribeTutorials,
  tutorialsSnapshot,
  recordSeals,
  resetProgress,
  restoreProgress,
  writeTutorials,
  type ResetScope,
  type StoredTutorials,
} from "./progress";
import { chapterSeals, lessonProgress } from "./seals";
import { Seal } from "./Seal";
import { SealsPage } from "./SealsPage";
import { ResetProgressDialog } from "./ResetProgressDialog";
import { tutorialRoute } from "./route";
import type { TrackId, Tutorial } from "./types";
import "./tutorials.css";

// Retain the lesson's chapter across the existing history-based Exit/Done handoff.
let lastChapter: TrackId | undefined;
const chapterNumber = (track: TrackId) => tracks.findIndex((x) => x.id === track) + 1;
const lessonNumber = (lesson: Tutorial) =>
  `${chapterNumber(lesson.track)}.${tutorials.filter((x) => x.track === lesson.track).indexOf(lesson) + 1}`;

export function TutorialsView() {
  useLocale();
  const raw = useSyncExternalStore(subscribeTutorials, tutorialsSnapshot, () => "{}");
  const progress = recordSeals(readTutorials(raw), tutorials);
  const ordered = tracks.flatMap((track) => tutorials.filter((lesson) => lesson.track === track.id));
  const current =
    ordered.find((lesson) => {
      const p = lessonProgress(progress, lesson);
      return p && !p.completed;
    }) ?? ordered.find((lesson) => !lessonProgress(progress, lesson)?.completed);
  const [open, setOpen] = useState<TrackId | null>(() => lastChapter ?? current?.track ?? tracks[0].id);
  const [page, setPage] = useState<"hub" | "seals">("hub");
  const [reset, setReset] = useState<ResetScope | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const done = tutorials.filter((lesson) => lessonProgress(progress, lesson)?.completed).length;
  const awards = earnedSeals(progress, tutorials);
  useEffect(() => {
    writeTutorials((s) => recordSeals(s, tutorials));
  }, []);
  const launch = (lesson: Tutorial) => {
    lastChapter = lesson.track;
    tutorialRoute.open(lesson.id);
  };
  const changePage = (next: "hub" | "seals") => {
    setPage(next);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const confirmReset = (scope: ResetScope) => {
    const previous = resetProgress(scope);
    setReset(null);
    toast.info(t("tutorials.syllabus.resetDone"), {
      action: {
        label: t("tutorials.syllabus.undo"),
        testId: "tutorials-reset-undo",
        run: () => {
          restoreProgress(previous);
        },
      },
    });
  };
  return (
    <div className="tutorials-view" data-testid="tutorials-view">
      <div className="tutorials-wrap">
        {page === "seals" ? (
          <SealsPage progress={progress} onBack={() => changePage("hub")} headingRef={heading} />
        ) : (
          <>
            <header className="tutorials-head">
              <div className="tutorials-heading">
                <h1 ref={heading} tabIndex={-1}>
                  {t("tutorials.section")}
                </h1>
                <p>{t("tutorials.viewIntro")}</p>
                <div className="tutorials-overall" data-testid="tutorials-overall">
                  <div
                    className="tutorials-segments"
                    role="progressbar"
                    aria-label={t("tutorials.section")}
                    aria-valuemin={0}
                    aria-valuemax={tutorials.length}
                    aria-valuenow={done}
                  >
                    {tracks.map((track) => {
                      const list = tutorials.filter((lesson) => lesson.track === track.id);
                      return (
                        <span key={track.id} style={{ flex: list.length }}>
                          <b
                            style={{
                              width: `${(list.filter((lesson) => lessonProgress(progress, lesson)?.completed).length / list.length) * 100}%`,
                            }}
                          />
                        </span>
                      );
                    })}
                  </div>
                  <span>
                    {t("tutorials.syllabus.overall", { done, total: tutorials.length, seals: awards.length })}
                  </span>
                </div>
              </div>
              <div className="tutorials-header-actions">
                <button className="btn" data-testid="tutorials-seals" onClick={() => changePage("seals")}>
                  <Seal numeral="I" earned={awards.length > 0} label={t("tutorials.syllabus.seals")} size={16} />
                  {t("tutorials.syllabus.seals")}
                </button>
                <button
                  ref={menuButton}
                  className="btn icon-only"
                  aria-label={t("tutorials.syllabus.more")}
                  aria-haspopup="menu"
                  aria-expanded={!!menu}
                  data-testid="tutorials-more"
                  onClick={() => {
                    const box = menuButton.current!.getBoundingClientRect();
                    setMenu(menu ? null : { x: box.left, y: box.bottom + 4 });
                  }}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              </div>
            </header>
            {current ? (
              <section
                className="tutorials-resume"
                data-testid="tutorials-resume"
                aria-labelledby="tutorials-resume-title"
              >
                <span className="tutorials-number">{lessonNumber(current)}</span>
                <div className="tutorials-resume-words">
                  <h2 id="tutorials-resume-title" className="tutorials-eyebrow">
                    {done === 0 && !Object.keys(progress.progress ?? {}).length
                      ? t("tutorials.syllabus.startHere", { number: lessonNumber(current) })
                      : t("tutorials.syllabus.resume")}
                  </h2>
                  <b>{current.title()}</b>
                  <p>
                    {lessonProgress(progress, current)
                      ? t("tutorials.syllabus.resumeStep", {
                          chapter: tracks.find((x) => x.id === current.track)!.label(),
                          step: Math.min((lessonProgress(progress, current)?.step ?? 0) + 1, current.steps.length),
                          total: current.steps.length,
                          title:
                            current.steps[
                              Math.min(lessonProgress(progress, current)?.step ?? 0, current.steps.length - 1)
                            ].title(),
                        })
                      : t("tutorials.syllabus.resumeIntro", { summary: current.summary(), minutes: current.minutes })}
                  </p>
                </div>
                <button className="btn btn-primary" data-testid="tutorials-resume-open" onClick={() => launch(current)}>
                  {lessonProgress(progress, current) ? t("tutorials.continue") : t("tutorials.start")}
                  <Icon name="chevron-right" size={14} />
                </button>
              </section>
            ) : (
              <section className="tutorials-resume" data-testid="tutorials-resume">
                <Icon name="check" />
                <div>
                  <h2>{t("tutorials.syllabus.finished")}</h2>
                  <p>{t("tutorials.syllabus.reviewAny")}</p>
                </div>
              </section>
            )}
            {tracks.map((track, index) => {
              const list = tutorials.filter((lesson) => lesson.track === track.id);
              const finished = list.filter((lesson) => lessonProgress(progress, lesson)?.completed).length;
              const seal = chapterSeals[index];
              const earned = awards.includes(seal.id);
              const expanded = open === track.id;
              const minutes = list
                .filter((lesson) => !lessonProgress(progress, lesson)?.completed)
                .reduce((sum, lesson) => sum + lesson.minutes, 0);
              return (
                <section
                  key={track.id}
                  className="tutorials-chapter"
                  aria-labelledby={`tutorials-track-title-${track.id}`}
                  data-testid={`tutorials-track-${track.id}`}
                >
                  <h2 className="tutorials-chapter-heading">
                    <button
                      className="tutorials-disclosure"
                      id={`tutorials-track-title-${track.id}`}
                      aria-expanded={expanded}
                      aria-controls={`tutorials-lessons-${track.id}`}
                      data-testid={`tutorials-chapter-${track.id}`}
                      onClick={() => setOpen(expanded ? null : track.id)}
                    >
                      <Seal
                        numeral={seal.numeral}
                        earned={earned}
                        label={earned ? t("tutorials.syllabus.sealEarned") : t("tutorials.syllabus.notEarned")}
                      />
                      <span className="tutorials-chapter-label">
                        <small>{t("tutorials.syllabus.chapter", { number: seal.numeral })}</small>
                        <b>{track.label()}</b>
                        <span>{track.blurb()}</span>
                      </span>
                      <span className="tutorials-glyph-strip" aria-hidden="true">
                        {!expanded &&
                          list.map((lesson) => <ProgressGlyph key={lesson.id} progress={progress} lesson={lesson} />)}
                      </span>
                      <span className="tutorials-chapter-count">
                        <b>{t("tutorials.syllabus.count", { done: finished, total: list.length })}</b>
                        {" · "}
                        {minutes === 0 && earned
                          ? t("tutorials.syllabus.sealEarned")
                          : t("tutorials.syllabus.minutesLeft", { minutes })}
                      </span>
                      <span className={expanded ? "tutorials-chevron is-open" : "tutorials-chevron"}>
                        <Icon name="chevron-down" size={16} />
                      </span>
                    </button>
                  </h2>
                  <div id={`tutorials-lessons-${track.id}`} hidden={!expanded}>
                    <ol className="tutorials-rows">
                      {list.map((lesson) => (
                        <LessonRow key={lesson.id} lesson={lesson} progress={progress} onOpen={() => launch(lesson)} />
                      ))}
                    </ol>
                    <div className="tutorials-chapter-foot">
                      <span>
                        {t("tutorials.syllabus.chapterNote", {
                          count: list.length,
                          minutes: list.reduce((sum, lesson) => sum + lesson.minutes, 0),
                        })}
                      </span>
                      <button
                        className="tutorials-link"
                        data-testid={`tutorials-reset-${track.id}`}
                        onClick={() => setReset({ track: track.id })}
                      >
                        {t("tutorials.syllabus.resetChapter")}
                      </button>
                    </div>
                  </div>
                </section>
              );
            })}
            <p className="tutorials-browser-note">
              <Icon name="info" size={14} />
              {t("tutorials.syllabus.browserOnly")}
            </p>
          </>
        )}
      </div>
      {menu && (
        <ContextMenu
          {...menu}
          triggerRef={menuButton}
          label={t("tutorials.syllabus.more")}
          testId="tutorials-menu"
          items={[
            {
              type: "item",
              id: "tutorials-reset",
              label: t("tutorials.syllabus.reset"),
              run: () => setReset({ all: true }),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {reset && (
        <ResetProgressDialog
          initialScope={reset}
          current={current ?? ordered[ordered.length - 1]}
          progress={progress}
          onClose={() => setReset(null)}
          onConfirm={confirmReset}
        />
      )}
    </div>
  );
}

function ProgressGlyph({ progress, lesson }: { progress: StoredTutorials; lesson: Tutorial }) {
  const p = lessonProgress(progress, lesson);
  return (
    <span
      aria-hidden="true"
      className={`tutorials-status${p?.completed ? " is-done" : p && p.step > 0 ? " is-going" : ""}`}
    >
      {p?.completed && <Icon name="check" size={12} />}
    </span>
  );
}

function LessonRow({ lesson, progress, onOpen }: { lesson: Tutorial; progress: StoredTutorials; onOpen: () => void }) {
  const p = lessonProgress(progress, lesson);
  const going = !!p && !p.completed && p.step > 0;
  const state = p?.completed
    ? t("tutorials.syllabus.done")
    : going
      ? t("tutorials.syllabus.going")
      : t("tutorials.syllabus.notStarted");
  const status = p?.completed
    ? p.completedAt === undefined
      ? t("tutorials.syllabus.done")
      : t("tutorials.syllabus.doneDate", { date: formatDate(p.completedAt) })
    : going
      ? t("tutorials.syllabus.step", { step: Math.min(p.step + 1, lesson.steps.length), total: lesson.steps.length })
      : t("tutorials.syllabus.lessonMeta", { minutes: lesson.minutes, level: lesson.level });
  return (
    <li className={`tutorials-row${going ? " is-going" : ""}`} data-testid={`tutorial-card-${lesson.id}`}>
      <span className="tutorials-number">{lessonNumber(lesson)}</span>
      <ProgressGlyph progress={progress} lesson={lesson} />
      <div className="tutorials-row-title">
        <h3>{lesson.title()}</h3>
        <p>{lesson.summary()}</p>
      </div>
      <span className="tutorials-row-meta" data-testid={`tutorial-status-${lesson.id}`}>
        {status}
      </span>
      <button
        className={`btn ${going ? "" : "btn-ghost"}`}
        data-testid={`tutorial-open-${lesson.id}`}
        aria-label={t("tutorials.syllabus.openLesson", {
          number: lessonNumber(lesson),
          title: lesson.title(),
          state,
          status,
        })}
        onClick={onOpen}
      >
        {going ? t("tutorials.continue") : p?.completed ? t("tutorials.syllabus.review") : t("tutorials.start")}
      </button>
    </li>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function tutorialsWhenReady() {
  await surfaceCatalogs(["tutorialTitles", "tutorials"]);
  return TutorialsView;
}
