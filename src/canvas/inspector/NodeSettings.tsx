import { useMemo, useState, useSyncExternalStore } from "react";
import { defineLazySurface } from "../../lib/lazySurface";
import { routingIntent } from "../../editor/routingIntent";
import { t, useLocale } from "../../i18n";
import { routeTableCapable, trafficMixCapable } from "../../model/requestRouting";
import { NodePlanning, RouteTableFields, TrafficMixFields } from "../../planning/lazy";
import { deviceSpec } from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
import type { DiagramFlowNode } from "../types";
import type { InspectorProps } from "./types";
import { Section } from "./fields";
import { Disclosure } from "./Disclosure";
import { PropsEditor } from "./lazyPropsEditor";
import { customCount } from "./propertyValues";
import { ADC_KEYS, DEVICE_KEYS, SIM_KEYS } from "./simFields";

const EMPTY_PROPS: Record<string, unknown> = {};
const NodeSimulation = defineLazySurface({
  id: "inspector.simulation",
  load: () => import("./SimulationFields").then((m) => m.NodeSimulation),
  placeholder: { size: {}, testId: "inspector.simulation-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});

export function NodeSettings({
  node,
  editor,
  revision,
  counts,
  readDiagram,
  meta,
  focus,
  namingActive,
}: Pick<InspectorProps, "editor" | "revision" | "counts" | "readDiagram" | "meta" | "focus"> & {
  node: DiagramFlowNode;
  namingActive: boolean;
}) {
  useLocale();
  const stencil = getStencil(node.data.stencil);
  const role = stencil.simRole;
  const props = node.data.props ?? EMPTY_PROPS;
  const [routingPinned, setRoutingPinned] = useState(false);
  const device = role === "gateway" ? deviceSpec(node.data.stencil) : undefined;
  // What Custom properties leaves out: only the settings a control here shows.
  const hidden = !device ? SIM_KEYS : device.kind === "adc" ? ADC_KEYS : DEVICE_KEYS;
  // Request routing: a router's table and a source's mix get their own section once added (simple by default:
  // until then only an Add button inside Simulation).
  const router = routeTableCapable(node.data.stencil, role);
  const mixer = trafficMixCapable(role);
  // Each routing request (right-click, or the first route chosen into a mix) remounts the fields onto it.
  const intentSerial = useSyncExternalStore(routingIntent.subscribe, () => routingIntent.serial(node.id));
  const routing = useMemo(
    () =>
      router ? (
        <RouteTableFields key={intentSerial} editor={editor} nodeId={node.id} props={props} planning={meta.planning} />
      ) : mixer ? (
        <TrafficMixFields key={intentSerial} editor={editor} nodeId={node.id} props={props} planning={meta.planning} />
      ) : null,
    [router, mixer, intentSerial, editor, node.id, props, meta.planning],
  );
  // A right-click "Add …" opens the section on its own; it stays there while this node is selected, so an
  // unfinished form never moves (and loses its fields) once the form has consumed the intent.
  const intended = (router || mixer) && routingIntent.peek(node.id) !== undefined;
  if (intended && !routingPinned) setRoutingPinned(true);
  const routed =
    (router && props.routeTable !== undefined) ||
    (mixer && props.trafficMix !== undefined) ||
    intended ||
    ((router || mixer) && routingPinned);

  // These sections already pause their analyses while text is being edited. The editor's
  // stable reader keeps bindings and validation on the current graph without a new closure per key.
  const planningRevision = namingActive ? undefined : (revision ?? node);
  const planningRead = namingActive ? editor.getDiagram : readDiagram;
  const planning = useMemo(
    () => (
      <NodePlanning
        id={node.id}
        editor={editor}
        revision={planningRevision}
        readDiagram={planningRead}
        paused={namingActive}
        counts={counts}
      />
    ),
    [node.id, editor, planningRevision, planningRead, namingActive, counts],
  );
  const simulation = useMemo(
    () => (
      <NodeSimulation
        paused={namingActive}
        reveal={focus?.name === "autoscaling-target" ? focus.seq : undefined}
        nodeId={node.id}
        stencil={node.data.stencil}
        editor={editor}
        meta={meta}
        readDiagram={planningRead}
        props={props}
        routed={routed}
        routing={routing}
        router={router}
        mixer={mixer}
      />
    ),
    [
      namingActive,
      focus,
      node.id,
      node.data.stencil,
      editor,
      meta,
      planningRead,
      props,
      routed,
      routing,
      router,
      mixer,
    ],
  );

  const customPropertiesTitle = t("inspector.customProperties");
  const customProperties = useMemo(
    () => (
      <Disclosure id="node-properties" title={customPropertiesTitle} count={customCount(props, hidden)}>
        <PropsEditor
          props={props}
          hidden={hidden}
          onSet={(patch) => editor.setNodeProps(node.id, patch)}
          onSetMerged={(patch, key) =>
            editor.setNodeProps(node.id, patch, { merge: `inspector:node:${node.id}:prop:${key}` })
          }
        />
      </Disclosure>
    ),
    [props, hidden, editor, node.id, customPropertiesTitle],
  );

  return (
    <>
      {routed && (
        <Section title={router ? t("routing.tableHeading") : t("routing.mixHeading")}>
          <div data-testid="inspector-routing">{routing}</div>
        </Section>
      )}

      {planning}
      {simulation}

      {customProperties}
    </>
  );
}
