// The Fullscreen API for presenting (src/canvas/PresentFullscreen.tsx). The whole page goes full screen
// (the document element), so the live view, slow motion, the trace, dialogs and toasts (some portalled to
// <body>) stay on screen, and the theme's background is the page's own.
import { useSyncExternalStore } from "react";
import { isEditableTarget } from "../editor/shortcuts";

/**
 * Whether this page may go full screen: false in an iframe without `allow="fullscreen"`, and on iOS Safari
 * (which only lets videos), where the button isn't shown.
 */
export const fullscreenAvailable = (doc: Document = document): boolean =>
  doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === "function";

export const isFullscreen = (doc: Document = document): boolean => !!doc.fullscreenElement;

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

const snapshot = () => isFullscreen();

/** True while the page is full screen, however it got there or left (the button, F, Esc, F11). */
export const useFullscreen = (): boolean => useSyncExternalStore(subscribe, snapshot, () => false);

/**
 * Enters or leaves full screen. A refusal (no user gesture, a policy) changes nothing and throws nothing. Entering
 * takes a moment: when `wanted` says no by the time it has (the presentation ended meanwhile), it leaves again.
 */
export function toggleFullscreen(doc: Document = document, wanted: () => boolean = () => true): Promise<void> {
  if (doc.fullscreenElement) return doc.exitFullscreen().catch(() => {});
  return doc.documentElement.requestFullscreen().then(
    () => {
      if (!wanted()) exitFullscreen(doc);
    },
    () => {},
  );
}

export function exitFullscreen(doc: Document = document): void {
  if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
}

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "defaultPrevented" | "isComposing" | "target"
>;

/** F (or Shift+F) on its own, outside a text field: the presenter's full-screen key. */
export const isFullscreenKey = (e: KeyEventLike): boolean =>
  e.key.toLowerCase() === "f" &&
  !e.ctrlKey &&
  !e.metaKey &&
  !e.altKey &&
  !e.repeat &&
  !e.defaultPrevented &&
  !e.isComposing &&
  !isEditableTarget(e.target);
