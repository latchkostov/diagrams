import { revisionAtLeast } from "../model/revisions";
import { resolveProps } from "../sim/defaults";
import { HA_LABEL } from "../stencils/netDevices";
import { useMemo } from "react";
import { defineLazySurface } from "../lib/lazySurface";
import { t, useLocale } from "../i18n";
import { stencilLabel } from "../i18n/stencils";
import { getStencil } from "../stencils/registry";
import { useLive } from "./context";
import type { BadgeProps } from "./NodeBadges";
import type { LiveState } from "./controller";
import type { DiagramFile } from "../model/types";
import { edgeReadoutKind, flowSummary, nodeSummary, requestSummary, requestHealthy } from "./hoverSummary";
import { EdgeDetailSection } from "./EdgeDetailSection";
import { RELATION_META, relationOf } from "../model/relations";
import type { CompiledTopology } from "../sim/topology";
import { NodeSections as Sections } from "./lazyNodeSections";
import { HoverCard } from "./HoverCard";
import { formatCount, formatRate } from "./format";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";

const History = defineLazySurface({
  id: "live.history",
  load: () => import("./HoverHistory").then((m) => m.HoverHistory),
  placeholder: { size: {}, testId: "live.history-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});

export function NodeDetails(props: BadgeProps & { topology: CompiledTopology }) {
  useLocale();
  const { node, diagram, topology, s, pinned } = props;
  const ui = useLive();
  const snapshot = ui.controller.getState().snapshot;
  const calls = diagram.edges
    .filter((e) => e.from === node.id)
    .flatMap((e) => (snapshot.edges[e.id]?.calls ? [snapshot.edges[e.id].calls!] : []));
  const resolved =
    s.role === "processor" || s.role === "gateway"
      ? resolveProps(
          s.role,
          node.data.label,
          ui.controller.effectiveProps(node.id),
          node.data.stencil,
          diagram.planning,
        )
      : undefined;
  const groups = useMemo(
    () => (s.role === "topic" || s.role === "stream" ? groupNames(diagram, node.id, topology) : undefined),
    [diagram, node.id, s.role, topology],
  );
  const detail = {
    ...props,
    currentModel: revisionAtLeast(diagram.planning?.revision, "p2"),
    concurrency: resolved?.concurrency ?? 0,
    units: resolved?.device && resolved.device.ha !== "standalone" ? HA_LABEL[resolved.device.ha] : undefined,
    groups,
  };
  const summary = nodeSummary(s, calls);
  const waitingEdge = diagram.edges.find((e) => e.id === s.threads?.waitingOn[0]?.[0]);
  if (waitingEdge && s.threads?.waiting)
    summary.facts.splice(summary.problems.length, 0, {
      key: "waitingOn",
      label: t("hover.waitingOn", {
        count: s.threads.waitingOn[0][1],
        name: diagram.nodes.find((n) => n.id === waitingEdge.to)?.label ?? waitingEdge.to,
      }),
      value: "",
    });
  return (
    <HoverCard
      kind="node"
      id={node.id}
      name={node.data.label}
      type={stencilLabel(getStencil(node.data.stencil))}
      pinned={pinned}
      focusClaim={props.focusClaim}
      presenting={ui.presenting}
      summary={summary}
      healthy={t("hover.healthyVerdict", { rate: formatRate(s.throughput) })}
    >
      {(section) =>
        section === "resources" ? (
          <div className="hover-rail-body">
            {s.resources && (
              <>
                <p>
                  {t("hover.cpu")}: {Math.round(s.resources.cpuRequestPct ?? s.resources.cpuAllocatedPct ?? 0)}%
                </p>
                <p>
                  {t("hover.memory")}: {formatCount(s.resources.memoryMiB)} MiB
                </p>
              </>
            )}
            {s.fleet && <p>{t("hover.readyDesired", s.fleet)}</p>}
            {!s.resources && !s.fleet && <p>{t("hover.unknown")}</p>}
          </div>
        ) : (
          <>
            <Sections {...detail} section={section} />
            {section === "outcomes" && <History id={node.id} />}
          </>
        )
      }
    </HoverCard>
  );
}

export function EdgeDetails({
  diagram,
  topology,
  state,
  id,
  pinned,
  focusClaim,
}: {
  diagram: DiagramFile;
  /** The effective diagram's compiled routes (NodeBadges compiles them once per diagram). */
  topology: CompiledTopology;
  state: LiveState;
  id: string;
  pinned: boolean;
  focusClaim?: () => boolean;
}) {
  useLocale();
  const ui = useLive();
  const edge = diagram.edges.find((e) => e.id === id);
  if (!edge) return null;
  const s = state.snapshot.edges[id];
  const c = s?.calls;
  const source = diagram.nodes.find((n) => n.id === edge.from);
  const name = t("hover.edge", {
    from: source?.label ?? edge.from,
    to: diagram.nodes.find((n) => n.id === edge.to)?.label ?? edge.to,
  });
  const kind = edgeReadoutKind(diagram, edge, topology);
  if (kind !== "request") {
    // Messages and dependencies have no caller thread, retries, timeouts or breaker: never a fabricated call.
    const relation = relationOf(edge);
    return (
      <HoverCard
        focusClaim={focusClaim}
        kind="edge"
        id={id}
        name={name}
        type={
          relation !== "flow"
            ? RELATION_META[relation].noun
            : edge.kind === "sync"
              ? t("chrome.request")
              : t("chrome.message")
        }
        pinned={pinned}
        presenting={ui.presenting}
        summary={flowSummary(kind, s)}
        healthy={
          kind === "dependency"
            ? t("hover.dependencyVerdict")
            : edge.kind === "sync"
              ? t("hover.flowVerdict")
              : t("hover.messageVerdict")
        }
      >
        {() => null}
      </HoverCard>
    );
  }
  const policy = callPolicy(source?.stencil ?? "", edge.props?.caller as EdgeSimProps["caller"]);
  const breaker = s?.breaker;
  return (
    <HoverCard
      focusClaim={focusClaim}
      kind="edge"
      id={id}
      name={name}
      type={policy.blocking ? t("hover.holds") : t("hover.frees")}
      pinned={pinned}
      presenting={ui.presenting}
      summary={requestSummary(c, breaker, policy.blocking, s?.active ?? 0)}
      healthy={requestHealthy(c, breaker, policy.blocking)}
    >
      {(section) => <EdgeDetailSection diagram={diagram} id={id} section={section} />}
    </HoverCard>
  );
}

/** Consumer-group name → who consumes it, for the lag breakdown. */
function groupNames(d: DiagramFile, nodeId: string, topology: CompiledTopology): Map<string, string> {
  const labels = new Map(d.nodes.map((n) => [n.id, n.label]));
  const out = new Map<string, string>();
  for (const e of topology.edges) {
    if (e.from !== nodeId || e.dlq || e.deny) continue;
    const group = e.groupName;
    const who = labels.get(e.to) ?? e.to;
    out.set(group, out.has(group) ? `${out.get(group)}, ${who}` : who);
  }
  return out;
}
