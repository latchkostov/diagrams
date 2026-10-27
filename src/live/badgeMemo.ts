import type { SimRole } from "../model/types";
import type { BadgeProps } from "./NodeBadges";
import { currentHealth } from "./healthWindow";

export const BROKERS: ReadonlySet<SimRole> = new Set(["queue", "topic", "stream"]);

/** Details consume the whole snapshot; a closed badge only consumes these displayed values. */
export function sameBadge(a: BadgeProps, b: BadgeProps): boolean {
  if (a.hovered || b.hovered) return false;
  if (
    a.node !== b.node ||
    a.cap !== b.cap ||
    a.assignment !== b.assignment ||
    a.fault !== b.fault ||
    a.showOutageLoss !== b.showOutageLoss
  )
    return false;
  const x = a.s,
    y = b.s;
  const hx = currentHealth(x),
    hy = currentHealth(y);
  return (
    equal(x, y, FIELDS) &&
    (!BROKERS.has(x.role) || x === y) &&
    hx.dropped === hy.dropped &&
    hx.rejected - hx.shed === hy.rejected - hy.shed &&
    hx.growing === hy.growing &&
    equal(x.threads, y.threads, THREADS) &&
    equal(x.fleet, y.fleet, FLEET) &&
    x.fleet?.decision?.reason === y.fleet?.decision?.reason &&
    (import.meta.env.VITE_E2E !== "1" || x.resources?.cpuRequestPct === y.resources?.cpuRequestPct) &&
    // Latency summaries are immutable and shared until the next successful sample.
    x.latency === y.latency
  );
}

const FIELDS = (
  "role status processed throughput backlog inFlight blocked shed queueDepth queueLimit replicas idleReplicas failingOver noConsumer" +
  (import.meta.env.VITE_E2E === "1" ? " failed dropped deadLettered" : "")
).split(" ") as (keyof BadgeProps["s"])[];
const THREADS = "slots working waiting inFlight".split(" ") as (keyof NonNullable<BadgeProps["s"]["threads"]>)[];
const FLEET = "ready starting desired draining".split(" ") as (keyof NonNullable<BadgeProps["s"]["fleet"]>)[];
const equal = <T>(x: T | undefined, y: T | undefined, keys: readonly (keyof T)[]) =>
  keys.every((key) => x?.[key] === y?.[key]);
