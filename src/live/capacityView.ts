// On-demand capacity analysis. Playback inputs stay in capacityModel.
import { revisionAtLeast } from "../model/revisions";
import type { DiagramFile, DiagramNode, SimRole, Simulation } from "../model/types";
import { SIM_LIMITS } from "../interop/native";
import { t } from "../i18n/core";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import { stencilRole } from "../stencils/roles";
import { analyzeCapacity, type NodeCapacity } from "../sim/capacity";
import { planningSimulation, sizingFix } from "../sim/capacityPlanning";
import { brokerFeeds, compileTopology } from "../sim/topology";
import { formatRate } from "./format";
import {
  rank,
  baseProps,
  brokerList,
  waitDetail,
  formatUtilization,
  heatLevel,
  isModeled,
  type CapacityView,
  type FixChange,
  type HeatLevel,
  type NodeHeat,
  type RunStatus,
} from "./capacityModel";
const BROKERS: ReadonlySet<SimRole> = new Set(["topic", "stream", "queue"]);
const keeps = (role: SimRole) => role === "topic" || role === "stream";
const roleOf = (n: DiagramNode): SimRole => stencilRole(n.stencil);

function nodeText(n: NodeCapacity, status?: NodeHeat["status"], noReader = false, waitsIn?: string[]): string {
  if (!(n.offered > 0)) return "";
  if (status === "down")
    return waitsIn
      ? `Down · ${formatRate(n.offered)} waiting in ${brokerList(waitsIn)}`
      : `Down · ${formatRate(n.offered)} failing`;
  if (status === "paused") return `Paused · ${formatRate(n.offered)} waiting`;
  if (noReader)
    return keeps(n.role)
      ? `Nobody reads this yet · ${formatRate(n.offered)} kept`
      : `No consumer · ${formatRate(n.offered)} waiting`;
  if (n.capacity === Infinity) return n.managed ? t("admission.unknown") : `${formatRate(n.offered)} · no limit`;
  if (n.managed && !Number.isFinite(n.utilization)) return t("admission.zeroCapacity", { rate: formatRate(n.offered) });
  if (!Number.isFinite(n.utilization)) return `No capacity · ${formatRate(n.offered)} waiting`;
  return `${formatUtilization(n.utilization)} · ${formatRate(n.offered)} of ${formatRate(n.capacity)}`;
}

// Planning (gateways and stores unlimited) and the fix's sizing are shared with the capacity check.

/** Nodes ranked busiest first (modeled roles with traffic only). */
export function rankedNodes(d: DiagramFile, nodes: Record<string, NodeHeat>): NodeHeat[] {
  const order = new Map(d.nodes.map((n, i) => [n.id, i]));
  return Object.values(nodes)
    .filter((n) => n.modeled && n.offered > 0 && n.capacity !== Infinity)
    .sort(rank(order));
}

/**
 * The one-click fix: raise replicas on every service at ≥ 90% so it lands around 55%, and raise a
 * topic's partitions when its consumer group needs more of them (including idle replicas on the
 * top bottleneck). Values are base props (before Capacity ×), ready to save. The sizing is shared with
 * the capacity check (src/sim/capacityPlanning.ts).
 */
export function computeFix(
  d: DiagramFile,
  sim: Simulation,
  nodes: Record<string, NodeHeat>,
  top?: NodeHeat,
  status?: RunStatus,
) {
  const busy = top && (top.level === "warn" || top.level === "hot" || top.level === "over");
  const sized = sizingFix(d, sim, rankedNodes(d, nodes), {
    idle: busy && top.idleReplicas > 0 ? top.id : undefined,
    status,
    maxCount: SIM_LIMITS.count,
  });
  if (!sized) return null;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const changes: FixChange[] = sized.map((c) => ({ ...c, label: byId.get(c.nodeId)!.label }));
  const phrase = (c: FixChange) =>
    c.key === "partitions" && revisionAtLeast(d.planning?.revision, "p2")
      ? t("broker.fix", {
          name: c.label,
          kind: assignmentLabel(baseProps(d, byId.get(c.nodeId)!, sim).broker),
          count: c.to,
        })
      : `${c.label} ${c.from} → ${c.to} ${c.key}`;
  const label =
    changes.length <= 2
      ? changes.map(phrase).join(", ")
      : `${phrase(changes[0])}, ${phrase(changes[1])} and ${changes.length - 2} more`;
  return { changes, label };
}

