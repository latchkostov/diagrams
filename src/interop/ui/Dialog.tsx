import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./glyphs";

/** Modal shell shared by the share / embed / paste / page-picker dialogs. */
export function Dialog({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  testId,
  width = 560,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId: string;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
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
        ).filter((el) => !el.hasAttribute("disabled") && !el.hidden);
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
      if (e.target === backdropEl) closeRef.current();
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    panelEl.addEventListener("keydown", onKeyDown);
    backdropEl.addEventListener("mousedown", onMouseDown);
    backdropEl.addEventListener("contextmenu", onContextMenu);
    const prev = document.activeElement as HTMLElement | null;
    (panelEl.querySelector<HTMLElement>("[data-autofocus]") ?? panelEl).focus();
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
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  return createPortal(
    <div ref={backdrop} className="ix-backdrop" data-editor-overlay>
      <div
        ref={panel}
        className="ix-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        data-testid={testId}
      >
        <header className="ix-dialog-head">
          {icon && <span className="ix-dialog-icon">{icon}</span>}
          <div className="ix-dialog-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-btn ix-dialog-close"
            onClick={onClose}
            aria-label="Close"
            data-testid={`${testId}-close`}
          >
            <Glyph name="close" size={14} />
          </button>
        </header>
        <div className="ix-dialog-body">{children}</div>
        {footer && <footer className="ix-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
