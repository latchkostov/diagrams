import { useState } from "react";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { Icon } from "../../components/Icon";
import type { EditorApi } from "../../editor/types";
import { t } from "../../i18n";
import { toneLabel } from "../../i18n/chrome";
import { isPresetGroupTone, resolveGroupTone, toneColor } from "../groupTones";
import type { GroupFlowNode, GroupTone } from "../types";
import { BulkSwatches } from "./controls";
import { MIXED, bulkStep, shared } from "./helpers";

export function BulkGroups({ selectedGroups, editor }: { selectedGroups: GroupFlowNode[]; editor: EditorApi }) {
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const sharedTone = shared(selectedGroups, (g) => g.data.tone);
  const isCustom = typeof sharedTone === "string" && !isPresetGroupTone(sharedTone) && sharedTone.startsWith("#");
  const resolved = resolveGroupTone(sharedTone === MIXED ? undefined : sharedTone);

  return (
    <>
      <BulkSwatches
        testId="inspector-field-tone"
        itemTestId="inspector-tone"
        options={(Object.keys(toneColor) as GroupTone[]).map((t) => ({
          id: t,
          colour: toneColor[t],
          label: toneLabel[t],
        }))}
        value={sharedTone}
        onPick={(t) =>
          editor.updateGroups(
            selectedGroups.map((g) => g.data.groupId),
            { tone: t },
            bulkStep("tone"),
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
              setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: bulkStep("tone").merge })
            }
            data-testid="inspector-tone-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustom ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustom ? { backgroundColor: resolved } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        }
      />
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={sharedTone === MIXED ? undefined : sharedTone}
          defaultColor={resolved}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) =>
            editor.updateGroups(
              selectedGroups.map((g) => g.data.groupId),
              { tone: hex },
              pickerAnchor,
            )
          }
          onReset={() => {
            editor.updateGroups(
              selectedGroups.map((g) => g.data.groupId),
              { tone: undefined },
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
