import { InjectFrame } from "./InjectFrame";
import { t } from "../i18n";
import type { LoadStatus } from "../lib/lazyLoad";
import type { InjectRequest } from "./InjectDialog";

/** The real injection frame owns focus from the moment Custom is selected. */
export function InjectLoading({
  request,
  onClose,
  status,
}: {
  request: InjectRequest;
  onClose(): void;
  status: LoadStatus;
}) {
  return (
    <InjectFrame
      request={request}
      onClose={onClose}
      title={t("common.loading")}
      loading
      actions={
        status.failed && (
          <button type="button" className="btn" data-testid="inject-loading-retry" onClick={status.retry}>
            {t("common.retry")}
          </button>
        )
      }
    >
      {status.failed ? (
        <p role="alert">{t("fileDialog.loadFailed")}</p>
      ) : (
        <p role="status" data-testid="inject-loading-status">
          {t("common.loading")}
        </p>
      )}
    </InjectFrame>
  );
}
