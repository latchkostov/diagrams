import { useEffect, useReducer, useRef, useState } from "react";
import { useInteraction } from "../canvas/interaction";
import { t } from "../i18n";
import { loadOnce, type LoadStatus } from "../lib/lazyLoad";
import type { FloatingPlace, FloatingPlacement } from "./useFloatingPlacement";

// Recovering from a failed download never needs another download: this notice and its Retry ship in the live
// session's own chunk (LiveSession imports it statically), which is always loaded when trouble detection or a callout
// is asked for, since the session asks. Only the collision-aware placement downloads, on demand and optionally: until
// it arrives, or when it fails too, the notice sits where the callout styles (styles/capacity.css, loaded with
// LiveView) put it, and Retry asks for the placement again with the download it retries.
const loadPlacement = loadOnce(() => import("./useFloatingPlacement").then((m) => m.FloatingPlacement));

/** A background download failure stays recoverable through exports and other notifications. */
export function TroubleDownloadError({ retry }: { retry: () => void }) {
  const focused = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const [Placement, setPlacement] = useState<typeof FloatingPlacement>();
  const [placement, place] = useState<FloatingPlace>();
  const [attempt, again] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let active = true;
    loadPlacement().then(
      (component) => {
        if (active) setPlacement(() => component);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const interaction = useInteraction();
  useEffect(() => () => interaction?.dispatch({ type: "callout.closed", hadFocus: focused.current }), [interaction]);
  return (
    <>
      <div
        ref={box}
        className={`cap-callout is-floating${placement?.compact ? " is-compact" : ""}`}
        style={placement?.style}
        data-below={placement?.below ? "" : undefined}
        data-compact={placement?.compact ? "" : undefined}
        data-placed={placement ? "" : undefined}
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
        <button
          className="btn cap-callout-apply"
          data-testid="trouble-download-retry"
          onClick={() => {
            again();
            retry();
          }}
        >
          {t("common.retry")}
        </button>
      </div>
      {/* After the box, so its ref is set when the placement first measures it. */}
      {Placement && <Placement box={box} onPlace={place} />}
    </>
  );
}

/**
 * What a callout shows in its place when its own code failed to download: this notice, kept while Retry downloads it
 * again (and if that fails too), so the way back never disappears with a toast.
 */
export function CalloutUnavailable({ status }: { status: LoadStatus }) {
  const [failed, setFailed] = useState(status.failed);
  if (status.failed && !failed) setFailed(true);
  return failed ? <TroubleDownloadError retry={status.retry} /> : null;
}
