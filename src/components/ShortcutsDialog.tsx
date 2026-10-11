import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatCombo, SHORTCUTS, type Shortcut } from "../editor/shortcuts";
import { Icon } from "./Icon";

const GROUPS: Shortcut["group"][] = ["Edit", "Clipboard", "Selection", "View", "Help"];

const MOUSE: [string, string][] = [
  ["Right-click", "Context menu for the canvas, a node, an edge or a boundary"],
  ["Double-click canvas", "Quick-add a stencil at the cursor"],
  ["Double-click node / edge", "Rename / edit label"],
  ["Shift + drag", "Box-select"],
  ["Ctrl / ⌘ + click", "Add to selection"],
  ["Drag from a handle", "Connect to another node (any side)"],
];

function displayKeys(s: Shortcut): string[] {
  if (s.id === "nudge") return ["← ↑ → ↓"];
  if (s.id === "nudge-far") return [`${formatCombo("Shift")} ← ↑ → ↓`];
  return s.keys.map((k) => formatCombo(k));
}

/** Keyboard cheat sheet, opened with `?`. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => prev?.focus?.();
  }, []);

  return createPortal(
    <div
      className="dlg-backdrop"
      data-editor-overlay
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={panel}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        data-testid="shortcuts-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || e.key === "?") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <header className="dlg-head">
          <Icon name="keyboard" />
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" data-testid="shortcuts-dialog-close">
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="dlg-body sc-grid">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.id} className="sc-row">
                  <span>{s.label}</span>
                  <span className="sc-keys">
                    {displayKeys(s).map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
          <section>
            <h3>Mouse</h3>
            {MOUSE.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v}</span>
                <span className="sc-keys">
                  <kbd>{k}</kbd>
                </span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
