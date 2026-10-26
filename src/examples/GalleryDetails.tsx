import type { KeyboardEvent } from "react";
import { DiagramThumbnail } from "../components/DiagramThumbnail";
import { exampleFeatures, exampleThemeLabel, filterExamples, gallerySummary } from "./gallery";
import { withExampleDetails } from "./details";
import { t } from "../i18n";
import type { DiscoveryGalleryProps } from "./discovery";
import { exampleTutorials } from "./tutorials";
import { tutorialRoute } from "../tutorials/route";

export function GalleryDetails({ catalog, query, feature, onOpen, onTutorials }: DiscoveryGalleryProps) {
  const sections = filterExamples(withExampleDetails(catalog), query, feature);
  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute("data-example-action")) return;
    const actions = Array.from(
      event.currentTarget
        .closest("[data-testid=examples-results]")
        ?.querySelectorAll<HTMLButtonElement>("[data-example-action]") ?? [],
    );
    const index = actions.indexOf(event.target);
    const horizontal = document.documentElement.dir === "rtl" ? -1 : 1;
    const step =
      event.key === "ArrowRight"
        ? horizontal
        : event.key === "ArrowLeft"
          ? -horizontal
          : event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowUp"
              ? -1
              : 0;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? actions.length - 1
          : step
            ? (index + step + actions.length) % actions.length
            : -1;
    if (next < 0) return;
    event.preventDefault();
    actions[next]?.focus();
  };
  return (
    <div className="examples-results" data-testid="examples-results">
      {onTutorials && !query && !feature && (
        <p className="examples-tutorials-link" data-testid="examples-tutorials">
          {t("tutorials.examplesLink")}{" "}
          <button className="link-btn" onClick={onTutorials} data-testid="examples-open-tutorials">
            {t("tutorials.openTutorials")}
          </button>
        </p>
      )}
      {sections.length === 0 && (
        <p role="status" data-testid="examples-empty">
          {t("examples.empty")}
        </p>
      )}
      {sections.map(({ theme, items }) => (
        <section
          key={theme?.id ?? "other"}
          aria-labelledby={`examples-theme-${theme?.id ?? "other"}`}
          data-testid={`examples-theme-${theme?.id ?? "other"}`}
        >
          <h3 id={`examples-theme-${theme?.id ?? "other"}`}>
            {theme ? exampleThemeLabel(theme.id) : t("topbar.examples")}
          </h3>
          <div className="examples-grid">
            {items.map((ex) => (
              <article
                key={ex.slug}
                className="example-card"
                data-testid={`example-card-${ex.slug}`}
                aria-labelledby={`example-title-${ex.slug}`}
              >
                <div className="example-card-thumb">
                  <DiagramThumbnail thumb={ex.thumb} testId={`example-thumb-${ex.slug}`} />
                </div>
                <div className="example-card-body">
                  <h4 id={`example-title-${ex.slug}`}>{ex.title}</h4>
                  <p>{gallerySummary(ex)}</p>
                  <div className="example-tags">
                    {ex.shows?.map((id) => (
                      <span key={id}>{exampleFeatures.find((f) => f.id === id)?.label() ?? id}</span>
                    ))}
                    {exampleTutorials[ex.slug] && (
                      <button
                        className="link-btn"
                        data-testid={`example-tutorial-${ex.slug}`}
                        onClick={() => tutorialRoute.open(exampleTutorials[ex.slug])}
                        aria-labelledby={`example-tutorial-label-${ex.slug} example-title-${ex.slug}`}
                      >
                        <span id={`example-tutorial-label-${ex.slug}`}>{t("tutorials.exampleChip")}</span>
                      </button>
                    )}
                  </div>
                  <div className="example-card-actions">
                    <button
                      className="btn btn-primary"
                      data-testid={`example-open-${ex.slug}`}
                      data-example-action
                      onKeyDownCapture={navigate}
                      onClick={() => onOpen(ex.slug)}
                      aria-label={t("examples.openNamed", { title: ex.title })}
                    >
                      {t("fileDialog.open")}
                    </button>
                    {ex.simulation && (
                      <button
                        className="btn btn-ghost"
                        data-testid={`example-run-${ex.slug}`}
                        data-example-action
                        onKeyDownCapture={navigate}
                        onClick={() => onOpen(ex.slug, ex.simulation)}
                        aria-labelledby={`example-run-label-${ex.slug} example-title-${ex.slug}`}
                      >
                        <span id={`example-run-label-${ex.slug}`}>{t("examples.run")}</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
