import { t } from "../i18n";
import type { DiagramFile } from "../model/types";
import type { LiveState } from "./controller";
import { simulationEdges } from "../sim/simulationEdges";
import type { EdgeSimProps } from "../sim/types";
import { callPolicy } from "../sim/callPolicy";
import { stencilRole } from "../stencils/roles";

/** The final run evidence, in real units. Authored expectation labels and IDs are never parsed as prose. */
export function runEndResult(state: LiveState, diagram: DiagramFile): string | undefined {
  if (!state.run?.done) return;
  const effective = simulationEdges(diagram, state.running ?? undefined);
  const resilience = effective.edges.find(
    (e) =>
      (e.props?.caller as EdgeSimProps["caller"])?.retry && (state.snapshot.edges[e.id]?.calls?.windowRetried ?? 0) > 0,
  );
  if (resilience) {
    const calls = state.snapshot.edges[resilience.id]?.calls;
    const target = state.snapshot.nodes[resilience.to];
    const ratio = calls?.windowRequests ? calls.windowAttempts! / calls.windowRequests : 1;
    if (target && ratio >= 2 && target.backlog > 0)
      return t("resilience.runStuck", {
        name: effective.nodes.find((n) => n.id === resilience.to)?.label ?? resilience.to,
        ratio: ratio.toFixed(1),
      });
  }
  const recovered = effective.edges.find((e) => (state.snapshot.edges[e.id]?.calls?.shortCircuited ?? 0) > 0);
  if (recovered) {
    const target = state.snapshot.nodes[recovered.to],
      calls = state.snapshot.edges[recovered.id]?.calls;
    if (
      target &&
      target.status === "up" &&
      state.snapshot.edges[recovered.id]?.breaker?.state === "closed" &&
      (calls?.windowRequests ?? 0) > 0 &&
      (calls?.windowSucceeded ?? 0) > 0 &&
      target.backlog < (target.threads?.slots ?? 48) &&
      (calls?.windowSucceeded ?? 0) >= 0.9 * (calls?.windowRequests ?? Infinity)
    )
      return t("resilience.runRecovered", {
        name: effective.nodes.find((n) => n.id === recovered.to)?.label ?? recovered.to,
        count: calls!.shortCircuited!,
      });
  }
  const nodes = new Map(effective.nodes.map((n) => [n.id, n]));
  const statusEdge = effective.edges.find((e) =>
    (e.props?.requestFilter as EdgeSimProps["requestFilter"])?.methods?.includes("GET"),
  );
  const statusNode = statusEdge && nodes.get(statusEdge.to);
  const status = statusNode && state.snapshot.nodes[statusNode.id];
  const call =
    statusEdge &&
    effective.edges.find((e) => e.from === statusEdge.from && e.id !== statusEdge.id && e.kind === "sync");
  const policy = call?.props?.caller as EdgeSimProps["caller"];
  const caller = call && state.snapshot.nodes[call.from];
  const gatewayEdge =
    call && effective.edges.find((e) => e.to === call.from && (e.props?.caller as EdgeSimProps["caller"])?.deadlineMs);
  const gatewayDeadline = (gatewayEdge?.props?.caller as EdgeSimProps["caller"])?.deadlineMs;
  const name = (call && nodes.get(call.from)?.label) ?? call?.from ?? "";
  if (call && status && statusNode && policy?.poolConnections)
    return t("runResult.poolLesson", {
      name,
      mode: callPolicy(nodes.get(call.from)?.stencil ?? "", policy).blocking ? "held" : "free",
      status: statusNode.label,
      count: status.processed,
    });
  if (call && status && statusNode && caller?.threads && gatewayEdge && gatewayDeadline) {
    if (policy?.deadlineMs && state.snapshot.edges[call.id]?.calls?.timedOut)
      return t("runResult.timeoutLesson", {
        name,
        seconds: policy.deadlineMs / 1000,
        gatewaySeconds: gatewayDeadline / 1000,
        free: Math.max(0, caller.threads.slots - caller.threads.working - caller.threads.waiting),
        status: statusNode.label,
        count: status.processed,
      });
    if (state.snapshot.edges[gatewayEdge.id]?.calls?.timedOut)
      return t("runResult.stalledLesson", {
        name,
        gateway: effective.nodes.find((n) => n.id === gatewayEdge.from)?.label ?? gatewayEdge.from,
        seconds: gatewayDeadline / 1000,
        status: statusNode.label,
        count: status.processed,
      });
  }
  const scaled = effective.nodes.find(
    (n) =>
      state.snapshot.nodes[n.id]?.threads &&
      state.snapshot.nodes[n.id]?.fleet &&
      (state.configuration[n.id]?.autoscaling as import("../sim/types").NodeSimProps["autoscaling"])?.mode === "on",
  );
  const fleet = scaled && state.snapshot.nodes[scaled.id].fleet;
  const incoming =
    scaled &&
    effective.edges.find(
      (e) => e.to === scaled.id && ["queue", "topic", "stream"].includes(stencilRole(nodes.get(e.from)?.stencil ?? "")),
    );
  const broker = incoming && nodes.get(incoming.from);
  if (scaled && fleet && broker) {
    const outgoing = effective.edges.find((e) => e.from === scaled.id && e.kind === "sync");
    const free = outgoing && !callPolicy(scaled.stencil, outgoing.props?.caller as EdgeSimProps["caller"]).blocking;
    const a = state.configuration[scaled.id]?.autoscaling as import("../sim/types").NodeSimProps["autoscaling"];
    const busy =
      a?.mode === "on" &&
      "settings" in a.controller &&
      a.controller.settings.metrics.some((m) => m.source.kind === "pods");
    return t("runResult.busyLesson", {
      name: scaled.label,
      mode: free ? "free" : busy ? "busy" : "cpu",
      peak: Math.max(fleet.ready, ...fleet.history.map((p) => p.ready)),
      broker: broker.label,
      count: state.snapshot.nodes[broker.id].backlog,
    });
  }
  const largest = diagram.nodes.reduce<{ count: number; label: string }>(
    (loss, node) => {
      const sample = state.snapshot.nodes[node.id];
      // Match expectations and Checks' dropped evidence. Dead-letter transfers are retained traffic.
      const count = sample?.dropped ?? 0;
      return count > loss.count ? { count, label: node.label || t("fault.unnamedTarget") } : loss;
    },
    { count: 0, label: "" },
  );
  if (largest.count > 0) return t("runResult.loss", largest);
  if (state.run.expectations.some((expectation) => expectation.status === "fail")) return t("runResult.noLossFailed");
  if (state.run.expectations.some((expectation) => expectation.status === "pending"))
    return t("runResult.noLossPending");
  return t("runResult.noLoss");
}
