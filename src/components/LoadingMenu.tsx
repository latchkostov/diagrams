import { t } from "../i18n";
import { useLayoutEffect } from "react";
import type { ListProps } from "./ContextMenu";
import type { LoadStatus } from "../lib/lazyLoad";

/** The existing menu layer stays cancellable while its rows download. */
export function LoadingMenu(p: ListProps & { status: LoadStatus }) {
  const { pendingInput, status } = p;
  useLayoutEffect(() => {
    pendingInput?.failed(status.failed);
    return () => pendingInput?.failed(false);
  }, [pendingInput, status.failed]);
  return (
    <div
      className="cm"
      role="menu"
      aria-label={p.label}
      aria-busy={!p.status.failed}
      data-testid={`${p.testId}-loading`}
      style={{ left: p.anchor.x, top: p.anchor.y, minWidth: p.anchor.minWidth }}
    >
      <div className="cm-empty">
        {p.status.failed ? (
          <button data-testid="menu-load-retry" onClick={p.status.retry}>
            {t("common.retry")}
          </button>
        ) : (
          t("common.loading")
        )}
      </div>
    </div>
  );
}
