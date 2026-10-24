import { useLayoutEffect, useRef } from "react";
import { t } from "../i18n";
import type { LoadStatus } from "../lib/lazyLoad";
import type { ListProps } from "./MenuList";

/** The menu's focus and Escape stay available while its rows download. */
export function LoadingMenu({ anchor, label, testId, menuId, onCloseAll, status }: ListProps & { status: LoadStatus }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div
      ref={ref}
      className="cm"
      role="menu"
      tabIndex={-1}
      aria-label={label}
      id={menuId}
      data-testid={testId}
      aria-busy={!status.failed}
      style={{
        left: Math.max(8, Math.min(anchor.x, window.innerWidth - 240)),
        top: Math.max(8, Math.min(anchor.y, window.innerHeight - 130)),
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab" || (event.target !== event.currentTarget && event.key !== "Escape")) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") onCloseAll("escape");
      }}
    >
      <span role="status">{status.failed ? t("fileDialog.loadFailed") : t("common.loading")}</span>
      {status.failed && (
        <button data-testid="menu-load-retry" onClick={status.retry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
