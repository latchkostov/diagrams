import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { t } from "../i18n";
import type { LoadStatus } from "../lib/lazyLoad";

/**
 * The keyboard shortcuts sheet's frame while its code downloads (./ShortcutsDialog loads on first use), or after the
 * download failed: the same modal, so the canvas behind stays as it is. Esc and Close dismiss it, focus goes back to
 * what opened it, and Retry (after a failure) tries the download again.
 */
export function ShortcutsShell({ onClose, status }: { onClose: () => void; status: LoadStatus }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      } else if (e.key === "Tab") {
        const controls = Array.from(element.querySelectorAll<HTMLElement>("button"));
        e.preventDefault();
        if (!controls.length) return element.focus();
        const i = controls.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? controls.length - 1 : i - 1) : i + 1 >= controls.length ? 0 : i + 1;
        controls[next].focus();
      }
    };
    element.addEventListener("keydown", onKeyDown);
    const prev = document.activeElement as HTMLElement | null;
    element.focus();
    const background = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(element),
    );
    const inert = background.map((el) => el.inert);
    for (const el of background) el.inert = true;
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      background.forEach((el, i) => {
        el.inert = inert[i];
      });
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return createPortal(
    <div className="dlg-backdrop" data-editor-overlay>
      <div
        ref={panel}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-shell-title"
        tabIndex={-1}
        data-testid="lazy-dialog"
      >
        <header className="dlg-head">
          <Icon name="keyboard" />
          <h2 id="shortcuts-shell-title">{t("shortcuts.title")}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")} data-testid="lazy-dialog-close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="dlg-body">
          {status.failed ? (
            <p role="alert" data-testid="lazy-dialog-error">
              {t("fileDialog.loadFailed")}
            </p>
          ) : (
            <p role="status" className="ix-lazy-status" data-testid="lazy-dialog-loading">
              {t("common.loading")}
            </p>
          )}
        </div>
        {status.failed && (
          <footer className="dlg-foot">
            <button className="btn" onClick={onClose} data-testid="lazy-dialog-cancel">
              {t("common.close")}
            </button>
            <button className="btn btn-primary" onClick={status.retry} data-testid="lazy-dialog-retry">
              {t("common.retry")}
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
