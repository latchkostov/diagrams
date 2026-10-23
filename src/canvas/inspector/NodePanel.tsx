import { revisionAtLeast } from "../../model/revisions";
import { useState, useSyncExternalStore, type FocusEvent } from "react";
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
import { Section } from "./fields";
import { Disclosure } from "./Disclosure";
import { NodeSimulation } from "./SimulationFields";
import { PropsEditor } from "./lazyPropsEditor";
import { customCount } from "./propertyValues";
import { ADC_KEYS, DEVICE_KEYS, SIM_KEYS } from "./simFields";
import { type InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";
import { NodeIdentity } from "./lazyNodeIdentity";

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
  focus,
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
  const managed = revisionAtLeast(meta.planning?.revision, "p3") && !!managedKind(node.data.stencil);
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
      {findings}
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
        reveal={focus?.name === "autoscaling-target" ? focus.seq : undefined}
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
