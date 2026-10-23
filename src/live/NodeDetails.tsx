import { useState } from "react";
import { t, useLocale } from "../i18n";
import { stencilLabel } from "../i18n/stencils";
import { getStencil } from "../stencils/registry";
import { lazyComponent } from "../lib/lazyLoad";
import { useLive } from "./context";
import type { BadgeProps } from "./NodeBadges";
import type { LiveState } from "./controller";
import type { DiagramFile } from "../model/types";
import { edgeReadoutKind, flowSummary, nodeSummary, requestSummary } from "./hoverSummary";
import { BreakerReadout } from "./BreakerReadout";
import { RELATION_META, relationOf } from "../model/relations";
import { revisionAtLeast } from "../model/revisions";
import type { CompiledTopology } from "../sim/topology";
import { HoverCard } from "./HoverCard";
import { formatCount, formatRate } from "./format";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";

const Sections = lazyComponent(
  () => import("./NodeDetailSections").then((m) => m.NodeDetailSections),
  (_props, status) => (
    <div className="hover-rail-body" role="status" data-testid="hover-details-loading">
      {status.failed ? (
        <>
          {t("hover.failed")}{" "}
          <button data-testid="hover-details-retry" onClick={status.retry}>
            {t("hover.retry")}
          </button>
        </>
      ) : (
        t("hover.loading")
      )}
    </div>
  ),
);
const History = lazyComponent(() => import("./HoverHistory").then((m) => m.HoverHistory));

export function NodeDetails(props: BadgeProps) {
  useLocale();
  const { node, diagram, s, pinned } = props;
  const ui = useLive();
  const snapshot = ui.controller.getState().snapshot;
  const calls = diagram.edges
    .filter((e) => e.from === node.id)
    .flatMap((e) => (snapshot.edges[e.id]?.calls ? [snapshot.edges[e.id].calls!] : []));
  const [previous, setPrevious] = useState({ at: snapshot.time, backlog: s.backlog, growing: false });
  if (snapshot.time < previous.at || snapshot.time - previous.at >= 1000)
    setPrevious({
      at: snapshot.time,
      backlog: s.backlog,
      growing: snapshot.time > previous.at && s.backlog > previous.backlog,
    });
  const summary = nodeSummary(s, calls, previous.growing);
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
            <History id={node.id} />
          </div>
        ) : (
          <>
            <Sections {...props} section={section} />
            {section === "planning" && <History id={node.id} />}
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
}: {
  diagram: DiagramFile;
  /** The effective diagram's compiled routes (NodeBadges compiles them once per diagram). */
  topology: CompiledTopology;
  state: LiveState;
  id: string;
  pinned: boolean;
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
      kind="edge"
      id={id}
      name={name}
      type={policy.blocking ? t("hover.holds") : t("hover.frees")}
      pinned={pinned}
      presenting={ui.presenting}
      summary={requestSummary(c, breaker, policy.blocking, s?.active ?? 0)}
      healthy={policy.blocking ? t("hover.holds") : t("hover.frees")}
    >
      {(section) => (
        <div className="hover-rail-body" data-testid={`edge-section-${section}`}>
          {section === "breaker" ? (
            breaker ? (
              <BreakerReadout id={id} breaker={breaker} testId={`edge-breaker-${id}`} />
            ) : revisionAtLeast(diagram.planning?.revision, "p3-w2") ? (
              <p data-testid="hover-breaker-none">{t("hover.breakerNone")}</p>
            ) : (
              // Models before p3-w2 do not simulate breakers, whatever the connection says.
              <p data-testid="hover-breaker-pending">{t("hover.breakerPending")}</p>
            )
          ) : (
            <>
              <p>
                {t("hover.retries")}: {formatCount(c?.retried ?? 0)}
              </p>
              <p>
                {t("hover.timeouts")}: {formatCount(c?.timedOut ?? 0)}
              </p>
              <p>
                {policy.blocking ? t("hover.holds") : t("hover.frees")}: {formatCount(c?.held ?? 0)}
              </p>
            </>
          )}
        </div>
      )}
    </HoverCard>
  );
}
