import { useSyncExternalStore } from "react";
import { paletteHost } from "../palette/host";
import { t, useLocale } from "../i18n";
import { Icon } from "./Icon";
import { formatCombo, shortcutKeys } from "../editor/shortcuts";

export function ModeSwitch() {
  useLocale();
  const live = useSyncExternalStore(paletteHost.subscribe, () => !!paletteHost.get().canvas?.live);
  const available = useSyncExternalStore(paletteHost.subscribe, () => !!paletteHost.get().live);
  const busy = useSyncExternalStore(
    paletteHost.subscribe,
    () => !!paletteHost.get().canvas?.live && !paletteHost.get().session,
  );
  return (
    <div className="mode-switch" role="group">
      <button
        className={!live ? "is-edit is-on" : "is-edit"}
        data-testid="mode-edit"
        aria-label={t("chrome.backToEditing")}
        aria-pressed={!live}
        disabled={!available}
        onClick={() => {
          if (live) paletteHost.get().live?.toggle();
        }}
      >
        <Icon name="edit" size={16} />
        {t("shortcuts.group.edit")}
      </button>
      <button
        className={live ? "is-live is-on" : "is-live"}
        data-testid="live-toggle"
        aria-label={t("chrome.goLive")}
        aria-pressed={live}
        aria-busy={busy}
        aria-keyshortcuts="L"
        disabled={!available}
        onClick={() => paletteHost.get().live?.toggle()}
        onPointerEnter={() => paletteHost.get().live?.preload?.()}
        onFocus={() => paletteHost.get().live?.preload?.()}
      >
        <span className="mode-dot" aria-hidden />
        {t("fileDialog.live")}
        <kbd aria-hidden>L</kbd>
      </button>
    </div>
  );
}
export function HistoryButtons() {
  useLocale();
  const flags = useSyncExternalStore(paletteHost.subscribe, () => {
    const host = paletteHost.get().canvas;
    return (host?.canUndo ? 1 : 0) | (host?.canRedo ? 2 : 0);
  });
  return (
    <div className="bezel-history">
      {(
        [
          ["undo", 1, t("canvas.undoValue", { combo: formatCombo(shortcutKeys("undo")) }), t("ai.undo")],
          ["redo", 2, t("canvas.redoValue", { combo: formatCombo(shortcutKeys("redo")) }), t("shortcuts.redo")],
        ] as const
      ).map(([action, bit, title, label]) => (
        <button
          key={action}
          className="icon-btn"
          data-testid={`${action}-button`}
          disabled={!(flags & bit)}
          title={title}
          aria-label={label}
          onClick={() => paletteHost.get().canvas?.editor[action]()}
        >
          <Icon name={action} size={16} />
        </button>
      ))}
    </div>
  );
}
