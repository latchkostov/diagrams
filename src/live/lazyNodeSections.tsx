import { lazyComponent } from "../lib/lazyLoad";
import { t } from "../i18n";

export const NodeSections = lazyComponent(
  () => import("./NodeDetailSections").then((m) => m.NodeDetailSections),
  (props, status) => (
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
);
