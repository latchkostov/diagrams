import { DOCUMENTATION_LIMITS } from "../../model/documentation";
import { useState, useSyncExternalStore, type FocusEvent, type CSSProperties } from "react";
import { ContextMenu } from "../../components/ContextMenu";
import { stencilMenu } from "../../editor/builtinActions";
import { routingIntent } from "../../editor/routingIntent";
import { t } from "../../i18n";
import { managedKind } from "../../model/admissionPresets";
import { brokerSpec } from "../../model/brokers";
import { routeTableCapable, trafficMixCapable } from "../../model/requestRouting";
import { NodePlanning, RouteTableFields, TrafficMixFields } from "../../planning/lazy";
import { deviceSpec } from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
import { nodeSimFields } from "../simFieldRules";
import { type DiagramFlowNode } from "../types";
import { Section, CopyId, Field } from "./fields";
import { Disclosure } from "./Disclosure";
import { NodeSimulation } from "./SimulationFields";
import { PropsEditor } from "./PropsEditor";
import { customCount } from "./propertyValues";
import { ADC_KEYS, DEVICE_KEYS, SIM_KEYS } from "./simFields";
import { type InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";
import { Icon } from "../../components/Icon";
import { MarkdownEditor } from "../../components/markdown";
import { StencilIcon } from "../../components/StencilIcon";
import { stencilLabel, vendorLabel } from "../../i18n/stencils";

export function NodePanel({
  node,
  editor,
  groups,
  connection,
  onNamed,
  findings,
  revision,
  counts,
  readDiagram,
  meta,
}: InspectorProps & { node: DiagramFlowNode }) {
  const stencil = getStencil(node.data.stencil);
  const role = stencil.simRole;
  const props = node.data.props ?? {};
  // A new node keeps its creation step while these name fields are focused.
  const [namingActive, setNamingActive] = useState(false);
  const naming = useNameFields(editor, "node", node.id, node.id, () => {
    setNamingActive(false);
    onNamed?.();
  });
  const nameKeys = {
    ...naming.keys,
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      setNamingActive(true);
      naming.keys.onFocus(e);
    },
  };
  const merge = (f: string) => ({ merge: `inspector:node:${node.id}:${f}` });
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [routingPinned, setRoutingPinned] = useState(false);
  const broker = brokerSpec(node.data.stencil, role, meta.planning);
  const simFields = nodeSimFields(role, node.data.stencil, meta.planning, props);
  const managed =
    (meta.planning?.revision === "p3" || meta.planning?.revision === "p3-a1") && !!managedKind(node.data.stencil);
  const device = role === "gateway" ? deviceSpec(node.data.stencil) : undefined;
  // What Custom properties leaves out: only the settings a control here shows.
  const hidden = !device ? SIM_KEYS : device.kind === "adc" ? ADC_KEYS : DEVICE_KEYS;
  // Request routing: a router's table and a source's mix get their own section once added (simple by default:
  // until then only an Add button inside Simulation).
  const router = routeTableCapable(node.data.stencil, role);
  const mixer = trafficMixCapable(role);
  // Each routing request (right-click, or the first route chosen into a mix) remounts the fields onto it.
  const intentSerial = useSyncExternalStore(routingIntent.subscribe, () => routingIntent.serial(node.id));
  const routing = router ? (
    <RouteTableFields key={intentSerial} editor={editor} nodeId={node.id} props={props} planning={meta.planning} />
  ) : mixer ? (
    <TrafficMixFields key={intentSerial} editor={editor} nodeId={node.id} props={props} planning={meta.planning} />
  ) : null;
  // A right-click "Add …" opens the section on its own; it stays there while this node is selected, so an
  // unfinished form never moves (and loses its fields) once the form has consumed the intent.
  const intended = (router || mixer) && routingIntent.peek(node.id) !== undefined;
  if (intended && !routingPinned) setRoutingPinned(true);
  const routed =
    (router && props.routeTable !== undefined) ||
    (mixer && props.trafficMix !== undefined) ||
    intended ||
    ((router || mixer) && routingPinned);

  return (
    <>
      <NodeIdentity
        node={node}
        editor={editor}
        groups={groups}
        connection={connection}
        stencil={stencil}
        naming={naming}
        nameKeys={nameKeys}
        setPicker={setPicker}
      />

      {routed && (
        <Section title={router ? t("routing.tableHeading") : t("routing.mixHeading")}>
          <div data-testid="inspector-routing">{routing}</div>
        </Section>
      )}

      <NodePlanning
        id={node.id}
        editor={editor}
        revision={revision ?? node}
        readDiagram={readDiagram}
        paused={namingActive}
        counts={counts}
      />

      <NodeSimulation
        node={node}
        editor={editor}
        meta={meta}
        readDiagram={readDiagram}
        props={props}
        role={role}
        broker={broker}
        simFields={simFields}
        managed={managed}
        device={device}
        merge={merge}
        routed={routed}
        routing={routing}
        router={router}
        mixer={mixer}
      />

      <Disclosure id="node-properties" title={t("inspector.customProperties")} count={customCount(props, hidden)}>
        <PropsEditor
          props={props}
          hidden={hidden}
          onSet={(patch) => editor.setNodeProps(node.id, patch)}
          onSetMerged={(patch, key) => editor.setNodeProps(node.id, patch, merge(`prop:${key}`))}
        />
      </Disclosure>

      {findings}

      {picker && (
        <ContextMenu
          x={picker.x}
          y={picker.y}
          label={t("inspector.changeStencil")}
          testId="stencil-picker"
          searchable={t("inspector.searchStencils")}
          items={stencilMenu(
            "pick-stencil",
            (s) => ({ checked: s.id === node.data.stencil, run: () => editor.updateNode(node.id, { stencil: s.id }) }),
            stencil.category,
          )}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

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
