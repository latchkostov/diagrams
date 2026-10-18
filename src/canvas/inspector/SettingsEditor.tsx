import { useState } from "react";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import { t } from "../../i18n";
import {
  MAX_SETTINGS_TEXT,
  edgeSettings,
  parseSettings,
  parseSettingsEditor,
  settingsSummary,
  settingsText,
  type ConfigSetting,
} from "../../model/relations";
import type { DiagramFlowEdge } from "../types";
import { Section } from "./fields";

/**
 * The settings a service reads over a config edge: one key per line, `!` before a secret (a Key Vault
 * reference). Pasting appsettings.json, `az appconfig kv list` or .env output just works. Each key can
 * also be locked or unlocked from the list.
 */
export function SettingsEditor({ edge, editor }: { edge: DiagramFlowEdge; editor: EditorApi }) {
  const settings = edgeSettings(edge.data);
  const committed = settingsText(settings);
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState<string>();
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    // Undo, a lock toggle or a paste elsewhere changed them: show the new list unless it's what we typed.
    setSeen(committed);
    if (settingsText(parseSettingsEditor(draft)) !== committed) setDraft(committed);
  }
  const save = (next: ConfigSetting[], mergeTag?: string) =>
    editor.setEdgeProps(
      edge.id,
      { settings: next.length ? next : undefined },
      mergeTag ? { merge: mergeTag } : undefined,
    );
  const summary = settingsSummary(settings);
  return (
    <Section
      title={t("inspector.settings")}
      aside={summary ? <span className="insp-count">{summary}</span> : undefined}
    >
      <textarea
        className="insp-input mono insp-settings"
        rows={Math.min(8, Math.max(3, settings.length + 1))}
        value={draft}
        // eslint-disable-next-line local/no-literal-ui-text -- example configuration keys retain their bytes
        placeholder={"Orders:PageSize\n!ConnectionStrings:Orders"}
        onChange={(e) => {
          setError(undefined);
          setDraft(e.target.value);
          save(parseSettingsEditor(e.target.value), `inspector:edge:${edge.id}:settings`);
        }}
        maxLength={MAX_SETTINGS_TEXT}
        onPaste={(e) => {
          e.preventDefault();
          try {
            const imported = settingsText(parseSettings(e.clipboardData.getData("text/plain")));
            const field = e.currentTarget;
            const nextText = draft.slice(0, field.selectionStart) + imported + draft.slice(field.selectionEnd);
            if (nextText.length > MAX_SETTINGS_TEXT) throw new Error(t("inspector.settingsPasteIsTooLarge"));
            const next = parseSettingsEditor(nextText);
            setError(undefined);
            setDraft(settingsText(next));
            save(next, `inspector:edge:${edge.id}:settings`);
          } catch (err) {
            setError(err instanceof Error ? err.message : t("inspector.couldNotImportSettings"));
          }
        }}
        aria-invalid={!!error}
        aria-describedby={error ? "settings-paste-error" : undefined}
        spellCheck={false}
        aria-label={t("inspector.settingsReadOverThisEdgeOnePerLineMarks")}
        name="settings"
        data-testid="inspector-field-settings"
      />
      {error && (
        <p role="alert" id="settings-paste-error" data-testid="inspector-settings-error" className="insp-note">
          {error}
        </p>
      )}
      <p className="insp-note">{t("inspector.oneKeyPerLineMarksASecretAKey")}</p>
      {settings.length > 0 && (
        <ul className="insp-settings-list" data-testid="inspector-settings-list">
          {settings.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className={`icon-btn insp-mini insp-lock${s.secret ? " is-on" : ""}`}
                aria-pressed={!!s.secret}
                aria-label={t("inspector.secretKey", { key: s.key })}
                title={
                  s.secret
                    ? t("inspector.secretAKeyVaultReferenceClickForAPlain")
                    : t("inspector.plainValueClickToMarkSecret")
                }
                onClick={() => {
                  const next = settings.map((x, j) =>
                    j === i ? (x.secret ? { key: x.key } : { key: x.key, secret: true }) : x,
                  );
                  setDraft(settingsText(next));
                  save(next);
                }}
                data-testid={`inspector-setting-lock-${i}`}
              >
                <Icon name={s.secret ? "lock" : "lock-open"} size={12} />
              </button>
              <span className="mono">{s.key}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
