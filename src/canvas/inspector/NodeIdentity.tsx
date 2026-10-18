import { type CSSProperties } from "react";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import { t } from "../../i18n";
import { stencilLabel, vendorLabel } from "../../i18n/stencils";
import { getStencil } from "../../stencils/registry";
import type { DiagramFlowNode } from "../types";
import { CopyId, Field, Section } from "./controls";
import { type InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";

type NodeIdentityProps = Pick<InspectorProps, "editor" | "groups" | "connection"> & {
  node: DiagramFlowNode;
  stencil: ReturnType<typeof getStencil>;
  naming: ReturnType<typeof useNameFields>;
  nameKeys: ReturnType<typeof useNameFields>["keys"];
  setPicker: (anchor: { x: number; y: number }) => void;
};

export function NodeIdentity({
  node,
  editor,
  groups,
  connection,
  stencil,
  naming,
  nameKeys,
  setPicker,
}: NodeIdentityProps) {
  return (
    <Section>
      <Field label={t("inspector.stencil")} group>
        <button
          className="insp-stencil"
          data-testid="inspector-field-stencil"
          aria-label={t("inspector.stencilValue", {
            stencil: stencilLabel(stencil),
            vendor: vendorLabel(stencil.vendor),
          })}
          aria-haspopup="menu"
          style={{ "--accent": stencil.accent } as CSSProperties}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPicker({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <span className="palette-tile">
            <StencilIcon stencil={stencil} size={18} />
          </span>
          <span className="insp-stencil-name">
            {stencilLabel(stencil)}
            <small>{vendorLabel(stencil.vendor)}</small>
          </span>
          <Icon name="chevron-down" size={14} />
        </button>
      </Field>
      <Field label={t("inspector.label")}>
        <input
          className="insp-input"
          value={node.data.label}
          onChange={(e) => editor.updateNode(node.id, { label: e.target.value }, naming.merge())}
          {...nameKeys}
          name="label"
          data-testid="inspector-field-label"
        />
      </Field>
      <Field label={t("inspector.subtitle")}>
        <input
          className="insp-input mono"
          value={node.data.sublabel ?? ""}
          placeholder={stencilLabel(stencil)}
          onChange={(e) => editor.updateNode(node.id, { sublabel: e.target.value }, naming.merge())}
          {...nameKeys}
          name="sublabel"
          data-testid="inspector-field-sublabel"
        />
      </Field>
      {connection && (
        <Field label={t("inspector.connection")}>
          <input
            className="insp-input"
            value={connection.label}
            placeholder={t("inspector.eGReserveStock")}
            onChange={(e) => editor.updateEdge(connection.id, { label: e.target.value || undefined }, naming.merge())}
            {...nameKeys}
            name="connection"
            data-testid="inspector-field-connection"
          />
        </Field>
      )}
      <Field label={t("inspector.boundary")}>
        <select
          className="insp-input"
          value={node.data.group ?? ""}
          onChange={(e) => editor.updateNode(node.id, { group: e.target.value || undefined })}
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
      <CopyId id={node.id} />
    </Section>
  );
}
