import { useState } from "react";
import { t, useLocale } from "../i18n";
import { stencilLabel } from "../i18n/stencils";
import { getStencil } from "../stencils/registry";
import { lazyComponent } from "../lib/lazyLoad";
import { useLive } from "./context";
import type { BadgeProps } from "./NodeBadges";
import type { LiveState } from "./controller";
import type { DiagramFile } from "../model/types";
import { nodeSummary, type HoverSummary } from "./hoverSummary";
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
  state,
  id,
  pinned,
}: {
  diagram: DiagramFile;
  state: LiveState;
  id: string;
  pinned: boolean;
}) {
  useLocale();
  const ui = useLive();
  const edge = diagram.edges.find((e) => e.id === id);
  if (!edge) return null;
  const c = state.snapshot.edges[id]?.calls;
  const source = diagram.nodes.find((n) => n.id === edge.from);
  const name = t("hover.edge", {
    from: source?.label ?? edge.from,
    to: diagram.nodes.find((n) => n.id === edge.to)?.label ?? edge.to,
  });
  const policy = callPolicy(source?.stencil ?? "", edge.props?.caller as EdgeSimProps["caller"]);
  const ratio = (c?.windowRequests ?? 0) > 0 ? (c?.windowAttempts ?? 0) / c!.windowRequests! : 1;
  const problems = [
    ...(c?.timedOut ? [{ key: "timeout", text: t("hover.timeoutVerdict", { count: c.timedOut }), severe: true }] : []),
    ...(ratio >= 1.2 && (c?.windowRetried ?? 0) >= 10
      ? [{ key: "retry", text: t("hover.retryVerdict", { ratio: ratio.toFixed(1) }), severe: true }]
      : []),
  ];
  const summary: HoverSummary = {
    problems,
    vitals: [
      {
        key: "requests",
        label: t("hover.requests"),
        value: c?.windowRequests === undefined ? "—" : formatRate(c.windowRequests / 10),
      },
      { key: "attempts", label: t("hover.attempts"), value: `${ratio.toFixed(1)}×`, bad: ratio >= 1.2 },
      {
        key: "goodput",
        label: t("hover.goodput"),
        value: c?.windowSucceeded === undefined ? "—" : formatRate(c.windowSucceeded / 10),
      },
      {
        key: "flight",
        label: t("hover.inFlight"),
        value: formatCount(c?.inFlight ?? state.snapshot.edges[id]?.active ?? 0),
      },
    ],
    facts: [
      ...problems.map((p) => ({ key: p.key, label: p.text, value: "", bad: true })),
      { key: "held", label: policy.blocking ? t("hover.holds") : t("hover.frees"), value: formatCount(c?.held ?? 0) },
      { key: "timeouts", label: t("hover.timeouts"), value: formatCount(c?.timedOut ?? 0) },
    ],
    sections: [
      { key: "retries", label: t("hover.retries"), summary: formatCount(c?.retried ?? 0) },
      { key: "timeouts", label: t("hover.timeouts"), summary: formatCount(c?.timedOut ?? 0) },
      { key: "breaker", label: t("hover.breaker"), summary: "—" },
    ],
  };
  return (
    <HoverCard
      kind="edge"
      id={id}
      name={name}
      type={policy.blocking ? t("hover.holds") : t("hover.frees")}
      pinned={pinned}
      presenting={ui.presenting}
      summary={summary}
      healthy={policy.blocking ? t("hover.holds") : t("hover.frees")}
    >
      {(section) => (
        <div className="hover-rail-body" data-testid={`edge-section-${section}`}>
          {/* #245: replace this slot with the sim's public breaker readout when available. */}
          {section === "breaker" ? (
            <p data-testid="hover-breaker-pending">{t("hover.breakerPending")}</p>
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
