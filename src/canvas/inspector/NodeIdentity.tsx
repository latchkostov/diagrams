import { useLayoutEffect, type CSSProperties } from "react";
import { DOCUMENTATION_LIMITS } from "../../model/documentation";
import { t } from "../../i18n";
import { stencilLabel, vendorLabel } from "../../i18n/stencils";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import { MarkdownEditor } from "../../components/markdown/lazy";
import type { getStencil } from "../../stencils/registry";
import { useInteraction } from "../interaction/useInteraction";
import type { DiagramFlowNode } from "../types";
import { Section, CopyId, Field } from "./fields";
import type { InspectorProps } from "./types";
import type { useNameFields } from "./useNameFields";

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
  const interaction = useInteraction();
  useLayoutEffect(() => interaction?.rendered());
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
      <Field label={t("inspector.description")} group>
        <MarkdownEditor
          value={node.data.description ?? ""}
          placeholder={t("inspector.writeSomething")}
          onChange={(val) =>
            editor.updateNode(
              node.id,
              { description: val || undefined },
              { merge: `inspector:node:${node.id}:description` },
            )
          }
          maxLength={DOCUMENTATION_LIMITS.maxLength}
          name="node-description"
          ariaLabel={t("inspector.description")}
          testId="inspector-field-node-description"
        />
      </Field>
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
