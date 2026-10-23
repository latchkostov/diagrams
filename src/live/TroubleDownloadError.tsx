import { useEffect, useRef } from "react";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";
import { useFloatingPlacement } from "./useFloatingPlacement";

/** A background download failure stays recoverable through exports and other notifications. */
export function TroubleDownloadError({ retry }: { retry: () => void }) {
  const focused = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(box, true);
  const interaction = useInteraction();
  useEffect(() => () => interaction?.dispatch({ type: "callout.closed", hadFocus: focused.current }), [interaction]);
  return (
    <div
      ref={box}
      className={`cap-callout is-floating${placement.compact ? " is-compact" : ""}`}
      style={placement.style}
      data-below={placement.below ? "" : undefined}
      data-compact={placement.compact ? "" : undefined}
      data-canvas-overlay=""
      data-editor-overlay
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
