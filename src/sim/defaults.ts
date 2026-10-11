import type { SimRole } from "../model/types";
import type { NodeSimProps } from "./types";

export type ResolvedProps = Required<NodeSimProps>;

/** Ignore malformed free-form diagram props rather than poisoning the clock. */
export function resolveProps(
  role: SimRole, label: string, props: Record<string, unknown>,
): ResolvedProps {
  const number = (key: string, fallback: number, min = 0, max = Infinity) => {
    const value = props[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value)) : fallback;
  };
  return {
    ratePerSec: number("ratePerSec", 2),
    latencyMs: number("latencyMs", role === "processor" ? 250 : role === "gateway" ? 60 : role === "store" ? 40 : 0),
    concurrency: role === "processor" ? Math.floor(number("concurrency", 4)) : Infinity,
    failureRate: number("failureRate", 0, 0, 1),
    maxDeliveryCount: Math.floor(number("maxDeliveryCount", 3, 1)),
    partitions: Math.floor(number("partitions", 3, 1)),
    messageType: typeof props.messageType === "string" ? props.messageType : label || "Message",
  };
}
