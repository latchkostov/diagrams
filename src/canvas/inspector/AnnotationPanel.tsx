import { useRef, useState, type CSSProperties } from "react";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { Icon } from "../../components/Icon";
import { t } from "../../i18n";
import { colorLabel, shapeLabel } from "../../i18n/chrome";
import { ANNOTATION_LIMITS } from "../../model/annotations";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_IDS,
  ANNOTATION_SHAPES,
  ANNOTATION_TEXT_SIZES,
  annotationColor,
  minSize,
  resolveAnnotationColor,
  textSizeLabel,
} from "../annotations";
import type { AnnotationFlowNode } from "../types";
import { CopyId, Field, Section, Segmented, SizeInput } from "./fields";
import { bulkStep } from "./MultiPanel";
import { type InspectorProps } from "./types";

export function AnnotationPanel({
  note,
  editor,
  groups,
  onTextSettled,
}: InspectorProps & { note: AnnotationFlowNode }) {
  const id = note.id;
  const { kind } = note.data;
  const merge = (f: string) => ({ merge: `inspector:annotation:${id}:${f}` });
  const color = annotationColor(note.data);
  const resolved = resolveAnnotationColor(note.data.color, kind);
  const isCustomColor = !resolved.isPreset;
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const min = minSize[kind];
  /** The text's box as it is now (before an edit that may grow it). */
  const boxNow = () => ({
    x: note.position.x,
    y: note.position.y,
    width: note.width ?? note.measured?.width ?? 0,
    height: note.height ?? note.measured?.height ?? 0,
  });
  // Typing grows a text as you go; once you're done, it moves clear if it grew over something.
  const typedFrom = useRef<ReturnType<typeof boxNow> | null>(null);
  return (
    <Section>
      <Field label={kind === "zone" ? t("inspector.label") : t("inspector.text")}>
        {kind === "zone" ? (
          <input
            className="insp-input"
            value={note.data.text}
            placeholder={t("inspector.zoneName")}
            onChange={(e) => editor.updateAnnotation(id, { text: e.target.value }, merge("text"))}
            maxLength={ANNOTATION_LIMITS.maxAnnotationText}
            name="annotation-text"
            data-testid="inspector-field-label"
          />
        ) : (
          <textarea
            className="insp-input"
            rows={3}
            value={note.data.text}
            placeholder={t("inspector.writeSomething")}
            onFocus={() => (typedFrom.current = kind === "text" ? boxNow() : null)}
            onBlur={() => {
              if (typedFrom.current) onTextSettled?.(id, typedFrom.current);
              typedFrom.current = null;
            }}
            onChange={(e) => editor.updateAnnotation(id, { text: e.target.value }, merge("text"))}
            maxLength={ANNOTATION_LIMITS.maxAnnotationText}
            name="annotation-text"
            data-testid="inspector-field-text"
          />
        )}
      </Field>
      {kind === "shape" && (
        <Field label={t("inspector.shape")} group>
          <div
            className="insp-toolbar"
            role="radiogroup"
            aria-label={t("inspector.shape")}
            data-testid="inspector-field-shape"
          >
            {ANNOTATION_SHAPES.map((sh) => (
              <button
                key={sh}
                type="button"
                role="radio"
                aria-checked={(note.data.shape ?? "rect") === sh}
                className={`icon-btn${(note.data.shape ?? "rect") === sh ? " is-on" : ""}`}
                title={shapeLabel[sh]}
                aria-label={shapeLabel[sh]}
                onClick={() => editor.updateAnnotation(id, { shape: sh })}
                data-testid={`inspector-shape-${sh}`}
              >
                <Icon name={`shape-${sh}`} />
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label={t("inspector.colour")} group>
        <div
          className="insp-tones"
          data-testid="inspector-field-color"
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
              onClick={() => editor.updateAnnotation(id, { color: c })}
              data-testid={`inspector-color-${c}`}
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
            data-testid="inspector-color-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustomColor ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustomColor ? { backgroundColor: resolved.hex } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      </Field>
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={note.data.color}
          defaultColor={resolved.hex}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) => editor.updateAnnotation(id, { color: hex }, pickerAnchor)}
          onReset={() => {
            editor.updateAnnotation(id, { color: undefined }, pickerAnchor);
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      {/* A zone's label is a label, like a boundary's: one size. */}
      {kind !== "zone" && (
        <Field label={t("inspector.textSize")} group>
          <Segmented
            testId="inspector-field-text-size"
            label={t("inspector.textSize")}
            value={note.data.textSize ?? "m"}
            options={ANNOTATION_TEXT_SIZES.map((t) => ({ value: t, label: textSizeLabel[t] }))}
            onChange={(textSize) => {
              const before = boxNow();
              editor.updateAnnotation(id, { textSize });
              if (kind === "text") onTextSettled?.(id, before);
            }}
          />
        </Field>
      )}
      {/* Text sizes itself from what you type and its text size (the handles still set its width). */}
      {kind !== "text" && (
        <Field label={t("inspector.size")} group>
          <div className="insp-size">
            <SizeInput
              label={t("inspector.width")}
              value={note.width ?? note.measured?.width ?? 0}
              min={min.width}
              testId="inspector-field-width"
              onCommit={(width) => editor.updateAnnotation(id, { width })}
            />
            <span aria-hidden>{"×"}</span>
            <SizeInput
              label={t("inspector.height")}
              value={note.height ?? note.measured?.height ?? 0}
              min={min.height}
              testId="inspector-field-height"
              onCommit={(height) => editor.updateAnnotation(id, { height })}
            />
          </div>
        </Field>
      )}
      <p className="insp-note" data-testid="inspector-annotation-hint">
        {kind === "zone"
          ? t("inspector.aZoneOnlyMarksAnAreaNodesDonT")
          : t("inspector.annotationsDonTTakePartInTheSimulation")}
      </p>
      {kind === "zone" && (
        <div className="insp-actions">
          <button className="btn" onClick={() => editor.convertZoneToBoundary(id)} data-testid="inspector-zone-convert">
            <Icon name="boundary" size={14} /> {t("inspector.convertToBoundary")}
          </button>
        </div>
      )}
      <Field label={t("inspector.boundary")}>
        <select
          className="insp-input"
          value={note.data.group ?? ""}
          onChange={(e) => editor.updateAnnotation(id, { group: e.target.value || undefined })}
          name="group"
          data-testid="inspector-field-group"
        >
          <option value="">{t("inspector.none")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.data.groupId}>
              {g.data.label}
            </option>
          ))}
        </select>
      </Field>
      <CopyId id={id} />
    </Section>
  );
}
