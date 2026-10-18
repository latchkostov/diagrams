import { relationDropdownItems } from "./EdgePanel";
import { Dropdown } from "../../components/Dropdown";
import { RELATION_CHOICES, applyChoice, choiceOf } from "../../editor/relationActions";
import { t } from "../../i18n";
import { BulkRow, Section } from "./controls";
import { MIXED, countLabel, shared } from "./helpers";
import { type InspectorProps } from "./types";

/** The fields several edges share (D11): Relationship and Label. */
export function BulkEdges({ editor, selectedEdges }: InspectorProps) {
  const ids = selectedEdges.map((e) => e.id);
  const choice = shared(selectedEdges, (e) => choiceOf(e.data));
  const label = shared(selectedEdges, (e) => e.data?.label ?? "");
  return (
    <Section title={countLabel(ids.length, "edge")}>
      <BulkRow label={t("inspector.relationship")}>
        <Dropdown
          value={choice === MIXED ? undefined : choice}
          placeholder={choice === MIXED ? t("inspector.mixed") : undefined}
          onChange={(nextId) => {
            const next = RELATION_CHOICES.find((c) => c.id === nextId);
            if (next) applyChoice(editor, ids, next);
          }}
          items={relationDropdownItems()}
          name="relationship"
          aria-label={t("inspector.bulkRelationship", { count: ids.length })}
          testId="inspector-field-relation"
        />
      </BulkRow>
      <BulkRow label={t("inspector.label")}>
        <input
          className="insp-input"
          value={label === MIXED ? "" : (label ?? "")}
          placeholder={label === MIXED ? t("inspector.mixed") : t("inspector.eGOrderplaced")}
          onChange={(e) => editor.updateEdges(ids, { label: e.target.value }, { merge: `bulk:${ids.join(",")}:label` })}
          name="edge-label"
          aria-label={t("inspector.bulkLabel", { count: ids.length })}
          data-testid="inspector-field-label"
        />
      </BulkRow>
    </Section>
  );
}
