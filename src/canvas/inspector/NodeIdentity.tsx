import "../../styles/inspector-layout.css";
import "../../styles/readout.css";
import { memo, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DOCUMENTATION_LIMITS } from "../../model/documentation";
import { t, useLocale } from "../../i18n";
import { stencilLabel, vendorLabel } from "../../i18n/stencils";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import { MarkdownEditor } from "../../components/markdown/lazy";
import type { getStencil } from "../../stencils/registry";
import { useInteraction } from "../interaction/useInteraction";
import type { DiagramFlowNode } from "../types";
import { Section, CopyId, Field } from "./fields";
import { PairedFields } from "./Layout";
import type { InspectorProps } from "./types";
import type { useNameFields } from "./useNameFields";

type NodeIdentityProps = Pick<InspectorProps, "editor" | "groups" | "connection"> & {
  node: DiagramFlowNode;
  stencil: ReturnType<typeof getStencil>;
  naming: ReturnType<typeof useNameFields>;
  nameKeys: ReturnType<typeof useNameFields>["keys"];
  onDescriptionFocus: () => void;
  onDescriptionBlur: () => void;
  setPicker: (anchor: { x: number; y: number }) => void;
};

// The memoized description field stays identical while label/subtitle edits update NodeIdentity.
const Description = memo(function Description({ filled, children }: { filled: boolean; children: ReactNode }) {
  // Native disclosure owns subsequent toggles. Typing or clearing must never close the editor.
  const [initialOpen] = useState(filled);
  // Keep this hot path's native markup inline, as for the label field below. Wrapping
  // both the disclosure and its field in components adds two renders per description key.
  return (
    <details className="readout-disclosure" data-testid="inspector-node-description" open={initialOpen}>
      <summary className="readout-row" data-testid="inspector-node-description-toggle">
        <span>{filled ? t("inspector.description") : t("inspector.addDescription")}</span>
        <Icon name="chevron-right" size={12} />
      </summary>
      <div className="readout-disclosure-body" data-testid="inspector-node-description-body">
        {children}
      </div>
    </details>
  );
});

export function NodeIdentity({
  node,
  editor,
  groups,
  connection,
  stencil,
  naming,
  nameKeys,
  setPicker,
  onDescriptionFocus,
  onDescriptionBlur,
}: NodeIdentityProps) {
  const locale = useLocale();
  const interaction = useInteraction();
  useLayoutEffect(() => interaction?.rendered());
  const stencilField = useMemo(
    () => (
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
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The active locale invalidates translated text.
    [stencil, setPicker, locale],
  );
  // The hot label row needs no extra component reconciliation on every key.
  const labelField = useMemo(
    () => (
      <label className="insp-field">
        <span className="insp-label">{t("inspector.label")}</span>
        <input
          className="insp-input"
          value={node.data.label}
          onChange={(e) => editor.updateNode(node.id, { label: e.target.value }, naming.merge())}
          {...nameKeys}
          name="label"
          data-testid="inspector-field-label"
        />
      </label>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The active locale invalidates translated text.
    [node.data.label, node.id, editor, naming, nameKeys, locale],
  );
  const subtitleField = useMemo(
    () => (
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
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The active locale invalidates translated text.
    [node.data.sublabel, node.id, editor, naming, nameKeys, stencil, locale],
  );
  const descriptionField = useMemo(
    () => (
      <div className="insp-field">
        <span className="insp-label">{t("inspector.description")}</span>
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
          onFocus={onDescriptionFocus}
          onBlur={onDescriptionBlur}
          maxLength={DOCUMENTATION_LIMITS.maxLength}
          name="node-description"
          ariaLabel={t("inspector.description")}
          testId="inspector-field-node-description"
        />
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The active locale invalidates translated text.
    [node.data.description, node.id, editor, onDescriptionFocus, onDescriptionBlur, locale],
  );
  const placementField = useMemo(
    () => (
      <PairedFields testId="inspector-placement">
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
      </PairedFields>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The active locale invalidates translated text.
    [node.data.group, node.id, editor, groups, locale],
  );
  return (
    <Section>
      {stencilField}
      {labelField}
      {subtitleField}
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
      <Description key={node.id} filled={!!node.data.description}>
        {descriptionField}
      </Description>
      {placementField}
    </Section>
  );
}
