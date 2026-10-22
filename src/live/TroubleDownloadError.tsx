import { useEffect, useRef } from "react";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";

/** A background download failure stays recoverable through exports and other notifications. */
export function TroubleDownloadError({ retry }: { retry: () => void }) {
  const focused = useRef(false);
  const interaction = useInteraction();
  useEffect(() => () => interaction?.dispatch({ type: "callout.closed", hadFocus: focused.current }), [interaction]);
  return (
    <div
      className="cap-callout is-floating"
      data-testid="trouble-download-error"
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused.current = false;
      }}
    >
      <span role="status">{t("resilience.troubleUnavailable")}</span>
      <button className="btn cap-callout-apply" data-testid="trouble-download-retry" onClick={retry}>
        {t("common.retry")}
      </button>
    </div>
  );
}
