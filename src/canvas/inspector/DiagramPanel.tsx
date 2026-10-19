import { DOCUMENTATION_LIMITS } from "../../model/documentation";
import { useState, type CSSProperties } from "react";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { Icon } from "../../components/Icon";
import { MarkdownEditor } from "../../components/markdown/lazy";
import { t } from "../../i18n";
import { colorLabel } from "../../i18n/chrome";
import { PlanningUpgrade, RequestRoutesSection } from "../../planning/lazy";
import { ANNOTATION_COLORS, ANNOTATION_COLOR_IDS, resolveAnnotationColor } from "../annotations";
import { Field, Section, Segmented } from "./fields";
import { bulkStep } from "./editTransactions";
import { countText } from "./selectionSummary";
import { type InspectorProps } from "./types";

export function DiagramPanel({ editor, meta, counts, focus, takeFocus }: InspectorProps) {
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const color = meta.color;
  const isCustomColor = !!color && !ANNOTATION_COLOR_IDS.includes(color as (typeof ANNOTATION_COLOR_IDS)[number]);
  const resolved = color ? resolveAnnotationColor(color) : null;
  const setDescription = (val: string) =>
    editor.updateMeta({ description: val || undefined }, { merge: "inspector:meta:description" });

  return (
    <>
      <RequestRoutesSection editor={editor} planning={meta.planning} place="live" />
      <PlanningUpgrade
        editor={editor}
        planning={meta.planning}
        key={focus?.seq ?? "default"}
        initialPreview={focus?.name === "autoscaling-upgrade-preview"}
        takePreviewFocus={focus ? () => takeFocus?.(focus.seq) ?? true : undefined}
      />
      <Section>
        <Field label={t("inspector.title")}>
          <input
            className="insp-input"
            value={meta.title}
            onChange={(e) => editor.updateMeta({ title: e.target.value }, { merge: "inspector:meta:title" })}
            name="title"
            data-testid="inspector-field-title"
          />
        </Field>
        <Field label={t("inspector.description")} group>
          <MarkdownEditor
            value={meta.description ?? ""}
            placeholder={t("inspector.whatDoesThisDiagramShow")}
            onChange={setDescription}
            maxLength={DOCUMENTATION_LIMITS.maxDiagramLength}
            name="description"
            ariaLabel={t("inspector.description")}
            testId="inspector-field-description"
          />
        </Field>
        <Field label={t("inspector.colour")} hint={t("chrome.canvasBackgroundTint")} group>
          <div
            className="insp-tones"
            data-testid="inspector-field-diagram-color"
            role="radiogroup"
            aria-label={t("inspector.colour")}
          >
            {ANNOTATION_COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`insp-tone${color === c ? " is-on" : ""}`}
                style={{ "--tone": ANNOTATION_COLORS[c].hex } as CSSProperties}
                title={colorLabel[c]}
                aria-label={colorLabel[c]}
                data-color={c}
                onClick={() => editor.updateMeta({ color: color === c ? undefined : c })}
                data-testid={`inspector-diagram-color-${c}`}
              />
            ))}
            <button
              type="button"
              className={`insp-tone-custom${isCustomColor ? " is-on" : ""}`}
              title={t("chrome.customColour")}
              aria-label={t("chrome.customColour")}
              aria-haspopup="dialog"
              onClick={(e) =>
                setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: bulkStep("colour").merge })
              }
              data-testid="inspector-diagram-color-custom-btn"
            >
              <span
                className={`insp-tone-custom-swatch${!isCustomColor ? " insp-tone-custom-rainbow" : ""}`}
                style={isCustomColor && resolved ? { backgroundColor: resolved.hex } : undefined}
              />
              <Icon name="chevron-down" size={12} />
            </button>
          </div>
        </Field>
        {pickerAnchor && (
          <ColorPickerModal
            currentColor={color}
            defaultColor="#3B82F6"
            anchorRect={pickerAnchor.rect}
            onSelect={(hex) => editor.updateMeta({ color: hex }, pickerAnchor)}
            onReset={() => {
              editor.updateMeta({ color: undefined }, pickerAnchor);
              setPickerAnchor(null);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        )}
        <Field
          label={t("inspector.flowDirection")}
          hint={t("inspector.edgesPreferThisAxisWhenPickingSidesAutoLayout")}
          group
        >
          <Segmented
            testId="inspector-field-direction"
            label={t("inspector.flowDirection")}
            value={meta.direction ?? "LR"}
            options={[
              { value: "LR", label: t("inspector.leftRight") },
              { value: "TB", label: t("inspector.topBottom") },
            ]}
            onChange={(direction) => editor.updateMeta({ direction })}
          />
        </Field>
      </Section>
      <RequestRoutesSection editor={editor} planning={meta.planning} place="edit" />
      <Section>
        <p className="insp-note">{countText(counts.nodes, counts.edges, counts.groups)}</p>
        <p className="insp-note">{t("inspector.selectANodeEdgeOrBoundaryToEditIt")}</p>
        <button className="link-btn" onClick={() => editor.showShortcuts()} data-testid="inspector-shortcuts">
          <Icon name="keyboard" size={13} /> {t("inspector.keyboardShortcuts")}
        </button>
      </Section>
    </>
  );
}
