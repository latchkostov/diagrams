import { useState, type KeyboardEvent } from "react";
import { examples, type Example } from "../examples";
import { exampleFeatures, exampleThemeLabel, filterExamples } from "../examples/gallery";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { Dialog } from "../interop/ui/Dialog";
import { t, useLocale } from "../i18n";
import "../styles/examples.css";

export function ExamplesDialog({
  onClose,
  onOpen,
  catalog = examples,
}: {
  catalog?: readonly Example[];
  onClose: () => void;
  onOpen: (slug: string, simulation?: string) => void;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [feature, setFeature] = useState("");
  const sections = filterExamples(catalog, query, feature);
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
    <Dialog
      title={t("topbar.examples")}
      subtitle={t("examples.intro")}
      onClose={onClose}
      testId="examples-dialog"
      width={960}
    >
      <div className="examples-filters">
        <label>
          <span className="sr-only">{t("examples.search")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("examples.search")}
            data-testid="examples-search"
            data-autofocus
          />
        </label>
        <label>
          <span>{t("examples.shows")}</span>
          <select value={feature} onChange={(e) => setFeature(e.target.value)} data-testid="examples-feature">
            <option value="">{t("examples.allFeatures")}</option>
            {exampleFeatures.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="examples-results" data-testid="examples-results">
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
                    <p>{ex.summary ?? ex.description}</p>
                    <div className="example-tags">
                      {ex.shows?.map((id) => (
                        <span key={id}>{exampleFeatures.find((f) => f.id === id)?.label() ?? id}</span>
                      ))}
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
    </Dialog>
  );
}
