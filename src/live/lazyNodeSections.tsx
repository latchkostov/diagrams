import { defineLazySurface } from "../lib/lazySurface";
import { t } from "../i18n";

export const NodeSections = defineLazySurface({
  id: "live.sections",
  load: () => import("./NodeDetailSections").then((m) => m.nodeSectionsWhenReady()),
  placeholder: {
    size: {},
    testId: "live.sections-loading",
    render: (props, status) => (
      <div
        className="hover-rail-body"
        role={props.docked ? undefined : "status"}
        data-testid={props.docked ? "inspector-live-details-loading" : "hover-details-loading"}
      >
        {status.failed ? (
          <>
            {t("hover.failed")}{" "}
            <button
              data-testid={props.docked ? "inspector-live-details-retry" : "hover-details-retry"}
              onClick={status.retry}
            >
              {t("hover.retry")}
            </button>
          </>
        ) : (
          t("hover.loading")
        )}
      </div>
    ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
