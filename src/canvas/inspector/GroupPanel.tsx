import { useMemo, useState, type CSSProperties } from "react";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { toneLabel } from "../../i18n/chrome";
import { eligibleParentGroupIds } from "../../model/groupHierarchy";
import { isPresetGroupTone, resolveGroupTone, toneColor } from "../groupTones";
import type { GroupFlowNode, GroupTone } from "../types";
import { CopyId, Field, Section, SizeInput } from "./controls";
import { type InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";

export function GroupPanel({ group, editor, groups }: InspectorProps & { group: GroupFlowNode }) {
  const naming = useNameFields(editor, "group", group.data.groupId, group.id);
  const id = group.data.groupId;
  const isCustomTone = !isPresetGroupTone(group.data.tone) && Boolean(group.data.tone);
  const resolvedTone = resolveGroupTone(group.data.tone);
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const eligibleParents = useMemo(
    () =>
      eligibleParentGroupIds(
        id,
        groups.map((g) => ({ id: g.data.groupId, group: g.data.group })),
      ),
    [id, groups],
  );

  return (
    <Section>
      <Field label={t("inspector.label")}>
        <input
          className="insp-input"
          value={group.data.label}
          onChange={(e) => editor.updateGroup(id, { label: e.target.value }, naming.merge())}
          {...naming.keys}
          name="group-label"
          data-testid="inspector-field-label"
        />
      </Field>
      <Field label={t("inspector.colour")} group>
        <div
          className="insp-tones"
          data-testid="inspector-field-tone"
          role="radiogroup"
          aria-label={t("inspector.colour")}
        >
          {(Object.keys(toneColor) as GroupTone[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={group.data.tone === t}
              className={`insp-tone${group.data.tone === t ? " is-on" : ""}`}
              style={{ "--tone": toneColor[t] } as CSSProperties}
              title={toneLabel[t]}
              aria-label={toneLabel[t]}
              onClick={() => editor.updateGroup(id, { tone: t })}
              data-testid={`inspector-tone-${t}`}
            />
          ))}
          <button
            type="button"
            className={`insp-tone-custom${isCustomTone ? " is-on" : ""}`}
            title={t("chrome.customColour")}
            aria-label={t("chrome.customColour")}
            aria-haspopup="dialog"
            onClick={(e) =>
              setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: `inspector:group:${id}:tone` })
            }
            data-testid="inspector-tone-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustomTone ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustomTone ? { backgroundColor: resolvedTone } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      </Field>
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={group.data.tone}
          defaultColor={resolvedTone}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) => editor.updateGroup(id, { tone: hex }, pickerAnchor)}
          onReset={() => {
            editor.updateGroup(id, { tone: undefined }, pickerAnchor);
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      <Field label={t("inspector.size")} group>
        <div className="insp-size">
          <SizeInput
            label={t("inspector.width")}
            value={group.width ?? group.measured?.width ?? 0}
            min={160}
            testId="inspector-field-width"
            onCommit={(width) => editor.updateGroup(id, { width }, { adopt: true })}
          />
          <span aria-hidden>{"×"}</span>
          <SizeInput
            label={t("inspector.height")}
            value={group.height ?? group.measured?.height ?? 0}
            min={100}
            testId="inspector-field-height"
            onCommit={(height) => editor.updateGroup(id, { height }, { adopt: true })}
          />
        </div>
      </Field>
      <Field label={t("inspector.boundary")}>
        <select
          className="insp-input"
          value={group.data.group ?? ""}
          onChange={(e) => editor.updateGroup(id, { group: e.target.value || undefined })}
          name="group"
          data-testid="inspector-field-group"
        >
          <option value="">{t("inspector.none")}</option>
          {groups
            .filter((g) => eligibleParents.has(g.data.groupId))
            .map((g) => (
              <option key={g.id} value={g.data.groupId}>
                {g.data.label}
              </option>
            ))}
        </select>
      </Field>
      <div className="insp-actions">
        <button className="btn" onClick={() => editor.fitGroupToContents(id)} data-testid="inspector-group-fit">
          <Icon name="fit" size={14} /> {t("inspector.fitToContents")}
        </button>
        <button className="btn" onClick={() => editor.convertGroupToZone(id)} data-testid="inspector-group-convert">
          <Icon name="zone" size={14} /> {t("inspector.convertToZone")}
        </button>
        <button className="btn" onClick={() => editor.ungroup(id)} data-testid="inspector-group-ungroup">
          <Icon name="ungroup" size={14} /> {t("inspector.removeBoundary")}
        </button>
      </div>
      <CopyId id={id} />
    </Section>
  );
}
