import "../../styles/inspector-layout.css";
import { revisionAtLeast } from "../../model/revisions";
import { Icon, type IconName } from "../../components/Icon";
import { type AlignMode } from "../../editor/arrange";
import { t } from "../../i18n";
import { Field, Section } from "./fields";
import { type InspectorProps } from "./types";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { useInteractionOrLocal } from "../interaction";
import { ContextMenu } from "../../components/ContextMenu";
import { StencilIcon } from "../../components/StencilIcon";
import { stencilMenu } from "../../editor/builtinActions";
import { stencilLabel } from "../../i18n/stencils";
import { managedKind } from "../../model/admissionPresets";
import { brokerSpec } from "../../model/brokers";
import { BulkAdmissionFields } from "../../planning/lazy";
import { assignmentLabel } from "../../stencils/brokerVocabulary";
import { getStencil } from "../../stencils/registry";
import { nodeSimFields } from "../simFieldRules";
import { Disclosure } from "./Disclosure";
import { SIM_FIELDS, showSim, type SimField } from "./simFields";
import { SimInput } from "./SimulationFields";
import { parseEmits } from "../../editor/emits";
import { relationDropdownItems } from "./edgeChoices";
import { bulkStep } from "./editTransactions";
import { countText, countLabel, MIXED, MIXED_VALUE, shared } from "./selectionSummary";
import { Dropdown } from "../../components/Dropdown";
import { RELATION_CHOICES, applyChoice, choiceOf } from "../../editor/relationActions";
import { ColorPickerModal } from "../../components/ColorPickerModal";
import { type EditorApi } from "../../editor/types";
import { toneLabel, colorLabel } from "../../i18n/chrome";
import { isPresetGroupTone, resolveGroupTone, toneColor } from "../groupTones";
import { type GroupFlowNode, type GroupTone, type AnnotationFlowNode } from "../types";
import { ANNOTATION_COLORS, ANNOTATION_COLOR_IDS, annotationColor, resolveAnnotationColor } from "../annotations";
import type { ReactNode } from "react";

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
  const { controller } = useInteractionOrLocal();
  useLayoutEffect(() => controller.rendered());
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

/** One node edits these with the message-type pickers; several share them as text, defined here (not first view). */
const MESSAGE_FIELDS: Partial<Record<string, SimField>> = {
  messageType: {
    get label() {
      return t("inspector.messageType");
    },
    kind: "text",
    get placeholder() {
      return t("inspector.derivedFromLabel");
    },
    get hint() {
      return t("inspector.typeEmittedByThisSource");
    },
  },
  emits: {
    get label() {
      return t("inspector.emits");
    },
    kind: "map",
    get placeholder() {
      return t("inspector.unchangedOrInOutOther");
    },
    get hint() {
      return t("inspector.messageTypeSentDownstreamOneNameRenamesEverythingOrderplaced");
    },
  },
};

