import type { RefObject } from "react";
import { Icon } from "../components/Icon";
import { t } from "../i18n";
import { formatDate } from "../i18n/format";
import { tracks, tutorials } from "./catalog";
import type { StoredTutorials } from "./progress";
import { earnedSeals, lessonProgress, seals } from "./seals";
import { Seal } from "./Seal";

export function SealsPage({
  progress,
  onBack,
  headingRef,
}: {
  progress: StoredTutorials;
  onBack: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const awards = earnedSeals(progress, tutorials);
  return (
    <>
      <nav className="tutorials-breadcrumb" aria-label={t("tutorials.syllabus.seals")}>
        <button className="tutorials-link" data-testid="tutorials-seals-back" onClick={onBack}>
          <Icon name="chevrons-left" size={14} />
          {t("tutorials.section")}
        </button>
        <span aria-hidden="true">/</span>
        <span>{t("tutorials.syllabus.seals")}</span>
      </nav>
      <header className="tutorials-head">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {t("tutorials.syllabus.seals")}
          </h1>
          <p>{t("tutorials.sharing.optionalExplanation")}</p>
        </div>
        <span className="tutorials-seals-count">{t("tutorials.syllabus.earnedCount", { count: awards.length })}</span>
      </header>
      <div className="tutorials-seal-grid" data-testid="tutorials-seals-page">
        {seals.map((seal) => {
          const list = tutorials.filter((lesson) => !lesson.optional && (!seal.track || lesson.track === seal.track));
          const done = list.filter((lesson) => lessonProgress(progress, lesson)?.completed).length;
          const earned = awards.includes(seal.id);
          const at = progress.marks?.[seal.id];
          const name = seal.track
            ? tracks.find((track) => track.id === seal.track)!.label()
            : t("tutorials.syllabus.whole");
          const status = earned
            ? at === undefined
              ? t("tutorials.syllabus.sealEarned")
              : t("tutorials.syllabus.earnedDate", { date: formatDate(at) })
            : t("tutorials.syllabus.notYet", { done, total: list.length });
          return (
            <article
              key={seal.id}
              className={`tutorials-seal-card${earned ? " is-earned" : ""}`}
              data-testid={`tutorials-seal-${seal.id}`}
            >
              <Seal
                numeral={seal.numeral}
                earned={earned}
                size={48}
                label={t("tutorials.syllabus.sealName", { name, status })}
              />
              <h2>{name}</h2>
              <p>
                {seal.track
                  ? t("tutorials.syllabus.chapterCriterion", { count: list.length, chapter: seal.numeral })
                  : t("tutorials.syllabus.coreCriterion", { count: list.length })}
              </p>
              <span>{status}</span>
            </article>
          );
        })}
      </div>
      <p className="tutorials-seals-note">{t("tutorials.syllabus.sealsLegend")}</p>
    </>
  );
}
