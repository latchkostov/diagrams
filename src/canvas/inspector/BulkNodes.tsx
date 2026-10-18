import { useState, type CSSProperties } from "react";
import { ContextMenu } from "../../components/ContextMenu";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import { stencilMenu } from "../../editor/builtinActions";
import { t } from "../../i18n";
import { stencilLabel } from "../../i18n/stencils";
import { managedKind } from "../../model/admissionPresets";
import { brokerSpec } from "../../model/brokers";
import { BulkAdmissionFields } from "../../planning/lazy";
import { assignmentLabel } from "../../stencils/brokerVocabulary";
import { getStencil } from "../../stencils/registry";
import { nodeSimFields } from "../simFieldRules";
import { BulkRow, Section } from "./controls";
import { Disclosure } from "./Disclosure";
import { MIXED, MIXED_VALUE, bulkStep, countLabel, shared } from "./helpers";
import { SIM_FIELDS, showSim } from "./simFields";
import { SimInput } from "./SimulationFields";
import { type InspectorProps } from "./types";

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
    (meta.planning?.revision === "p3" || meta.planning?.revision === "p3-a1") &&
    selectedNodes.every((node) => !!managedKind(node.data.stencil));
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
            const value = shared(selectedNodes, (n) => showSim(SIM_FIELDS[k]!.kind, n.data.props?.[k]));
            const first = selectedNodes[0].data.props?.[k];
            return (
              <SimInput
                key={k}
                name={k}
                field={{
                  ...SIM_FIELDS[k]!,
                  ...(k === "partitions"
                    ? { label: assignmentLabels, hint: t("broker.assignmentHint"), note: undefined }
                    : {}),
                  ...(value === MIXED ? { placeholder: t("inspector.mixed") } : {}),
                }}
                value={value === MIXED ? undefined : first}
                onChange={(v) => editor.setNodesProps(ids, { [k]: v }, { merge: `bulk:${mergeKey}:${k}` })}
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
