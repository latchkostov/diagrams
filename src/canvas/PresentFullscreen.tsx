import { useEffect } from "react";
import {
  exitFullscreen,
  fullscreenAvailable,
  isFullscreenKey,
  toggleFullscreen,
  useFullscreen,
} from "../lib/fullscreen";

// The usual full-screen glyphs, on the 16 px grid of src/components/Icon.tsx: corners out, and corners in.
const ENTER = "M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3";
const EXIT = "M5.5 2.5v3h-3M13.5 5.5h-3v-3M10.5 13.5v-3h3M2.5 10.5h3v3";

/**
 * The presenter's full-screen toggle, beside "Exit presentation" (mounted only while presenting). F toggles it.
 * Esc while full screen leaves full screen only: browsers take that Esc themselves, and when one doesn't, this
 * does, so one Esc never also leaves the presentation. Leaving the presentation leaves full screen too.
 */
export function PresentFullscreen() {
  const on = useFullscreen();
  const available = fullscreenAvailable();

  useEffect(() => {
    // Capture, ahead of the app's Esc (which leaves the presentation) and every other layer's.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !document.fullscreenElement) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      exitFullscreen();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isFullscreenKey(e) || !fullscreenAvailable()) return;
      e.preventDefault();
      void toggleFullscreen();
    };
    window.addEventListener("keydown", onEsc, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("keydown", onKey);
      exitFullscreen();
    };
  }, []);

  if (!available) return null;
  const label = on ? "Exit full screen" : "Full screen";
  return (
    <button
      className="present-fs"
      onClick={() => void toggleFullscreen()}
      aria-label={label}
      aria-keyshortcuts="F"
      title={`${label} (F)`}
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
