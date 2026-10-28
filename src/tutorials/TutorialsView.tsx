import { surfaceCatalogs } from "../i18n/surfaces";
import { Icon } from "../components/Icon";
import { t, useLocale } from "../i18n";
import { tracks, tutorials } from "./catalog";
import { savedProgress } from "./progress";
import { tutorialRoute } from "./route";
import type { Tutorial } from "./types";
import "./tutorials.css";

/**
 * The Tutorials view (Diagram | Stencils | Tutorials): every track, its tutorials as cards and the progress made. A
 * card's one primary action starts it, or continues it where it was left; each runs on a practice diagram of its own.
 */
export function TutorialsView() {
  useLocale();
  const done = tutorials.filter((x) => savedProgress(x)?.completed).length;
  return (
    <div className="tutorials-view" data-testid="tutorials-view">
      <header className="tutorials-head">
        <h1>{t("tutorials.section")}</h1>
        <p>{t("tutorials.viewIntro")}</p>
        <div className="tutorials-overall" data-testid="tutorials-overall">
          <progress max={tutorials.length} value={done} aria-label={t("tutorials.section")} />
          <span>{t("tutorials.overall", { done, total: tutorials.length })}</span>
        </div>
      </header>
      {tracks.map((track) => {
        const list = tutorials.filter((x) => x.track === track.id);
        const finished = list.filter((x) => savedProgress(x)?.completed).length;
        return (
          <section
            key={track.id}
            className="tutorials-track"
            aria-labelledby={`tutorials-track-${track.id}`}
            data-testid={`tutorials-track-${track.id}`}
          >
            <div className="tutorials-track-head">
              <h2 id={`tutorials-track-${track.id}`}>{track.label()}</h2>
              {list.length > 0 && <span>{t("tutorials.trackProgress", { done: finished, total: list.length })}</span>}
            </div>
            <div className="tutorials-grid">
              {list.map((tutorial) => (
                <Card key={tutorial.id} tutorial={tutorial} />
              ))}
              {list.length === 0 && <p className="tutorials-soon">{t("tutorials.comingSoon")}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Card({ tutorial }: { tutorial: Tutorial }) {
  const progress = savedProgress(tutorial);
  const title = tutorial.title();
  const going = !!progress && !progress.completed && progress.step > 0;
  const open = () => tutorialRoute.open(tutorial.id);
  return (
    <article
      className={`tutorial-card${progress?.completed ? " is-done" : ""}`}
      data-testid={`tutorial-card-${tutorial.id}`}
      aria-labelledby={`tutorial-title-${tutorial.id}`}
    >
      <h3 id={`tutorial-title-${tutorial.id}`}>
        {progress?.completed && <Icon name="check" size={14} />}
        {title}
      </h3>
      <p>{tutorial.summary()}</p>
      <p className="tutorial-card-meta">
        {going
          ? t("tutorials.inProgress", { step: progress.step + 1, total: tutorial.steps.length })
          : progress?.completed
            ? t("tutorials.completed")
            : t("tutorials.levelMeta", { level: tutorial.level, minutes: tutorial.minutes })}
      </p>
      <div className="tutorial-card-actions">
        <button
          className="btn btn-primary"
          onClick={open}
          data-testid={`tutorial-open-${tutorial.id}`}
          aria-label={going ? t("tutorials.continueNamed", { title }) : t("tutorials.startNamed", { title })}
        >
          {going ? t("tutorials.continue") : progress?.completed ? t("tutorials.startAgain") : t("tutorials.start")}
        </button>
      </div>
    </article>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function tutorialsWhenReady() {
  await surfaceCatalogs(["tutorials"]);
  return TutorialsView;
}