/** The fields several nodes share (D11): Stencil, Boundary, and the simulation settings their roles have in common. */
export function BulkNodes({ editor, selectedNodes, groups, meta }: InspectorProps) {
  const ids = selectedNodes.map((n) => n.id);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const stencilId = shared(selectedNodes, (n) => n.data.stencil);
  const stencil = typeof stencilId === "string" ? getStencil(stencilId) : null;
  const group = shared(selectedNodes, (n) => n.data.group ?? "");
  const fields = selectedNodes.map((n) =>
    nodeSimFields(getStencil(n.data.stencil).simRole, n.data.stencil, meta.planning, n.data.props),
  );
  const simKeys = fields[0].filter((k) => fields.every((keys) => keys.includes(k)));
  const assignmentLabels = [
    ...new Set(
      selectedNodes.map((n) =>
        assignmentLabel(brokerSpec(n.data.stencil, getStencil(n.data.stencil).simRole, meta.planning)),
      ),
    ),
  ].join(" / ");
  const mergeKey = ids.join(",");
  const managed =
    revisionAtLeast(meta.planning?.revision, "p3") && selectedNodes.every((node) => !!managedKind(node.data.stencil));
  return (
    <>
      <Section title={countLabel(ids.length, "node")}>
        <BulkRow label={t("inspector.stencil")}>
          <button
            className="insp-stencil insp-stencil-compact"
            data-testid="inspector-field-stencil"
            data-mixed={stencil ? undefined : "true"}
            aria-label={t("inspector.bulkStencil", {
              stencil: stencil ? stencilLabel(stencil) : t("inspector.mixed"),
              count: ids.length,
            })}
            aria-haspopup="menu"
            style={stencil ? ({ "--accent": stencil.accent } as CSSProperties) : undefined}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicker({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <span className="palette-tile">
              {stencil ? <StencilIcon stencil={stencil} size={16} /> : <Icon name="shapes" size={14} />}
            </span>
            <span className="insp-stencil-name">
              {stencil ? stencilLabel(stencil) : <em className="insp-mixed">{t("inspector.mixed")}</em>}
            </span>
            <Icon name="chevron-down" size={14} />
          </button>
        </BulkRow>
        <BulkRow label={t("inspector.boundary")}>
          <select
            className="insp-input"
            value={group === MIXED ? MIXED_VALUE : (group ?? "")}
            onChange={(e) =>
              e.target.value !== MIXED_VALUE &&
              editor.updateNodes(ids, { group: e.target.value || undefined }, bulkStep("group"))
            }
            name="group"
            aria-label={t("inspector.bulkBoundary", { count: ids.length })}
            data-testid="inspector-field-group"
          >
            {group === MIXED && (
              <option value={MIXED_VALUE} disabled>
                {t("inspector.mixed")}
              </option>
            )}
            <option value="">{t("inspector.none")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.data.groupId}>
                {g.data.label}
              </option>
            ))}
          </select>
        </BulkRow>
      </Section>
      {(simKeys.length > 0 || managed) && (
        <Disclosure id="multi-simulation" title={t("inspector.simulation")}>
          {managed && (
            <BulkAdmissionFields
              nodes={selectedNodes.map((node) => ({
                id: node.id,
                stencil: node.data.stencil,
                props: node.data.props ?? {},
              }))}
              set={(patches, key) =>
                editor.setNodesProps(ids, (_props, id) => patches[id], { merge: `bulk:${mergeKey}:${key}` })
              }
            />
          )}
          {simKeys.map((k) => {
            const base = SIM_FIELDS[k] ?? MESSAGE_FIELDS[k]!;
            const value = shared(selectedNodes, (n) => showSim(base.kind, n.data.props?.[k]));
            const first = selectedNodes[0].data.props?.[k];
            return (
              <SimInput
                key={k}
                name={k}
                field={{
                  ...base,
                  // Only several nodes edit emits as text (one node's rules use the message-type pickers), so the map
                  // syntax is parsed here, keeping its parser out of the first view; SimInput keeps the draft meanwhile.
                  ...(k === "emits" ? { kind: "text" as const } : {}),
                  ...(k === "partitions"
                    ? { label: assignmentLabels, hint: t("broker.assignmentHint"), note: undefined }
                    : {}),
                  ...(value === MIXED ? { placeholder: t("inspector.mixed") } : {}),
                }}
                value={value === MIXED ? undefined : k === "emits" ? value : first}
                onChange={(v) => {
                  const next = k === "emits" ? parseEmits(String(v ?? "")) : v;
                  if (next !== null) editor.setNodesProps(ids, { [k]: next }, { merge: `bulk:${mergeKey}:${k}` });
                }}
              />
            );
          })}
        </Disclosure>
      )}
      {picker && (
        <ContextMenu
          x={picker.x}
          y={picker.y}
          label={t("inspector.changeStencil")}
          testId="stencil-picker"
          searchable={t("inspector.searchStencils")}
          items={stencilMenu(
            "pick-stencil",
            (s) => ({
              checked: s.id === stencilId,
              run: () => editor.updateNodes(ids, { stencil: s.id }, bulkStep("stencil")),
            }),
            stencil?.category ?? getStencil(selectedNodes[0].data.stencil).category,
          )}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

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

/** A compact label-and-control row, so a mixed selection's panel fits one screen. */
export function BulkRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-bulk-row">
      <span className="insp-label">{label}</span>
      {children}
    </div>
  );
}

/** Colour swatches for several things: none ticked, and "Mixed" beside the label, while they differ. */
export function BulkSwatches<T extends string>({
  options,
  value,
  onPick,
  testId,
  itemTestId,
  customButton,
}: {
  options: { id: T; colour: string; label: string }[];
  value: T | typeof MIXED | undefined;
  onPick: (v: T) => void;
  testId: string;
  itemTestId: string;
  customButton?: ReactNode;
}) {
  return (
    <div className="insp-bulk-row">
      <span className="insp-label">
        {t("inspector.colour")}
        {value === MIXED && (
          <em className="insp-mixed" data-testid={`${testId}-mixed`}>
            {t("inspector.mixed")}
          </em>
        )}
      </span>
      <div
        className="insp-tones insp-tones-compact"
        data-testid={testId}
        role="radiogroup"
        aria-label={t("inspector.colour")}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={`insp-tone${value === o.id ? " is-on" : ""}`}
            style={{ "--tone": o.colour } as CSSProperties}
            title={o.label}
            aria-label={o.label}
            data-color={o.id}
            onClick={() => onPick(o.id)}
            data-testid={`${itemTestId}-${o.id}`}
          />
        ))}
        {customButton}
      </div>
    </div>
  );
}
