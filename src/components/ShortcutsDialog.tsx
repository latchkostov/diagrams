import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatCombo, SHORTCUTS, type Shortcut, type ShortcutId } from "../editor/shortcuts";
import { Icon } from "./Icon";
import { AI_PANEL, AI_TOOLS } from "../lib/deployment";
import { msg, t, useLocale } from "../i18n";
import { legacyKeyHint } from "../editor/keyHints";
import { TUTORIALS } from "../lib/urlState";

const GROUPS: Shortcut["group"][] = ["Edit", "Clipboard", "Selection", "View", "Help"];

type Row = [keys: string, does: () => string];

/** Display labels stay with the lazy shortcuts sheet, apart from the eager key bindings. */
const GROUP_NAMES: Record<Shortcut["group"], () => string> = {
  Edit: msg("shortcuts.group.edit"),
  Clipboard: msg("shortcuts.group.clipboard"),
  Selection: msg("shortcuts.group.selection"),
  View: msg("shortcuts.group.view"),
  Help: msg("shortcuts.group.help"),
};
const LABELS: Record<ShortcutId, () => string> = {
  undo: msg("shortcuts.undo"),
  redo: msg("shortcuts.redo"),
  rename: msg("shortcuts.rename"),
  delete: msg("shortcuts.delete"),
  duplicate: msg("shortcuts.duplicate"),
  group: msg("shortcuts.group"),
  "add-text": msg("shortcuts.addText"),
  "add-next": msg("shortcuts.addNext"),
  "clone-next": msg("shortcuts.cloneNext"),
  copy: msg("shortcuts.copy"),
  cut: msg("shortcuts.cut"),
  paste: msg("shortcuts.paste"),
  "select-all": msg("shortcuts.selectAll"),
  nudge: msg("shortcuts.nudge"),
  "nudge-far": msg("shortcuts.nudgeFar"),
  "segment-prev": msg("shortcuts.segmentPrev"),
  "segment-next": msg("shortcuts.segmentNext"),
  "select-next": msg("shortcuts.selectNext"),
  "select-prev": msg("shortcuts.selectPrev"),
  "select-toward": msg("shortcuts.selectToward"),
  "select-edge-out": msg("shortcuts.selectEdgeOut"),
  "select-edge-in": msg("shortcuts.selectEdgeIn"),
  escape: msg("shortcuts.escape"),
  "fit-view": msg("shortcuts.fitView"),
  "zoom-selection": msg("shortcuts.zoomSelection"),
  "zoom-100": msg("shortcuts.zoom100"),
  "command-palette": msg("shortcuts.commandPalette"),
  shortcuts: msg("shortcuts.shortcuts"),
};

const MOUSE: [gesture: () => string, does: () => string][] = [
  [msg("shortcuts.mouse.rightClick"), msg("shortcuts.mouse.rightClick.does")],
  [msg("shortcuts.mouse.doubleCanvas"), msg("shortcuts.mouse.doubleCanvas.does")],
  [msg("shortcuts.mouse.doubleRename"), msg("shortcuts.mouse.doubleProperties.does")],
  [msg("shortcuts.mouse.doubleText"), msg("shortcuts.mouse.doubleText.does")],
  [msg("shortcuts.mouse.drag"), () => t("shortcuts.mouse.drag.does", { shift: legacyKeyHint("Shift") })],
  [() => t("shortcuts.mouse.modDrag", { ctrl: legacyKeyHint("Ctrl") }), msg("shortcuts.mouse.modDrag.does")],
  [
    () => t("shortcuts.mouse.modClick", { shift: legacyKeyHint("Shift"), ctrl: legacyKeyHint("Ctrl") }),
    msg("shortcuts.mouse.modClick.does"),
  ],
  [msg("shortcuts.mouse.scroll"), () => t("shortcuts.mouse.scroll.does", { shift: legacyKeyHint("Shift") })],
  [() => t("shortcuts.mouse.zoom", { ctrl: legacyKeyHint("Ctrl") }), msg("shortcuts.mouse.zoom.does")],
  [() => t("shortcuts.mouse.pan", { space: legacyKeyHint("Space") }), msg("shortcuts.mouse.pan.does")],
  [msg("shortcuts.mouse.handle"), msg("shortcuts.mouse.handle.does")],
  [msg("shortcuts.mouse.plus"), msg("shortcuts.mouse.plus.does")],
  [msg("shortcuts.mouse.edgeEnd"), msg("shortcuts.mouse.edgeEnd.does")],
  [msg("shortcuts.mouse.shape"), msg("shortcuts.mouse.shape.does")],
  [msg("shortcuts.mouse.merge"), msg("shortcuts.mouse.merge.does")],
  [msg("shortcuts.mouse.resetRoute"), msg("shortcuts.mouse.resetRoute.does")],
  [msg("shortcuts.mouse.insert"), msg("shortcuts.mouse.insert.does")],
  [msg("shortcuts.mouse.dragNode"), msg("shortcuts.mouse.dragNode.does")],
  [() => t("shortcuts.mouse.free", { ctrl: legacyKeyHint("Ctrl") }), msg("shortcuts.mouse.free.does")],
  [() => t("shortcuts.mouse.altDrag", { alt: legacyKeyHint("Alt") }), msg("shortcuts.mouse.altDrag.does")],
  [msg("shortcuts.mouse.boundary"), msg("shortcuts.mouse.boundary.does")],
  [msg("shortcuts.mouse.resize"), msg("shortcuts.mouse.resize.does")],
];

