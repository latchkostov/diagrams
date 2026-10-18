import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogInteraction } from "../../components/useDialogInteraction";
import { Glyph } from "./glyphs";
import { t } from "../../i18n";

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
  closable = true,
  restoreFocus,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId: string;
  width?: number;
  /** False: no close button, and Escape and the backdrop do nothing (the footer's choices are the only way out). */
  closable?: boolean;
  /** Focus goes back through this (an interaction controller's dialog.closed) instead of to the opener directly. */
  restoreFocus?: (opener: HTMLElement | null) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogInteraction(panel, backdrop, closable ? onClose : () => {}, restoreFocus);

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
            <h2 id={titleId} data-testid={`${testId}-title`}>
              {title}
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {closable && (
            <button
              className="icon-btn ix-dialog-close"
              onClick={onClose}
              aria-label={t("common.close")}
              data-testid={`${testId}-close`}
            >
              <Glyph name="close" size={14} />
            </button>
          )}
        </header>
        <div className="ix-dialog-body">{children}</div>
        {footer && <footer className="ix-dialog-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
