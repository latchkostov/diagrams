import { t } from "../i18n";
import { trackLabel, tutorials } from "./catalog";
import { savedProgress } from "./progress";
import { tutorialRoute } from "./route";
import "./tutorials.css";

/**
 * The Examples dialog's Tutorials row: the pilot's entry point. Each starts on a practice diagram, so opening one
 * never touches the diagram on screen (the dialog closes first, which saves it).
 */
export function TutorialsRow({ onClose }: { onClose(): void }) {
  return (
    <section className="examples-tutorials" aria-labelledby="examples-tutorials-title" data-testid="examples-tutorials">
      <h3 id="examples-tutorials-title">{t("tutorials.section")}</h3>
      <p>{t("tutorials.sectionIntro")}</p>
      {tutorials.map((tutorial) => {
        const progress = savedProgress(tutorial);
        const title = tutorial.title();
        return (
          <article
            key={tutorial.id}
            className="tutorial-card"
            data-testid={`tutorial-card-${tutorial.id}`}
            aria-labelledby={`tutorial-title-${tutorial.id}`}
          >
            <div>
              <h4 id={`tutorial-title-${tutorial.id}`}>{title}</h4>
              <p>{tutorial.summary()}</p>
              <p>
                {t("tutorials.meta", { track: trackLabel(tutorial.track), minutes: tutorial.minutes })}
                {progress?.completed ? ` · ${t("tutorials.completed")}` : ""}
              </p>
            </div>
            <button
              className="btn btn-primary"
              data-testid={`tutorial-open-${tutorial.id}`}
              aria-label={t("tutorials.startNamed", { title })}
              onClick={() => {
                onClose();
                tutorialRoute.open(tutorial.id);
              }}
            >
              {progress && !progress.completed && progress.step > 0
                ? t("tutorials.resume", { step: progress.step + 1 })
                : t("tutorials.start")}
            </button>
          </article>
        );
      })}
    </section>
  );
}
