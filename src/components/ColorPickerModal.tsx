import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { QUICK_PALETTE, THEME_PALETTE, SPECTRUM_GRID, normalizeHex, isValidHex } from "./colorPalette";
import { useDialogInteraction } from "./useDialogInteraction";
import { t, useLocale } from "../i18n";
import { Icon } from "./Icon";
import "./colorPicker.css";

export interface ColorPickerModalProps {
  /** The current active color (hex or predefined hex). */
  currentColor?: string;
  /** Fallback color when resetting/reverting. */
  defaultColor?: string;
  /** Bounding rect of trigger button for anchored positioning. */
  anchorRect?: DOMRect | null;
  /** Called when a color is chosen. */
  onSelect: (hex: string) => void;
  /** Optional callback when the clear/reset button is clicked. */
  onReset?: () => void;
  /** Called when modal requests close. */
  onClose: () => void;
}

export function ColorPickerModal({
  currentColor,
  defaultColor = "#64748B",
  anchorRect,
  onSelect,
  onReset,
  onClose,
}: ColorPickerModalProps) {
  useLocale();
  const initialHex = normalizeHex(currentColor ?? "") ?? defaultColor;
  const [draftHex, setDraftHex] = useState(initialHex);
  const [lastValidHex, setLastValidHex] = useState(initialHex);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(normalizeHex(currentColor ?? ""));
  useDialogInteraction(panelRef, backdropRef, onClose);
  const inputRef = useRef<HTMLInputElement>(null);

  const valid = isValidHex(draftHex);
  const previewHex = normalizeHex(draftHex) ?? lastValidHex;

  // Compute position relative to anchor or viewport

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const width = el.offsetWidth || 280;
    const height = el.offsetHeight || 380;
    const margin = 12;

    if (anchorRect) {
      // Place to the left or below anchor so it doesn't get clipped by viewport
      let left = anchorRect.left - width + anchorRect.width;
      if (left < margin) left = margin;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;

      let top = anchorRect.bottom + 6;
      if (top + height > window.innerHeight - margin) {
        top = anchorRect.top - height - 6;
      }
      if (top < margin) top = margin;

      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
    } else {
      // Centered fallback
      el.style.top = `${Math.max(margin, (window.innerHeight - height) / 2)}px`;
      el.style.left = `${Math.max(margin, (window.innerWidth - width) / 2)}px`;
    }
  }, [anchorRect]);

  const emit = (hex: string) => {
    if (lastEmitted.current === hex) return;
    lastEmitted.current = hex;
    onSelect(hex);
  };

  const handleHexChange = (val: string) => {
    setDraftHex(val);
    if (isValidHex(val)) {
      const norm = normalizeHex(val);
      if (norm) {
        setLastValidHex(norm);
        emit(norm);
      }
    }
  };

  const handleInputBlur = () => setDraftHex(normalizeHex(draftHex) ?? lastValidHex);

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
  };

  const handlePickSwatch = (hex: string) => {
    setDraftHex(hex);
    setLastValidHex(hex);
    emit(hex);
  };

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else {
      setDraftHex(defaultColor);
      setLastValidHex(defaultColor);
      emit(defaultColor);
    }
  };

  return createPortal(
    <div ref={backdropRef} className="color-picker-layer" data-editor-overlay data-testid="color-picker-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("menu.colour")}
        tabIndex={-1}
        className="color-picker-popover"
        data-testid="color-picker-modal"
      >
        <header className="color-picker-header">
          <span className="color-picker-title">{t("menu.colour")}</span>
          <button
            type="button"
            className="icon-btn color-picker-close"
            onClick={onClose}
            title={t("common.close")}
            aria-label={t("common.close")}
            data-testid="color-picker-close"
          >
            <Icon name="close" size={12} />
          </button>
        </header>

        {/* Hex input row */}
        <div className="color-picker-hex-row">
          <span
            className="color-picker-preview"
            style={{ backgroundColor: previewHex }}
            title={previewHex}
            data-testid="color-picker-preview"
          />
          <div className={`color-picker-input-wrap${!valid ? " is-invalid" : ""}`}>
            <span className="color-picker-hash">#</span>
            <input
              ref={inputRef}
              type="text"
              className="color-picker-input"
              value={draftHex.startsWith("#") ? draftHex.slice(1) : draftHex}
              onChange={(e) => handleHexChange(e.target.value)}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              maxLength={9}
              // eslint-disable-next-line local/no-literal-ui-text -- hex digit notation, not prose
              placeholder="RRGGBB"
              data-testid="color-picker-hex-input"
              aria-invalid={!valid}
              aria-label={t("chrome.hexColour")}
              data-autofocus
              data-autoselect
              data-local-keys
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="icon-btn color-picker-reset-btn"
            onClick={handleReset}
            title={t("chrome.resetColour")}
            aria-label={t("chrome.resetColour")}
            data-testid="color-picker-reset"
          >
            <Icon name="reset" size={13} />
          </button>
        </div>

        {/* Quick / Recent row */}
        <div className="color-picker-section">
          <div className="color-picker-grid color-picker-grid-quick" data-testid="color-picker-quick-grid">
            {QUICK_PALETTE.map((hex) => {
              const active = previewHex.toUpperCase() === hex.toUpperCase();
              return (
                <button
                  key={hex}
                  type="button"
                  className={`color-picker-swatch${active ? " is-active" : ""}`}
                  style={{ backgroundColor: hex }}
                  title={hex}
                  aria-label={hex}
                  aria-pressed={active}
                  onClick={() => handlePickSwatch(hex)}
                  data-testid={`color-swatch-quick-${hex}`}
                />
              );
            })}
          </div>
        </div>

        {/* Pastel theme palette */}
        <div className="color-picker-section">
          <div className="color-picker-grid-stacked" data-testid="color-picker-theme-grid">
            {THEME_PALETTE.map((row, rIdx) => (
              <div key={rIdx} className="color-picker-grid-row">
                {row.map((hex) => {
                  const active = previewHex.toUpperCase() === hex.toUpperCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      className={`color-picker-swatch${active ? " is-active" : ""}`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                      aria-label={hex}
                      onClick={() => handlePickSwatch(hex)}
                      aria-pressed={active}
                      data-testid={`color-swatch-theme-${hex}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 10x10 Full Spectrum grid */}
        <div className="color-picker-section color-picker-spectrum-wrap">
          <div className="color-picker-grid-stacked" data-testid="color-picker-spectrum-grid">
            {SPECTRUM_GRID.map((row, rIdx) => (
              <div key={rIdx} className="color-picker-grid-row">
                {row.map((hex) => {
                  const active = previewHex.toUpperCase() === hex.toUpperCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      className={`color-picker-swatch${active ? " is-active" : ""}`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                      aria-label={hex}
                      onClick={() => handlePickSwatch(hex)}
                      aria-pressed={active}
                      data-testid={`color-swatch-spectrum-${hex}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
