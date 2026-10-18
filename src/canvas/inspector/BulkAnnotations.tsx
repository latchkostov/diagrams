import { useState } from "react";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import { t } from "../../i18n";
import { colorLabel } from "../../i18n/chrome";
import { ANNOTATION_COLORS, ANNOTATION_COLOR_IDS, annotationColor, resolveAnnotationColor } from "../annotations";
import type { AnnotationFlowNode } from "../types";
import { BulkSwatches } from "./controls";
import { MIXED, bulkStep, shared } from "./helpers";

export function BulkAnnotations({
  selectedAnnotations,
  editor,
}: {
  selectedAnnotations: AnnotationFlowNode[];
  editor: EditorApi;
}) {
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const sharedColor = shared(selectedAnnotations, (a) => annotationColor(a.data));
  const isCustom = typeof sharedColor === "string" && sharedColor.startsWith("#");
  const firstKind = selectedAnnotations[0]?.data.kind ?? "text";
  const resolved = resolveAnnotationColor(sharedColor === MIXED ? undefined : sharedColor, firstKind);

  return (
    <>
      <BulkSwatches
        testId="inspector-field-color"
        itemTestId="inspector-color"
        options={ANNOTATION_COLOR_IDS.map((c) => ({
          id: c,
          colour: ANNOTATION_COLORS[c].hex,
          label: colorLabel[c],
        }))}
        value={sharedColor}
        onPick={(c) =>
          editor.updateAnnotations(
            selectedAnnotations.map((a) => a.id),
            { color: c },
            bulkStep("annotation-colour"),
          )
        }
        customButton={
          <button
            type="button"
            className={`insp-tone-custom${isCustom ? " is-on" : ""}`}
            title={t("chrome.customColour")}
            aria-label={t("chrome.customColour")}
            aria-haspopup="dialog"
            onClick={(e) =>
              setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: bulkStep("colour").merge })
            }
            data-testid="inspector-color-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustom ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustom ? { backgroundColor: resolved.hex } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        }
      />
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={sharedColor === MIXED ? undefined : sharedColor}
          defaultColor={resolved.hex}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) =>
            editor.updateAnnotations(
              selectedAnnotations.map((a) => a.id),
              { color: hex },
              pickerAnchor,
            )
          }
          onReset={() => {
            editor.updateAnnotations(
              selectedAnnotations.map((a) => a.id),
              { color: undefined },
              pickerAnchor,
            );
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
  );
}
