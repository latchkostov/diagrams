import { lazyComponent } from "../../lib/lazyLoad";
import { t } from "../../i18n";

export const EdgePanel = lazyComponent(
  () => import("./EdgePanel").then((m) => m.EdgePanel),
  (_props, status) => (
    <div className="insp-section" data-testid="inspector-edge-loading">
      {status.failed ? (
        <>
          {t("hover.failed")}{" "}
          <button className="link-btn" data-testid="inspector-edge-retry" onClick={status.retry}>
            {t("hover.retry")}
          </button>
        </>
      ) : (
        t("common.loading")
      )}
    </div>
  ),
);
