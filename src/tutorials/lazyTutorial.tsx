import { defineLazySurface } from "../lib/lazySurface";
import { t } from "../i18n";

/**
 * The tutorial view, downloaded when a tutorial opens (`?tutorial=<id>`): none of it is in the app's first view. Until
 * it arrives (or if the download fails: the shared toast offers Retry) a bar of the same shape stands in, with its
 * Exit, so there's always a way back.
 */
export const TutorialSurface = defineLazySurface<{ id: string; onExit(): void }>({
  id: "tutorial.app",
  load: () => import("./TutorialApp").then((m) => m.TutorialApp),
  placeholder: {
    render: ({ onExit }, status) => (
      <div className="app" data-testid="tutorial-app-loading" aria-busy={!status.failed}>
        <header className="topbar">
          <span role="status">{t("tutorials.loading")}</span>
          <div className="topbar-spacer" />
          <button className="btn" onClick={onExit} data-testid="tutorial-exit">
            {t("tutorials.exit")}
          </button>
        </header>
      </div>
    ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