/** Down or paused, as the run (then the simulation's setup, then the diagram) has it. */
function nodeStatus(n: DiagramNode, sim: Simulation, status?: RunStatus): NodeHeat["status"] {
  const s = status?.[n.id] ?? sim.setup?.status?.[n.id] ?? n.props?.status;
  return s === "down" || s === "paused" ? s : undefined;
}

const states = (out: readonly NodeHeat[]) => new Set(out.map((n) => n.status));

/** "Payments is down", "Payments and 1 more are down", "… are down or paused". */
function outageHeadline(out: NodeHeat[]): string {
  const word = states(out).size > 1 ? "down or paused" : out[0].status!;
  return out.length > 1 ? `${out[0].label} and ${out.length - 1} more are ${word}` : `${out[0].label} is ${word}`;
}

/**
 * Planning analysis for the heat map, the bottleneck callout and the panel rows. Cheap and pure.
 * `status` is the run's node statuses right now (chaos on the timeline, Kill / Pause), so the callout
 * reports an outage instead of a plan that assumes everything is up.
 */
export function capacityView(
  d: DiagramFile,
  sim: Simulation,
  status?: RunStatus,
  readyReplicas?: Readonly<Record<string, number>>,
): CapacityView {
  const analysis = analyzeCapacity(d, planningSimulation(d, sim), { status, readyReplicas });
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const compiled = compileTopology(d);
  const routes = compiled.outgoing;
  const nodes: Record<string, NodeHeat> = {};
  /** The brokers feeding a node, when every flow into it comes from one (dead-letter routes and deny rules aside). */
  // Where a down node's messages are, as playback delivers them (brokerFeeds, shared with the live callout).
  const feeds = brokerFeeds(compiled, (id) => (byId.has(id) ? roleOf(byId.get(id)!) : undefined));
  const fedByBrokers = (id: string): string[] | undefined =>
    feeds.get(id)?.map((b) => byId.get(b)?.label || b) ?? undefined;
  for (const [id, n] of Object.entries(analysis.nodes)) {
    // A network device is a gateway with a real ceiling (its datasheet's throughput).
    const modeled = isModeled(n.role) || !!n.device || !!n.managed;
    const st = byId.has(id) ? nodeStatus(byId.get(id)!, sim, status) : undefined;
    // A broker with no route out: nothing consumes it (dead-letter routes don't read it either).
    const noReader = BROKERS.has(n.role) && !routes.get(id)?.length;
    // Unlimited brokers (only unthrottled consumers) never limit anything: no colour. A node that's
    // down or paused is out of capacity whatever its role.
    const limited = (modeled && n.capacity !== Infinity) || (!!st && n.role !== "none");
    const level = limited ? heatLevel(n.utilization, n.offered) : "idle";
    const waitsIn = st ? fedByBrokers(id) : undefined;
    nodes[id] = {
      ...n,
      modeled,
      ...(st ? { status: st } : {}),
      ...(waitsIn ? { waitsIn } : {}),
      ...(noReader ? { noReader } : {}),
      // A topic nobody reads isn't overloaded: it keeps what's published. Amber, never pulsing red.
      level: noReader && !st && keeps(n.role) && level === "over" ? "warn" : level,
      text: nodeText(n, st, noReader, waitsIn),
    };
  }
  const ranked = rankedNodes(d, nodes);
  const top = ranked[0];
  const fix = computeFix(d, sim, nodes, top, status);
  const over = ranked.filter((n) => n.level === "over" || n.level === "hot");
  // Outages lead: a down service isn't a sizing problem, and "Healthy" would be wrong.
  const out = d.nodes
    .map((n) => nodes[n.id])
    .filter((n): n is NodeHeat => !!n?.status && n.role !== "none" && n.role !== "source");
  let headline: string, detail: string;
  let addConsumer: string | undefined;
  if (out.length) {
    headline = outageHeadline(out);
    const first = out[0];
    // A consumer behind a broker doesn't lose its messages while it's down: they wait in the broker.
    const waiting = out.every((n) => n.waitsIn);
    detail =
      first.status === "down"
        ? waiting
          ? out.length > 1
            ? `Messages wait in ${brokerList([...new Set(out.flatMap((n) => n.waitsIn!))])} until they're back.`
            : waitDetail(first.waitsIn!)
          : `Messages sent to ${out.length > 1 ? "them" : "it"} fail until ${out.length > 1 ? "they're" : "it's"} back.`
        : `Messages wait in ${out.length > 1 ? "their queues" : "its queue"} until ${out.length > 1 ? "they resume" : "it resumes"}.`;
    if (states(out).size > 1) detail = `Messages to them ${waiting ? "wait" : "fail or wait"} until they're back.`;
    const busiest = ranked.find((n) => !n.status && Number.isFinite(n.utilization));
    if (busiest && (busiest.level === "over" || busiest.level === "hot"))
      detail += ` ${busiest.label} is ${busiest.level === "over" ? "over" : "near"} capacity too: ${busiest.text}.`;
  } else if (!top) {
    const unknown = Object.values(nodes).some((n) => n.managed && n.offered > 0 && n.capacity === Infinity);
    headline = unknown ? t("admission.unknownShort") : "No traffic to analyze";
    detail = unknown ? t("admission.unknown") : "Set a rate on an entry point to see where it backs up.";
  } else if (top.noReader) {
    // Not "can't keep up": nothing reads it. Partitions only cap the consumers in a group, so they can't help.
    headline = `Nobody reads ${top.label}`;
    detail = keeps(top.role)
      ? revisionAtLeast(d.planning?.revision, "p2")
        ? t("broker.noReader")
        : "It keeps what's published, but nothing consumes it. Partitions can't change that: add a consumer."
      : "Messages wait in it until a consumer takes them.";
    addConsumer = top.id;
  } else if (!Number.isFinite(top.utilization)) {
    headline = top.managed ? t("admission.zeroHeadline", { label: top.label }) : `${top.label} can't keep up at all`;
    detail = top.managed ? t("admission.zeroDetail") : "Its consumers can't take any of its messages.";
  } else if (top.idleReplicas > 0 && top.level !== "ok") {
    headline = `${top.label}: ${top.idleReplicas} of ${top.replicas} replicas idle`;
    detail = top.assignment
      ? `${t("broker.assigned", { active: top.activeReplicas, configured: top.replicas })} · ${assignmentLabel(top.assignment)}. ${top.text}`
      : `A consumer group can't use more consumers than partitions. ${top.text}`;
  } else if (top.level === "over" || top.level === "hot") {
    const more = over.length > 1 ? ` and ${over.length - 1} more` : "";
    headline = `${top.label}${more} ${over.length > 1 ? "are" : "is"} ${top.level === "over" ? "over" : "near"} capacity`;
    detail = top.managed ? `${top.text}. ${t("admission.reduce")}` : top.text;
  } else if (top.level === "warn") {
    headline = `${top.label} is busy`;
    detail = `${top.text}. Still some headroom.`;
  } else {
    headline = "Healthy: every service has headroom";
    detail = `Busiest: ${top.label} at ${top.text}`;
  }
  if (!analysis.converged) detail += " A feedback loop didn't settle, so these are estimates.";
  const tone: HeatLevel = out.length ? "over" : (top?.level ?? "idle");
  const lead = out.length ? out[0] : top;
  return {
    nodes,
    top: lead,
    tone,
    headline,
    detail,
    fix,
    ...(addConsumer ? { addConsumer } : {}),
    converged: analysis.converged,
  };
}
