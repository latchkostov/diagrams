import type { ReactNode } from "react";
import { type CSSProperties } from "react";
import { t } from "../../i18n";
import { galleryRoleMeta as simRoleMeta } from "../../i18n/galleryRoles";
import { brokerSpec, isClusterWrapper } from "../../model/brokers";
import { AdmissionFields } from "../../planning/lazy";
import type { NodeSimProps } from "../../sim/types";
import { assignmentLabel } from "../../stencils/brokerVocabulary";
import { deviceSpec } from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
import { inertNodeProps, nodeSimFields } from "../simFieldRules";
import type { DiagramFlowNode } from "../types";
import { AutoscalingWorkload } from "./AutoscalingWorkload";
import { InertNote } from "./controls";
import { DeviceFields } from "./DeviceFields";
import { Disclosure } from "./Disclosure";
import { formatInert } from "./helpers";
import { SIM_FIELDS } from "./simFields";
import { SimInput } from "./SimInput";
import { type InspectorProps } from "./types";

type NodeSimulationProps = Pick<InspectorProps, "editor" | "meta" | "readDiagram"> & {
  node: DiagramFlowNode;
  props: Record<string, unknown>;
  role: ReturnType<typeof getStencil>["simRole"];
  broker: ReturnType<typeof brokerSpec>;
  simFields: ReturnType<typeof nodeSimFields>;
  managed: boolean;
  device: ReturnType<typeof deviceSpec>;
  merge: (field: string) => { merge: string };
  routed: boolean;
  routing: ReactNode;
  router: boolean;
  mixer: boolean;
};

export function NodeSimulation({
  node,
  editor,
  meta,
  readDiagram,
  props,
  role,
  broker,
  simFields,
  managed,
  device,
  merge,
  routed,
  routing,
  router,
  mixer,
}: NodeSimulationProps) {
  return (
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
  );
}
