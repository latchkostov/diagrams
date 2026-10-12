import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatCombo, SHORTCUTS, type Shortcut } from "../editor/shortcuts";
import { Icon } from "./Icon";

const GROUPS: Shortcut["group"][] = ["Edit", "Clipboard", "Selection", "View", "Help"];

const MOUSE: [string, string][] = [
  ["Right-click", "Context menu for the canvas, a node, an edge or a boundary"],
  ["Double-click canvas", "Quick-add a stencil at the cursor"],
  ["Double-click node / edge", "Rename / edit label"],
  ["Drag on the canvas", "Select what the box touches"],
  ["Ctrl / ⌘ + drag on the canvas", "Select only what's inside"],
  ["Shift / Ctrl / ⌘ + click", "Add to or take from the selection"],
  ["Scroll, two-finger swipe", "Pan (Shift + scroll: sideways)"],
  ["Ctrl / ⌘ + scroll, pinch", "Zoom"],
  ["Space + drag, middle-drag", "Pan from anywhere"],
  ["Drag from a handle", "Connect; on empty canvas, add a node"],
  ["Click a selected node's +", "Add the next node, connected"],
  ["Drag a selected edge's end", "Move that end to another node"],
  ["Hold a node or stencil on an edge", "Drop to insert it there"],
  ["Drag a node", "Lines up with others and equal gaps"],
  ["Ctrl / ⌘ while dragging", "Move freely, no snapping"],
  ["Alt + drag", "Duplicate"],
];

/** Inline editors: every text box on the canvas follows the same keys (src/components/editKeys.ts). */
const TEXT: [string, string][] = [
  ["Enter", "Save (a text or note: new line)"],
  ["Mod+Enter", "Save a text or note"],
  ["Tab", "Next field (label, subtitle), then save"],
  ["Esc", "Save and close; Ctrl+Z takes it back"],
];

/** Live view and presenting keys (handled by the live view and the app, not the editor). */
const LIVE: [string, string][] = [
  ["L", "Go live / back to editing"],
  ["Drag", "Pan the canvas"],
  ["C", "Show capacity: colour nodes by how busy they are"],
  ["Space", "Play or pause; continue after a note"],
  ["Esc", "Leave presentation, then live view"],
];

/** The AI panel (AiMount opens it; Advanced handles the rest). */
const AI: [string, string][] = [
  ["Mod+I", "Show the AI panel and focus it; from inside it, hide it"],
  ["Mod+Shift+M", "Dictate in Advanced, or stop dictating"],
  ["Mod+Enter", "Apply the reply pasted in Advanced"],
  ["Esc", "Stop dictating, then back to the canvas"],
];

function displayKeys(s: Shortcut): string[] {
  if (s.id === "nudge") return ["← ↑ → ↓"];
  if (s.id === "nudge-far") return [`${formatCombo("Shift")} ← ↑ → ↓`];
  if (s.id === "add-next") return [`${formatCombo("Alt")} ← ↑ → ↓`];
  if (s.id === "clone-next") return [`${formatCombo("Alt+Shift")} ← ↑ → ↓`];
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
        // Move between the controls ourselves: the scrolling body is not a stop.
        e.preventDefault();
        if (!controls.length) return panelElement.focus();
        const i = controls.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? controls[i <= 0 ? controls.length - 1 : i - 1]
          : controls[i < 0 || i === controls.length - 1 ? 0 : i + 1];
        next.focus();
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
            <h3>Editing text</h3>
            {TEXT.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v.replace("Ctrl+Z", formatCombo("Mod+Z"))}</span>
                <span className="sc-keys">
                  <kbd>{formatCombo(k)}</kbd>
                </span>
              </div>
            ))}
          </section>
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
            <h3>AI panel</h3>
            {AI.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v}</span>
                <span className="sc-keys">
                  <kbd>{formatCombo(k)}</kbd>
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
        <footer className="dlg-foot">
          Diagrams is free and open source, and your diagrams stay in your browser.{" "}
          <a href="privacy.html" target="_blank" rel="noopener" data-testid="privacy-link">
            Privacy
          </a>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
