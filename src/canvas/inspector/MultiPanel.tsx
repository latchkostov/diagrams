import { Icon, type IconName } from "../../components/Icon";
import type { AlignMode } from "../../editor/arrange";
import { t } from "../../i18n";
import { BulkAnnotations } from "./BulkAnnotations";
import { BulkEdges } from "./BulkEdges";
import { BulkGroups } from "./BulkGroups";
import { BulkNodes } from "./BulkNodes";
import { Field, Section } from "./controls";
import { countLabel, countText } from "./helpers";
import { type InspectorProps } from "./types";

const ALIGN_BUTTONS: { mode: AlignMode; icon: IconName; label: string }[] = [
  {
    mode: "left",
    icon: "align-left",
    get label() {
      return t("inspector.alignLeft");
    },
  },
  {
    mode: "center",
    icon: "align-center",
    get label() {
      return t("inspector.alignCentres");
    },
  },
  {
    mode: "right",
    icon: "align-right",
    get label() {
      return t("inspector.alignRight");
    },
  },
  {
    mode: "top",
    icon: "align-top",
    get label() {
      return t("inspector.alignTop");
    },
  },
  {
    mode: "middle",
    icon: "align-middle",
    get label() {
      return t("inspector.alignMiddles");
    },
  },
  {
    mode: "bottom",
    icon: "align-bottom",
    get label() {
      return t("inspector.alignBottom");
    },
  },
];

export function MultiPanel(p: InspectorProps) {
  const { editor, selectedNodes, selectedEdges, selectedGroups, selectedAnnotations = [] } = p;
  const nodeIds = selectedNodes.map((n) => n.id);
  const groupableIds = [
    ...nodeIds,
    ...selectedAnnotations.map((a) => a.id),
    ...selectedGroups.map((g) => g.data.groupId),
  ];
  // Align and distribute arrange nodes and annotations alike; Tidy up lays out nodes (and their edges).
  const ids = [...nodeIds, ...selectedAnnotations.map((n) => n.id)];
  return (
    <>
      <Section>
        {ids.length > 1 ? (
          <Field label={t("inspector.arrange")} group>
            <div className="insp-toolbar">
              {ALIGN_BUTTONS.map((a) => (
                <button
                  key={a.mode}
                  className="icon-btn"
                  title={a.label}
                  aria-label={a.label}
                  onClick={() => editor.align(ids, a.mode)}
                  data-testid={`inspector-align-${a.mode}`}
                >
                  <Icon name={a.icon} />
                </button>
              ))}
            </div>
            {ids.length > 2 && (
              <div className="insp-toolbar">
                <button
                  className="icon-btn"
                  title={t("inspector.distributeHorizontally")}
                  aria-label={t("inspector.distributeHorizontally")}
                  onClick={() => editor.distribute(ids, "h")}
                  data-testid="inspector-distribute-h"
                >
                  <Icon name="distribute-h" />
                </button>
                <button
                  className="icon-btn"
                  title={t("inspector.distributeVertically")}
                  aria-label={t("inspector.distributeVertically")}
                  onClick={() => editor.distribute(ids, "v")}
                  data-testid="inspector-distribute-v"
                >
                  <Icon name="distribute-v" />
                </button>
                {nodeIds.length > 2 && (
                  <button
                    className="btn insp-tidy"
                    title={t("inspector.layOutJustTheseNodesByTheirConnectionsNothing")}
                    onClick={() => editor.tidy(nodeIds)}
                    data-testid="inspector-tidy"
                  >
                    <Icon name="layout" size={14} /> {t("inspector.tidyUp")}
                  </button>
                )}
              </div>
            )}
          </Field>
        ) : (
          <p className="insp-note">
            {countText(selectedNodes.length, selectedEdges.length, selectedGroups.length, selectedAnnotations.length)}
          </p>
        )}
      </Section>
      {selectedNodes.length > 0 && <BulkNodes {...p} />}
      {selectedEdges.length > 0 && <BulkEdges {...p} />}
      {selectedAnnotations.length > 0 && (
        <Section title={countLabel(selectedAnnotations.length, "annotation")}>
          <BulkAnnotations selectedAnnotations={selectedAnnotations} editor={editor} />
        </Section>
      )}
      {selectedGroups.length > 0 && (
        <Section title={countLabel(selectedGroups.length, "boundary")}>
          <BulkGroups selectedGroups={selectedGroups} editor={editor} />
        </Section>
      )}
      <Section>
        <div className="insp-actions">
          {groupableIds.length > 0 && (
            <button
              className="btn"
              onClick={() => editor.groupNodes(groupableIds)}
              data-testid="inspector-group-selection"
            >
              <Icon name="boundary" size={14} /> {t("inspector.addBoundary")}
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={() =>
              editor.deleteElements({
                nodeIds: ids,
                edgeIds: selectedEdges.map((e) => e.id),
                groupIds: selectedGroups.map((g) => g.data.groupId),
              })
            }
            data-testid="inspector-delete-selection"
          >
            <Icon name="trash" size={14} /> {t("inspector.delete")}
          </button>
        </div>
      </Section>
    </>
  );
}
