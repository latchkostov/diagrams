import { t } from "../../i18n";
import { formatCount } from "../../live/format";
import {
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
import { Field } from "./controls";
import { SimInput } from "./SimInput";

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

export const formatGbps = (gbps: number) =>
  gbps >= 1000 ? `${Math.round(gbps / 100) / 10} Tbps` : gbps >= 1 ? `${gbps} Gbps` : `${Math.round(gbps * 1000)} Mbps`;
