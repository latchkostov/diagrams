import { Dialog } from "../interop/ui/Dialog";
import { t } from "../i18n";
import type { LoadStatus } from "../lib/lazyLoad";

/** Keep the real modal boundary, cancellation and Retry outside the downloaded writer. */
export function SequenceLoading({ onClose, status }: { onClose(): void; status: LoadStatus }) {
  return (
    <Dialog
      title={t("planning.sequence.title")}
      testId="lazy-dialog"
      onClose={onClose}
      footer={
        status.failed && (
          <button className="btn btn-primary" data-testid="lazy-dialog-retry" onClick={status.retry}>
            {t("common.retry")}
          </button>
        )
      }
    >
      {status.failed ? (
        <p role="alert" data-testid="lazy-dialog-error">
          {t("fileDialog.loadFailed")}
        </p>
      ) : (
        <p role="status" data-testid="lazy-dialog-loading">
          {t("common.loading")}
        </p>
      )}
    </Dialog>
  );
}
