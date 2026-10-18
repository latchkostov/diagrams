import { useState, useSyncExternalStore, type CSSProperties, type FocusEvent } from "react";
import { ContextMenu } from "../../components/ContextMenu";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import { stencilMenu } from "../../editor/builtinActions";
import { routingIntent } from "../../editor/routingIntent";
import { t } from "../../i18n";
import { galleryRoleMeta as simRoleMeta } from "../../i18n/galleryRoles";
import { stencilLabel, vendorLabel } from "../../i18n/stencils";
import { managedKind } from "../../model/admissionPresets";
import { brokerSpec, isClusterWrapper } from "../../model/brokers";
import { routeTableCapable, trafficMixCapable } from "../../model/requestRouting";
import { AdmissionFields, NodePlanning, RouteTableFields, TrafficMixFields } from "../../planning/lazy";
import type { NodeSimProps } from "../../sim/types";
import { assignmentLabel } from "../../stencils/brokerVocabulary";
import { deviceSpec } from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
import { inertNodeProps, nodeSimFields } from "../simFieldRules";
import type { DiagramFlowNode } from "../types";
import { AutoscalingWorkload } from "./AutoscalingWorkload";
import { CopyId, Field, InertNote, Section } from "./controls";
import { DeviceFields } from "./DeviceFields";
import { Disclosure } from "./Disclosure";
import { customCount, formatInert } from "./helpers";
import { PropsEditor } from "./PropsEditor";
import { ADC_KEYS, DEVICE_KEYS, SIM_FIELDS, SIM_KEYS } from "./simFields";
import { SimInput } from "./SimInput";
import { type InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";

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

      <Disclosure
        id="node-simulation"
        title={t("inspector.simulation")}
        aside={
          <span
            className="insp-role"
            style={{ "--role": simRoleMeta[role].hue } as CSSProperties}
            title={simRoleMeta[role].hint}
          >
            {simRoleMeta[role].label}
          </span>
        }
      >
        {broker?.partitioned === false && (
          <p className="insp-note" data-testid="broker-fanout">
            {assignmentLabel(broker)} · {t("broker.fanout")}
          </p>
        )}
        {managed ? (
          <AdmissionFields
            stencil={node.data.stencil}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
            advanced={
              simFields.includes("emits") ? (
                <SimInput
                  name="emits"
                  field={SIM_FIELDS.emits!}
                  value={props.emits}
                  onChange={(value) =>
                    editor.setNodeProps(node.id, { emits: value as NodeSimProps["emits"] }, merge("emits"))
                  }
                />
              ) : undefined
            }
          />
        ) : device ? (
          <DeviceFields
            spec={device}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
          />
        ) : simFields.length ? (
          <AutoscalingWorkload
            readDiagram={readDiagram}
            nodeId={node.id}
            stencil={node.data.stencil}
            enabled={meta.planning?.revision === "p3-a1" && role === "processor"}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
          >
            {simFields.map((k) => (
              <SimInput
                key={k}
                name={k}
                field={
                  k === "partitions"
                    ? {
                        ...SIM_FIELDS[k]!,
                        label: assignmentLabel(broker),
                        hint: t("broker.assignmentHint"),
                        note:
                          meta.planning?.revision === "p2" ||
                          meta.planning?.revision === "p3" ||
                          meta.planning?.revision === "p3-a1"
                            ? undefined
                            : SIM_FIELDS[k]!.note,
                      }
                    : k === "replicas"
                      ? { ...SIM_FIELDS[k]!, hint: t("broker.replicaHint") }
                      : SIM_FIELDS[k]!
                }
                value={props[k]}
                onChange={(v) => editor.setNodeProps(node.id, { [k]: v }, merge(k))}
              />
            ))}
          </AutoscalingWorkload>
        ) : isClusterWrapper(node.data.stencil) ? (
          <p className="insp-note" data-testid="broker-wrapper">
            {t("broker.wrapper")}
          </p>
        ) : role === "sink" ? (
          <p className="insp-note" data-testid="inspector-sink-note">
            {t("inspector.messagesEndHereAsTheyArriveNothingHereChanges")}
          </p>
        ) : (
          <p className="insp-note">{t("inspector.thisStencilIsDecorativeAndDoesnTTakePart")}</p>
        )}
        {!routed && routing}
        {!router && props.routeTable !== undefined && (
          <InertNote
            name="routeTable"
            text={t("routing.dormantTable")}
            onRemove={() => editor.setNodeProps(node.id, { routeTable: undefined })}
          />
        )}
        {!mixer && props.trafficMix !== undefined && (
          <InertNote
            name="trafficMix"
            text={t("routing.dormantMix")}
            onRemove={() => editor.setNodeProps(node.id, { trafficMix: undefined })}
          />
        )}
        {(managed ? [] : inertNodeProps(role, props)).map(({ key, why }) => (
          <InertNote
            key={key}
            name={key}
            text={t("inspector.inertValue", {
              field: SIM_FIELDS[key]?.label ?? key,
              value: formatInert(props[key], SIM_FIELDS[key]?.unit),
              why,
            })}
            onRemove={() => editor.setNodeProps(node.id, { [key]: undefined })}
          />
        ))}
      </Disclosure>

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
