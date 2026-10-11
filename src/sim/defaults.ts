import type { SimRole } from "../model/types";
import type { NodeSimProps } from "./types";

export type ResolvedProps = Required<Omit<NodeSimProps, "emits">> & Pick<NodeSimProps, "emits">;

/** Ignore malformed free-form diagram props rather than poisoning the clock. */
export function resolveProps(role: SimRole, label: string, props: Record<string, unknown>): ResolvedProps {
  const number = (key: string, fallback: number, min = 0, max = Infinity) => {
    const value = props[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  return {
    ratePerSec: number("ratePerSec", 2),
    latencyMs: number("latencyMs", role === "processor" ? 250 : role === "gateway" ? 60 : role === "store" ? 40 : 0),
    concurrency: role === "processor" ? Math.floor(number("concurrency", 4)) : Infinity,
    // Phase 4 (capacity model) reads these; until then the engine ignores them.
    replicas: Math.max(1, Math.floor(number("replicas", 1, 1))),
    jitter: number("jitter", 0.2, 0, 1),
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
  };
}
