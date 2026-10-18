import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Shared keyboard, inertness and opener lifecycle for modal surfaces. */
export function useDialogInteraction(
  panel: RefObject<HTMLDivElement | null>,
  backdrop: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  /** Hands focus back through an interaction controller instead (it gets what had focus as the dialog opened). */
  restoreFocus?: (opener: HTMLElement | null) => void,
) {
  const restoreRef = useRef(restoreFocus);
  useLayoutEffect(() => {
    restoreRef.current = restoreFocus;
  });
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  // Native listeners (like ShortcutsDialog): Escape closes, Tab stays inside, the page behind is inert.
  useEffect(() => {
    const panelEl = panel.current;
    const backdropEl = backdrop.current;
    if (!panelEl || !backdropEl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // An inline editor inside the dialog (e.g. a rename field) owns Enter and Esc.
      if ((e.key === "Escape" || e.key === "Enter") && (e.target as Element).closest?.("[data-local-keys]")) return;
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === "Tab") {
        const controls = Array.from(
          panelEl.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled") && !el.hidden && el.tabIndex >= 0);
        const first = controls[0] ?? panelEl;
        const last = controls.at(-1) ?? panelEl;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelEl)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.target === backdropEl) {
        e.preventDefault();
        closeRef.current();
      }
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    panelEl.addEventListener("keydown", onKeyDown);
    backdropEl.addEventListener("mousedown", onMouseDown);
    backdropEl.addEventListener("contextmenu", onContextMenu);
    const prev = document.activeElement as HTMLElement | null;
    // A primary action that's still getting ready (Copy link while the link is made) can't take focus: the panel
    // does, so Esc and Tab work at once, and the dialog hands focus on when it's ready (dialogs.tsx, useFocusWhenReady).
    const auto = panelEl.querySelector<HTMLElement>("[data-autofocus]");
    (auto && !auto.matches(":disabled") ? auto : panelEl).focus();
    if (auto instanceof HTMLInputElement && auto.hasAttribute("data-autoselect")) auto.select();
    const background = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(backdropEl),
    );
    const wasInert = background.map((el) => el.inert);
    for (const el of background) el.inert = true;
    return () => {
      panelEl.removeEventListener("keydown", onKeyDown);
      backdropEl.removeEventListener("mousedown", onMouseDown);
      backdropEl.removeEventListener("contextmenu", onContextMenu);
      background.forEach((el, i) => (el.inert = wasInert[i]));
      if (restoreRef.current) return restoreRef.current(prev && prev !== document.body ? prev : null);
      // What opened it may be gone (a toast's button: the toast closes as it acts, or fades): the canvas, not the
      // page, gets the keyboard back.
      if (prev && prev !== document.body && prev.isConnected && !prev.closest("[data-toast]")) prev.focus();
      else document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
    };
  }, [panel, backdrop]);
}
