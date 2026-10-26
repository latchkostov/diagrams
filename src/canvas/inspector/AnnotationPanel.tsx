import "../../styles/inspector-layout.css";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useInteractionOrLocal } from "../interaction";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { ContextMenu } from "../../components/ContextMenu";
import { Icon } from "../../components/Icon";
import { MarkdownEditor } from "../../components/markdown/lazy";
import { t } from "../../i18n";
import { colorLabel, shapeLabel } from "../../i18n/chrome";
import { ANNOTATION_LIMITS, annotationText } from "../../model/annotations";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_IDS,
  DEFAULT_ANNOTATION_SHAPES,
  ANNOTATION_TEXT_SIZES,
  annotationColor,
  minSize,
  resolveAnnotationColor,
  textSizeLabel,
} from "../annotations";
import { Slider } from "../../components/Slider";
import { shapeMenu } from "../shapes/menu";
import type { AnnotationFlowNode } from "../types";
import { CopyId, Field, Section, Segmented, SizeInput } from "./fields";
import { bulkStep } from "./editTransactions";
import { useEditTransaction } from "./useEditTransaction";
import { type InspectorProps } from "./types";

export function AnnotationPanel({
  note,
  editor,
  groups,
  onTextSettled,
}: InspectorProps & { note: AnnotationFlowNode }) {
  const { controller } = useInteractionOrLocal();
  // A focus request made while this panel downloads can now find its field.
  useLayoutEffect(() => controller.rendered());
  const id = note.id;
  const radiusEdit = useEditTransaction(editor, `annotation:${id}:radius`);
  const { kind } = note.data;
  const merge = (f: string) => ({ merge: `inspector:annotation:${id}:${f}` });
  const color = annotationColor(note.data);
  const resolved = resolveAnnotationColor(note.data.color, kind);
  const isCustomColor = !resolved.isPreset;
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const [shapePicker, setShapePicker] = useState<{ x: number; y: number } | null>(null);
  const currentShape = note.data.shape ?? "rect";
  const isDefaultShape = (DEFAULT_ANNOTATION_SHAPES as readonly string[]).includes(currentShape);
  const min = minSize[kind];
  const supportsMarkdown = kind === "note" || kind === "text";
  const setText = (text: string) => editor.updateAnnotation(id, { text: annotationText(text) }, merge("text"));
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
      <Field label={kind === "zone" ? t("inspector.label") : t("inspector.text")} group={supportsMarkdown}>
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
        ) : supportsMarkdown ? (
          <MarkdownEditor
            value={note.data.text}
            placeholder={t("inspector.writeSomething")}
            onFocus={() => (typedFrom.current = kind === "text" ? boxNow() : null)}
            onBlur={() => {
              if (typedFrom.current) onTextSettled?.(id, typedFrom.current);
              typedFrom.current = null;
            }}
            onChange={setText}
            maxLength={ANNOTATION_LIMITS.maxAnnotationText}
            name="annotation-text"
            ariaLabel={t("inspector.text")}
            testId="inspector-field-text"
          />
        ) : (
          <textarea
            className="insp-input"
            rows={3}
            value={note.data.text}
            placeholder={t("inspector.writeSomething")}
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
            {DEFAULT_ANNOTATION_SHAPES.map((sh) => (
              <button
                key={sh}
                type="button"
                role="radio"
                aria-checked={currentShape === sh}
                className={`icon-btn${currentShape === sh ? " is-on" : ""}`}
                title={shapeLabel[sh]}
                aria-label={shapeLabel[sh]}
                onClick={() => editor.updateAnnotation(id, { shape: sh })}
                data-testid={`inspector-shape-${sh}`}
              >
                <Icon name={`shape-${sh}`} />
              </button>
            ))}
            <button
              type="button"
              className={`icon-btn insp-more-shapes-btn${!isDefaultShape ? " is-on" : ""}`}
              title={!isDefaultShape ? `${shapeLabel[currentShape]} (${t("shape.moreShapes")})` : t("shape.moreShapes")}
              aria-label={t("shape.moreShapes")}
              aria-haspopup="menu"
              aria-expanded={!!shapePicker}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setShapePicker({ x: r.left, y: r.bottom + 4 });
              }}
              data-testid="inspector-more-shapes-btn"
            >
              <Icon name={!isDefaultShape ? (`shape-${currentShape}` as const) : "shapes"} size={16} />
              <Icon name="chevron-down" size={12} />
            </button>
          </div>
          {shapePicker && (
            <ContextMenu
              x={shapePicker.x}
              y={shapePicker.y}
              label={t("shape.selectShape")}
              testId="shape-picker"
              searchable={t("shape.searchShapes")}
              items={shapeMenu("pick-shape", (s) => ({
                checked: currentShape === s.id,
                run: () => editor.updateAnnotation(id, { shape: s.id }),
              }))}
              onClose={() => setShapePicker(null)}
            />
          )}
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
      {kind === "zone" && (
        <Field label={t("inspector.borderRadius")} group>
          <Slider
            label={t("inspector.borderRadius")}
            value={note.data.borderRadius ?? 18}
            min={0}
            max={40}
            testId="inspector-field-border-radius"
            onEditStart={radiusEdit.begin}
            onEditEnd={radiusEdit.end}
            onChange={(borderRadius) => editor.updateAnnotation(id, { borderRadius }, radiusEdit.options())}
          />
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
