import type { SimRole } from "../model/types";
import {
  DEFAULT_FAILOVER_MS,
  DEFAULT_MESSAGE_KB,
  deviceSpec,
  isDeviceHa,
  presetOf,
  sizeOf,
  messagesPerSec,
  type DeviceHa,
  type DeviceKind,
  type DevicePreset,
  type DeviceSize,
} from "../stencils/netDevices";
import type { NodeSimProps } from "./types";

type DeviceKey = "size" | "gbps" | "messageKB" | "ha" | "failoverMs" | "healthChecks";

/** A network device's settings, its size preset's values under the node's own. */
export interface ResolvedDevice {
  /** Undefined for a gateway that only has an explicit `gbps`. */
  kind?: DeviceKind;
  size?: DeviceSize;
  preset?: DevicePreset;
  gbps: number;
  messageKB: number;
  ha: DeviceHa;
  failoverMs: number;
  /** Real messages per second one unit carries. */
  perUnit: number;
}

export type ResolvedProps = Required<Omit<NodeSimProps, "emits" | DeviceKey>> &
  Pick<NodeSimProps, "emits"> & {
    healthChecks: boolean;
    /** Gateways with a throughput ceiling: network device stencils, or any gateway given `gbps`. */
    device?: ResolvedDevice;
  };

/** Ignore malformed free-form diagram props rather than poisoning the clock. `stencil` adds a device's presets. */
export function resolveProps(
  role: SimRole,
  label: string,
  props: Record<string, unknown>,
  stencil?: string,
): ResolvedProps {
  const number = (key: string, fallback: number, min = 0, max = Infinity) => {
    const value = props[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  const device = role === "gateway" ? resolveDevice(props, number, stencil) : undefined;
  const ha = device?.ha ?? "standalone";
  return {
    ratePerSec: number("ratePerSec", 2),
    latencyMs: number(
      "latencyMs",
      device?.preset
        ? device.preset.latencyMs
        : role === "processor"
          ? 250
          : role === "gateway"
            ? 60
            : role === "store"
              ? 40
              : 0,
    ),
    concurrency: role === "processor" ? Math.floor(number("concurrency", 4)) : Infinity,
    // An HA pair or cluster starts at two units.
    replicas: Math.max(1, Math.floor(number("replicas", ha === "standalone" ? 1 : 2, 1))),
    jitter: number("jitter", 0.2, 0, 1),
    retry: props.retry === "inplace" ? "inplace" : "requeue",
    retryBackoffMs: number("retryBackoffMs", 0),
    failureRate: number("failureRate", 0, 0, 1),
    maxDeliveryCount: Math.floor(number("maxDeliveryCount", 3, 1)),
    partitions: Math.floor(number("partitions", 3, 1)),
    emits:
      typeof props.emits === "string"
        ? props.emits
        : props.emits && typeof props.emits === "object" && !Array.isArray(props.emits)
          ? Object.fromEntries(
              Object.entries(props.emits).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            )
          : undefined,
    messageType: typeof props.messageType === "string" ? props.messageType : label || "Message",
    healthChecks:
      typeof props.healthChecks === "boolean" ? props.healthChecks : role === "gateway" && device?.kind === "adc",
    ...(device ? { device } : {}),
  };
}

function resolveDevice(
  props: Record<string, unknown>,
  number: (key: string, fallback: number, min?: number, max?: number) => number,
  stencil: string | undefined,
): ResolvedDevice | undefined {
  const spec = deviceSpec(stencil);
  const explicit = typeof props.gbps === "number" && Number.isFinite(props.gbps);
  if (!spec && !explicit) return undefined;
  const size = spec ? sizeOf(spec, props.size) : undefined;
  const preset = spec && size ? presetOf(spec, size) : undefined;
  const gbps = number("gbps", preset?.gbps ?? 0);
  const messageKB = number("messageKB", DEFAULT_MESSAGE_KB, 0.01);
  return {
    ...(spec ? { kind: spec.kind, size, preset } : {}),
    gbps,
    messageKB,
    ha: isDeviceHa(props.ha) ? props.ha : "standalone",
    failoverMs: number("failoverMs", DEFAULT_FAILOVER_MS),
    // Zero Gbps carries nothing; the ceiling is real messages per second.
    perUnit: messagesPerSec(gbps, messageKB),
  };
}
