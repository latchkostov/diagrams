import { useMemo, useState, useSyncExternalStore } from "react";
import { revisionAtLeast } from "../../model/revisions";
import { managedKind } from "../../model/admissionPresets";
import { defineLazySurface } from "../../lib/lazySurface";
import { routingIntent } from "../../editor/routingIntent";
import { t, useLocale } from "../../i18n";
import { routeTableCapable, trafficMixCapable } from "../../model/requestRouting";
import { NodePlanning, RouteTableFields, TrafficMixFields } from "../../planning/lazy";
import { deviceSpec } from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
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
  nodeId,
  stencilId,
  nodeProps,
  editor,
  revision,
  counts,
  readDiagram,
  meta,
  focus,
  namingActive,
  liveMode = false,
}: Pick<InspectorProps, "editor" | "revision" | "counts" | "readDiagram" | "meta" | "focus"> & {
  nodeId: string;
  stencilId: string;
  nodeProps: Record<string, unknown> | undefined;
  namingActive: boolean;
  liveMode?: boolean;
}) {
  useLocale();
  const stencil = getStencil(stencilId);
  const role = stencil.simRole;
  const props = nodeProps ?? EMPTY_PROPS;
  const [routingPinned, setRoutingPinned] = useState(false);
  const device = role === "gateway" ? deviceSpec(stencilId) : undefined;
  // What Custom properties leaves out: only the settings a control here shows.
  const baseHidden = !device ? SIM_KEYS : device.kind === "adc" ? ADC_KEYS : DEVICE_KEYS;
  const hidden = useMemo(
    () =>
      role === "processor" &&
      revisionAtLeast(meta.planning?.revision, "p3-w2") &&
      !managedKind(stencilId) &&
      props.api === undefined &&
      props.endpoints === undefined
        ? new Set([...baseHidden, "queue"])
        : baseHidden,
    [role, meta.planning, props, stencilId, baseHidden],
  );
  // Request routing: a router's table and a source's mix get their own section once added (simple by default:
  // until then only an Add button inside Simulation).
  const router = routeTableCapable(stencilId, role);
  const mixer = trafficMixCapable(role);
  // Each routing request (right-click, or the first route chosen into a mix) remounts the fields onto it.
  const intentSerial = useSyncExternalStore(routingIntent.subscribe, () => routingIntent.serial(nodeId));
  const routing = useMemo(
    () =>
      router ? (
        <RouteTableFields key={intentSerial} editor={editor} nodeId={nodeId} props={props} planning={meta.planning} />
      ) : mixer ? (
        <TrafficMixFields key={intentSerial} editor={editor} nodeId={nodeId} props={props} planning={meta.planning} />
      ) : null,
    [router, mixer, intentSerial, editor, nodeId, props, meta.planning],
  );
  // A right-click "Add …" opens the section on its own; it stays there while this node is selected, so an
  // unfinished form never moves (and loses its fields) once the form has consumed the intent.
  const intended = (router || mixer) && routingIntent.peek(nodeId) !== undefined;
  if (intended && !routingPinned) setRoutingPinned(true);
  const routed =
    (router && props.routeTable !== undefined) ||
    (mixer && props.trafficMix !== undefined) ||
    intended ||
    ((router || mixer) && routingPinned);

  // These sections already pause their analyses while text is being edited. The editor's
  // stable reader keeps bindings and validation on the current graph without a new closure per key.
  const planningRevision = revision;
  const planningRead = readDiagram;
  const planning = useMemo(
    () => (
      <NodePlanning
        configuredOnly={liveMode}
        id={nodeId}
        editor={editor}
        revision={planningRevision}
        readDiagram={planningRead}
        paused={namingActive}
        counts={counts}
      />
    ),
    [nodeId, editor, planningRevision, planningRead, namingActive, counts, liveMode],
  );
  const simulation = useMemo(
    () => (
      <NodeSimulation
        paused={namingActive}
        reveal={focus?.name === "autoscaling-target" ? focus.seq : undefined}
        nodeId={nodeId}
        stencil={stencilId}
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
    [namingActive, focus, nodeId, stencilId, editor, meta, planningRead, props, routed, routing, router, mixer],
  );

  const customPropertiesTitle = t("inspector.customProperties");
  const customProperties = useMemo(
    () => (
      <Disclosure id="node-properties" title={customPropertiesTitle} count={customCount(props, hidden)}>
        <PropsEditor
          props={props}
          hidden={hidden}
          onSet={(patch) => editor.setNodeProps(nodeId, patch)}
          onSetMerged={(patch, key) =>
            editor.setNodeProps(nodeId, patch, { merge: `inspector:node:${nodeId}:prop:${key}` })
          }
        />
      </Disclosure>
    ),
    [props, hidden, editor, nodeId, customPropertiesTitle],
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
