import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { QUICK_PALETTE, THEME_PALETTE, SPECTRUM_GRID, normalizeHex, isValidHex } from "./colorPalette";
import { Icon } from "./Icon";
import "./colorPicker.css";

export interface ColorPickerModalProps {
  /** The current active color (hex or predefined hex). */
  currentColor: string;
  /** Fallback color when resetting/reverting. */
  defaultColor?: string;
  /** Bounding rect of trigger button for anchored positioning. */
  anchorRect?: DOMRect | null;
  /** Called when a color is chosen. */
  onSelect: (hex: string) => void;
  /** Called when modal requests close. */
  onClose: () => void;
}

export function ColorPickerModal({
  currentColor,
  defaultColor = "#64748B",
  anchorRect,
  onSelect,
  onClose,
}: ColorPickerModalProps) {
  const initialHex = normalizeHex(currentColor) ?? defaultColor;
  const [draftHex, setDraftHex] = useState(initialHex);
  const [lastValidHex, setLastValidHex] = useState(initialHex);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const valid = isValidHex(draftHex);
  const previewHex = normalizeHex(draftHex) ?? lastValidHex;

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Compute position relative to anchor or viewport
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 100, left: 100 });

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

      setPos({ top, left });
    } else {
      // Centered fallback
      setPos({
        top: Math.max(margin, (window.innerHeight - height) / 2),
        left: Math.max(margin, (window.innerWidth - width) / 2),
      });
    }
  }, [anchorRect]);

  // Click outside to close (committing valid or reverting invalid)
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (isValidHex(draftHex)) {
          const norm = normalizeHex(draftHex);
          if (norm) onSelect(norm);
        } else {
          onSelect(lastValidHex);
        }
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSelect(lastValidHex);
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [draftHex, lastValidHex, onSelect, onClose]);

  const handleHexChange = (val: string) => {
    setDraftHex(val);
    if (isValidHex(val)) {
      const norm = normalizeHex(val);
      if (norm) {
        setLastValidHex(norm);
        onSelect(norm);
      }
    }
  };

  const handleInputBlur = () => {
    if (isValidHex(draftHex)) {
      const norm = normalizeHex(draftHex);
      if (norm) {
        setDraftHex(norm);
        setLastValidHex(norm);
        onSelect(norm);
      }
    } else {
      // Revert to last valid
      setDraftHex(lastValidHex);
      onSelect(lastValidHex);
    }
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isValidHex(draftHex)) {
        const norm = normalizeHex(draftHex);
        if (norm) {
          onSelect(norm);
          onClose();
        }
      } else {
        setDraftHex(lastValidHex);
        onSelect(lastValidHex);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraftHex(lastValidHex);
      onSelect(lastValidHex);
      onClose();
    }
  };

  const handlePickSwatch = (hex: string) => {
    setDraftHex(hex);
    setLastValidHex(hex);
    onSelect(hex);
  };

  const handleReset = () => {
    setDraftHex(defaultColor);
    setLastValidHex(defaultColor);
    onSelect(defaultColor);
  };

  return createPortal(
    <div className="color-picker-layer" data-editor-overlay>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Color picker"
        className="color-picker-popover"
        style={{ top: `${pos.top}px`, left: `${pos.left}px` } as CSSProperties}
        data-testid="color-picker-modal"
      >
        <header className="color-picker-header">
          <span className="color-picker-title">Color</span>
          <button
            type="button"
            className="icon-btn color-picker-close"
            onClick={() => {
              if (isValidHex(draftHex)) {
                const norm = normalizeHex(draftHex);
                if (norm) onSelect(norm);
              } else {
                onSelect(lastValidHex);
              }
              onClose();
            }}
            title="Close"
            aria-label="Close color picker"
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
            title={`Preview: ${previewHex}`}
            data-testid="color-picker-preview"
          />
          <div className={`color-picker-input-wrap${!valid ? " is-invalid" : ""}`}>
            <span className="color-picker-hash">#</span>
            <input
              ref={inputRef}
              type="text"
              className="color-picker-input"
              value={draftHex.startsWith("#") ? draftHex.slice(1) : draftHex}
              onChange={(e) => handleHexChange(`#${e.target.value}`)}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              maxLength={8}
              placeholder="RRGGBB"
              data-testid="color-picker-hex-input"
              aria-label="Hex color code"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="icon-btn color-picker-reset-btn"
            onClick={handleReset}
            title="Reset to default color"
            aria-label="Reset to default color"
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
                  onClick={() => handlePickSwatch(hex)}
                  data-testid={`color-swatch-${hex}`}
                />
              );
            })}
            <button
              type="button"
              className="color-picker-swatch color-picker-clear-swatch"
              title="Clear / Default"
              aria-label="Clear / Default"
              onClick={handleReset}
              data-testid="color-swatch-clear"
            >
              <Icon name="close" size={10} />
            </button>
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
                      data-testid={`color-swatch-${hex}`}
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
                      data-testid={`color-swatch-${hex}`}
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
