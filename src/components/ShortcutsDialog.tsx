import { useEffect, useLayoutEffect, useRef } from "react";
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

/** Live view and presenting keys (handled by the live view and the app, not the editor). */
const LIVE: [string, string][] = [
  ["L", "Go live / back to editing"],
  ["C", "Show capacity: colour nodes by how busy they are"],
  ["Space", "Play or pause; continue after a note"],
  ["Esc", "Leave presentation, then live view"],
];

function displayKeys(s: Shortcut): string[] {
  if (s.id === "nudge") return ["← ↑ → ↓"];
  if (s.id === "nudge-far") return [`${formatCombo("Shift")} ← ↑ → ↓`];
  return s.keys.map((k) => formatCombo(k));
}

/** Keyboard cheat sheet, opened with `?`. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const panelElement = panel.current;
    const backdropElement = backdrop.current;
    if (!panelElement || !backdropElement) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Tab") {
        const controls = Array.from(
          panelElement.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled") && !el.hidden);
        const first = controls[0] ?? panelElement;
        const last = controls.at(-1) ?? panelElement;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelElement)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panelElement)) {
          e.preventDefault();
          first.focus();
        }
      }
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        close.current();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (e.target === backdropElement) close.current();
    };
    const preventContextMenu = (e: Event) => e.preventDefault();
    panelElement.addEventListener("keydown", onKeyDown);
    backdropElement.addEventListener("mousedown", onPointerDown);
    backdropElement.addEventListener("contextmenu", preventContextMenu);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const background = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(panel.current),
    );
    const previous = background.map((el) => el.inert);
    for (const el of background) el.inert = true;
    return () => {
      panelElement.removeEventListener("keydown", onKeyDown);
      backdropElement.removeEventListener("mousedown", onPointerDown);
      backdropElement.removeEventListener("contextmenu", preventContextMenu);
      background.forEach((el, i) => {
        el.inert = previous[i];
      });
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  return createPortal(
    <div ref={backdrop} className="dlg-backdrop" data-editor-overlay>
      <div
        ref={panel}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        data-testid="shortcuts-dialog"
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
            <h3>Live and presenting</h3>
            {LIVE.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v}</span>
                <span className="sc-keys">
                  <kbd>{k}</kbd>
                </span>
              </div>
            ))}
          </section>
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