/** Inspector names and inline annotation text share completion keys (src/components/editKeys.ts). */
const TEXT: Row[] = [
  ["Enter", msg("shortcuts.text.doneEnter")],
  ["Mod+Enter", msg("shortcuts.text.modEnter")],
  ["Tab", msg("shortcuts.text.nextField")],
  ["Esc", () => t("shortcuts.text.doneEsc", { undo: formatCombo("Mod+Z") })],
  // A route table's rule, focused in the inspector (src/planning/RoutingFields.tsx).
  ["Alt+ArrowUp", msg("routing.shortcutReorder")],
];

const LINE: Row[] = [["← ↑ → ↓", msg("shortcuts.segmentNudge")]];

/** The File menu's keys (src/interop/ui/menus.tsx), shown there beside Open…, Save and Save to ▸ This device…. */
const FILE: Row[] = [
  ["Mod+O", msg("shortcuts.file.open")],
  ["Mod+S", msg("shortcuts.file.save")],
  ["Mod+Shift+S", msg("shortcuts.file.saveAs")],
];

/** Live view and presenting keys. Only the sheet's labels are localized here. */
const LIVE: Row[] = [
  ["L", msg("shortcuts.live.toggle")],
  ["Drag", msg("shortcuts.live.pan")],
  ["C", msg("shortcuts.live.capacity")],
  ["Space", msg("shortcuts.live.play")],
  ["← →", msg("shortcuts.live.step")],
  ["F", msg("shortcuts.live.present")],
  ["Esc", msg("shortcuts.live.leave")],
];

/** The AI panel (AiMount opens it; Advanced handles the rest). Advanced only with AI tools (src/lib/deployment.ts). */
const AI: Row[] = [
  ["Mod+I", msg("shortcuts.ai.panel")],
  ...(AI_TOOLS
    ? ([
        ["Mod+Shift+M", msg("shortcuts.ai.dictate")],
        ["Mod+Enter", msg("shortcuts.ai.apply")],
      ] as Row[])
    : []),
  ["Esc", msg("shortcuts.ai.esc")],
];

function displayKeys(s: Shortcut): string[] {
  if (s.id === "nudge") return ["← ↑ → ↓"];
  if (s.id === "nudge-far") return [`${formatCombo("Shift")} ← ↑ → ↓`];
  if (s.id === "add-next") return [`${formatCombo("Alt")} ← ↑ → ↓`];
  if (s.id === "clone-next") return [`${formatCombo("Alt+Shift")} ← ↑ → ↓`];
  if (s.id === "select-toward") return [`${formatCombo("Ctrl+Alt")} ← ↑ → ↓`];
  return s.keys.map((k) => formatCombo(k));
}

/** Keyboard cheat sheet, opened with `?`. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useLocale();
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
          <h2 id="shortcuts-title">{t("shortcuts.title")}</h2>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
            data-testid="shortcuts-dialog-close"
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="dlg-body sc-grid">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{GROUP_NAMES[g]()}</h3>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.id} className="sc-row" data-testid={`shortcut-${s.id}`}>
                  <span>{LABELS[s.id]()}</span>
                  <span className="sc-keys">
                    {displayKeys(s).map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
              {g === "Edit" && (
                <>
                  {LINE.map(([k, v]) => (
                    <div key={k} className="sc-row" data-testid="shortcut-segment-nudge">
                      <span>{v()}</span>
                      <span className="sc-keys">
                        <kbd>{k}</kbd>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </section>
          ))}
          <section>
            <h3>{t("shortcuts.group.text")}</h3>
            {TEXT.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v()}</span>
                <span className="sc-keys">
                  <kbd>{formatCombo(k)}</kbd>
                </span>
              </div>
            ))}
          </section>
          <section>
            <h3>{t("shortcuts.group.file")}</h3>
            {FILE.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v()}</span>
                <span className="sc-keys">
                  <kbd>{formatCombo(k)}</kbd>
                </span>
              </div>
            ))}
          </section>
          <section data-testid="shortcuts-live">
            <h3>{t("shortcuts.group.live")}</h3>
            {LIVE.map(([k, v]) => (
              <div key={k} className="sc-row">
                <span>{v()}</span>
                <span className="sc-keys">
                  <kbd>{formatCombo(k)}</kbd>
                </span>
              </div>
            ))}
          </section>
          {AI_PANEL && (
            <section>
              <h3>{t("shortcuts.group.ai")}</h3>
              {AI.map(([k, v]) => (
                <div key={k} className="sc-row">
                  <span>{v()}</span>
                  <span className="sc-keys">
                    <kbd>{formatCombo(k)}</kbd>
                  </span>
                </div>
              ))}
            </section>
          )}
          <section data-testid="shortcuts-mouse">
            <h3>{t("shortcuts.group.mouse")}</h3>
            {MOUSE.map(([gesture, does], i) => (
              <div key={i} className="sc-row">
                <span>{does()}</span>
                <span className="sc-keys">
                  <kbd data-gesture>{gesture()}</kbd>
                </span>
              </div>
            ))}
          </section>
        </div>
        <footer className="dlg-foot">
          {TUTORIALS && (
            <a href="?view=tutorials" data-testid="shortcuts-tutorials">
              {t("tutorials.shortcuts")}
            </a>
          )}{" "}
          {t("shortcuts.footer")}{" "}
          <a href="privacy.html" target="_blank" rel="noopener" data-testid="privacy-link">
            {t("shortcuts.privacy")}
          </a>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
