import { useCallback, useEffect, useRef } from "react";
import {
  exitFullscreen,
  fullscreenAvailable,
  isFullscreenKey,
  toggleFullscreen,
  useFullscreen,
} from "../lib/fullscreen";
import { t } from "../i18n";

// The usual full-screen glyphs, on the 16 px grid of src/components/Icon.tsx: corners out, and corners in.
const ENTER = "M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3";
const EXIT = "M5.5 2.5v3h-3M13.5 5.5h-3v-3M10.5 13.5v-3h3M2.5 10.5h3v3";

/**
 * The presenter's full-screen toggle, beside "Exit presentation" (mounted only while presenting). F toggles it.
 * Esc while full screen leaves full screen only (src/lib/fullscreenEscape.ts). Leaving the presentation leaves full
 * screen too, even when it ends while full screen is still on its way.
 */
export function PresentFullscreen() {
  const on = useFullscreen();
  const available = fullscreenAvailable();
  const presenting = useRef(false);
  const toggle = useCallback(() => void toggleFullscreen(document, () => presenting.current), []);

  useEffect(() => {
    presenting.current = true;
    const onKey = (e: KeyboardEvent) => {
      if (!isFullscreenKey(e) || !fullscreenAvailable()) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      presenting.current = false;
      window.removeEventListener("keydown", onKey);
      exitFullscreen();
    };
  }, [toggle]);

  if (!available) return null;
  const label = on ? t("present.exitFullScreen") : t("present.fullScreen");
  return (
    <button
      className="present-fs"
      onClick={toggle}
      aria-label={label}
      aria-keyshortcuts="F"
      title={on ? t("present.exitFullScreenKey", { key: "F" }) : t("present.fullScreenKey", { key: "F" })}
      data-state={on ? "on" : "off"}
      data-canvas-overlay
      data-testid="present-fullscreen"
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={on ? EXIT : ENTER} />
      </svg>
    </button>
  );
}
