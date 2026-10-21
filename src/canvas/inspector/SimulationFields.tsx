import { revisionAtLeast } from "../../model/revisions";
import { type ReactNode, type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { t } from "../../i18n";
import { galleryRoleMeta as simRoleMeta } from "../../i18n/galleryRoles";
import { brokerSpec, isClusterWrapper } from "../../model/brokers";
import { AdmissionFields, AutoscalingFields } from "../../planning/lazy";
import { type NodeSimProps } from "../../sim/types";
import { assignmentLabel } from "../../stencils/brokerVocabulary";
import {
  deviceSpec,
  DEFAULT_FAILOVER_MS,
  DEFAULT_MESSAGE_KB,
  HA_LABEL,
  isDeviceHa,
  messagesPerSec,
  presetOf,
  sizeOf,
  sizesOf,
  type DeviceHa,
  type DeviceSize,
  type DeviceSpec,
} from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
import { inertNodeProps, nodeSimFields } from "../simFieldRules";
import { type DiagramFlowNode } from "../types";
import { InertNote, Field } from "./fields";
import { Disclosure } from "./Disclosure";
import { formatInert } from "./inertValues";
import { SIM_FIELDS, showSim, type SimField } from "./simFields";
import { type InspectorProps } from "./types";
import { formatCount } from "../../live/format";
import { parseEmits } from "../../editor/emits";
import { formatNumber } from "../../i18n/number";
import { type DiagramFile } from "../../model/types";

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
          enabled={revisionAtLeast(meta.planning?.revision, "p3-a1") && role === "processor"}
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
                      note: revisionAtLeast(meta.planning?.revision, "p2") ? undefined : SIM_FIELDS[k]!.note,
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

/**
 * A network device's simulation settings: a size preset (its datasheet's throughput and latency), the throughput
 * itself, high availability, and for ADCs health checks. Picking a size clears the throughput and latency typed
 * over the old one, so the new preset shows through.
 */
export function DeviceFields({
  spec,
  props,
  set,
}: {
  spec: DeviceSpec;
  props: Record<string, unknown>;
  set: (patch: Record<string, unknown>, mergeKey?: string) => void;
}) {
  const size: DeviceSize = sizeOf(spec, props.size);
  const preset = presetOf(spec, size);
  const ha: DeviceHa = isDeviceHa(props.ha) ? props.ha : "standalone";
  const num = (key: string, fallback: number) => {
    const v = props[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const gbps = num("gbps", preset.gbps);
  const kb = num("messageKB", DEFAULT_MESSAGE_KB);
  return (
    <>
      <Field label={t("inspector.size")} hint={t("inspector.eachSizeSNumbersComeFromAModelS")}>
        <select
          className="insp-input"
          value={size}
          onChange={(e) => {
            const size = sizeOf(spec, e.target.value);
            const preset = presetOf(spec, size);
            set(
              props.preset === "device-size"
                ? { size, gbps: preset.gbps, latencyMs: preset.latencyMs }
                : { size, gbps: undefined, latencyMs: undefined },
            );
          }}
          name="size"
          data-testid="inspector-field-size"
        >
          {sizesOf(spec).map((s) => (
            <option key={s} value={s}>
              {
                { branch: t("inspector.branch"), campus: t("inspector.campus"), datacentre: t("inspector.dataCentre") }[
                  s
                ]
              }
              : {presetOf(spec, s).model}, {formatGbps(presetOf(spec, s).gbps)}
            </option>
          ))}
        </select>
      </Field>
      <SimInput
        name="gbps"
        field={{
          label: t("inspector.throughput"),
          unit: "Gbps",
          kind: "number",
          min: 0,
          max: 1_000_000,
          step: 0.5,
          placeholder: String(preset.gbps),
          hint: t("inspector.throughputHint", { model: preset.model }),
        }}
        value={props.gbps}
        onChange={(v) => set({ gbps: v }, "gbps")}
      />
      <p className="insp-note" data-testid="inspector-device-rate">
        {t("inspector.deviceRate", { rate: formatCount(messagesPerSec(gbps, kb)), size: kb, model: preset.model })}
      </p>
      <Field label={t("inspector.highAvailability")}>
        <select
          className="insp-input"
          value={ha}
          onChange={(e) => {
            const next = e.target.value as DeviceHa;
            set(
              next === "standalone"
                ? { ha: undefined, replicas: undefined, failoverMs: undefined }
                : { ha: next, replicas: Math.max(2, num("replicas", 2)) },
            );
          }}
          name="ha"
          data-testid="inspector-field-ha"
        >
          {(Object.keys(HA_LABEL) as DeviceHa[]).map((h) => (
            <option key={h} value={h}>
              {
                {
                  standalone: t("inspector.standalone"),
                  "active-standby": t("inspector.activeStandby"),
                  "active-active": t("inspector.activeActive"),
                }[h]
              }
            </option>
          ))}
        </select>
      </Field>
      {ha !== "standalone" && (
        <SimInput
          name="replicas"
          field={{
            label: t("inspector.units"),
            kind: "number",
            min: 1,
            max: 10_000,
            step: 1,
            placeholder: "2",
            hint:
              ha === "active-standby"
                ? t("inspector.boxesInThePairOneCarriesTrafficTheOther")
                : t("inspector.boxesSharingTheTrafficTheirThroughputAddsUp"),
          }}
          value={props.replicas}
          onChange={(v) => set({ replicas: v }, "replicas")}
        />
      )}
      <SimInput
        name="latencyMs"
        field={{
          label: t("inspector.latency"),
          unit: "ms",
          kind: "number",
          min: 0,
          max: 600_000,
          step: 0.05,
          placeholder: String(preset.latencyMs),
          hint: t("inspector.timeThroughTheDevicePerMessage"),
        }}
        value={props.latencyMs}
        onChange={(v) => set({ latencyMs: v }, "latencyMs")}
      />
      {spec.kind === "adc" && (
        <label className="insp-check">
          <input
            type="checkbox"
            checked={props.healthChecks !== false}
            onChange={(e) => set({ healthChecks: e.target.checked ? undefined : false })}
            name="healthChecks"
            data-testid="inspector-field-healthChecks"
          />
          <span>
            {t("inspector.healthChecks")}
            <small>{t("inspector.targetsThatAreDownGetNoTraffic")}</small>
          </span>
        </label>
      )}
      <div className="insp-row2">
        <SimInput
          name="messageKB"
          field={{
            label: t("inspector.messageSize"),
            unit: "kB",
            kind: "number",
            min: 0.01,
            max: 1_000_000,
            step: 1,
            placeholder: String(DEFAULT_MESSAGE_KB),
            hint: t("inspector.theAverageMessageTheThroughputIsConvertedWith1"),
          }}
          value={props.messageKB}
          onChange={(v) => set({ messageKB: v }, "messageKB")}
        />
        {ha === "active-standby" && (
          <SimInput
            name="failoverMs"
            field={{
              label: t("inspector.failover"),
              unit: "ms",
              kind: "number",
              min: 0,
              max: 600_000,
              step: 100,
              placeholder: String(DEFAULT_FAILOVER_MS),
              hint: t("inspector.howLongTrafficWaitsWhenTheActiveUnitFails"),
            }}
            value={props.failoverMs}
            onChange={(v) => set({ failoverMs: v }, "failoverMs")}
          />
        )}
      </div>
    </>
  );
}

const formatGbps = (gbps: number) =>
  gbps >= 1000 ? `${Math.round(gbps / 100) / 10} Tbps` : gbps >= 1 ? `${gbps} Gbps` : `${Math.round(gbps * 1000)} Mbps`;

export type SimValue = number | string | string[] | Record<string, string> | undefined;

export function SimInput({
  name,
  field,
  value,
  onChange,
  integer = false,
}: {
  name: string;
  field: SimField;
  value: unknown;
  onChange: (v: SimValue) => void;
  integer?: boolean;
}) {
  const external = showSim(field.kind, value);
  const [draft, setDraft] = useState(external);
  // A number past the field's bound is saved at the bound, and says so while it's typed.
  const [over, setOver] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const feedback = useId();
  const focused = useRef(false);
  const badDraft = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(external);
  }, [external]);
  return (
    <>
      <Field label={field.label} hint={field.hint}>
        <span className="insp-unit-wrap">
          <input
            className={`insp-input${field.kind === "number" ? " mono" : ""}`}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "decimal" : undefined}
            min={field.min}
            max={field.max}
            step={field.step}
            value={draft}
            placeholder={field.placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? feedback : undefined}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
              if (!badDraft.current) setDraft(external);
              setOver(false);
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const bad = field.kind === "number" && e.currentTarget.validity.badInput;
              badDraft.current = bad;
              const fractional = integer && raw !== "" && !Number.isInteger(Number(raw));
              setInvalid(bad || fractional);
              if (bad || fractional) return;
              setOver(field.kind === "number" && field.max !== undefined && Number(raw) > field.max);
              if (field.kind === "text") return onChange(raw || undefined);
              if (field.kind === "list") {
                const items = raw
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
                return onChange(items.length ? items : undefined);
              }
              if (field.kind === "map") {
                const parsed = parseEmits(raw);
                if (parsed !== null) onChange(parsed);
                return;
              }
              if (raw.trim() === "") return onChange(undefined);
              const v = Number(raw);
              // Each bound on its own: a value the file format would reject never reaches the diagram.
              if (Number.isFinite(v)) onChange(Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, v)));
            }}
            name={name}
            data-testid={`inspector-field-${name}`}
          />
          {field.unit && <span className="insp-unit">{field.unit}</span>}
        </span>
        {invalid && (
          <small id={feedback} className="insp-note" role="status" data-testid={`inspector-invalid-${name}`}>
            {t("admission.invalidNumber", {
              min: formatNumber(field.min ?? 0),
              max: formatNumber(field.max ?? 600_000),
              step: "",
              value: external || t("admission.unknownShort"),
            })}
          </small>
        )}
        {over && field.max !== undefined && (
          <small className="insp-note" role="status" data-testid={`inspector-limit-${name}`}>
            {t("inspector.limit", {
              limit: formatNumber(field.max),
              unit: field.unit && field.unit !== "0–1" ? ` ${field.unit}` : "",
            })}
          </small>
        )}
      </Field>
      {field.note && (
        <p className="insp-note insp-field-note" data-testid={`inspector-note-${name}`}>
          {field.note}
        </p>
      )}
    </>
  );
}

export function AutoscalingWorkload({
  enabled,
  props,
  set,
  children,
  stencil,
  readDiagram,
  nodeId,
}: {
  readDiagram?: () => DiagramFile;
  nodeId: string;
  stencil: string;
  enabled: boolean;
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>, key?: string) => void;
  children: ReactNode;
}) {
  return enabled ? (
    <AutoscalingFields readDiagram={readDiagram} nodeId={nodeId} stencil={stencil} props={props} set={set}>
      {children}
    </AutoscalingFields>
  ) : (
    children
  );
}
