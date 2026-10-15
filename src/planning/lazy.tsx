import { lazyComponent, loadOnce } from "../lib/lazyLoad";
import { t } from "../i18n";

const loadPlanning = loadOnce(() => import("./ui"));
export const NodePlanning = lazyComponent(
  () => loadPlanning().then((m) => m.NodePlanning),
  (_props, status) => (
    <div className="insp-note" role="status" data-testid="planning-loading">
      {status.failed ? (
        <>
          {t("planning.loadFailed")}{" "}
          <button className="link-btn" onClick={status.retry} data-testid="planning-load-retry">
            {t("planning.retry")}
          </button>
        </>
      ) : (
        t("planning.loading")
      )}
    </div>
  ),
);
export const PlanningUpgrade = lazyComponent(() => loadPlanning().then((m) => m.PlanningUpgrade));
export const AdmissionFields = lazyComponent(() => loadPlanning().then((m) => m.AdmissionFields));

export const BulkAdmissionFields = lazyComponent(() => loadPlanning().then((m) => m.BulkAdmissionFields));

export const AutoscalingFields = lazyComponent(() => loadPlanning().then((m) => m.AutoscalingFields));
