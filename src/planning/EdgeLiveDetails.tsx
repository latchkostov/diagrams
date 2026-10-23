import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../i18n";
import { LiveContext, useLiveState, type LiveUi } from "../live/context";
import { planningHost } from "./host";
import { DockedLive } from "../live/DockedLive";
import { edgeReadoutKind, flowSummary, requestSummary } from "../live/hoverSummary";
import { EdgeDetailSection } from "../live/EdgeDetailSection";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";
import { readoutDiagram } from "../live/readoutDiagram";

export function EdgeLiveDetails({ id }: { id: string }) {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get, planningHost.get);
  return live ? (
    <LiveContext value={live}>
      <ObservedEdge key={id} id={id} live={live} />
    </LiveContext>
  ) : null;
}

function ObservedEdge({ id, live }: { id: string; live: LiveUi }) {
  useLocale();
  const state = useLiveState(live.controller);
  const { diagram, topology } = readoutDiagram(live.controller.currentDiagram, state.running ?? undefined);
  const edge = diagram.edges.find((e) => e.id === id);
  const s = state.snapshot.edges[id];
  const [previous, setPrevious] = useState({ at: state.snapshot.time, delivered: s?.delivered ?? 0, rate: 0 });
  if (state.snapshot.time < previous.at)
    setPrevious({ at: state.snapshot.time, delivered: s?.delivered ?? 0, rate: 0 });
  else if (state.snapshot.time - previous.at >= 1000)
    setPrevious({
      at: state.snapshot.time,
      delivered: s?.delivered ?? 0,
      rate: (((s?.delivered ?? 0) - previous.delivered) * 1000) / (state.snapshot.time - previous.at),
    });
  if (!edge) return null;
  const source = diagram.nodes.find((n) => n.id === edge.from);
  const policy = callPolicy(source?.stencil ?? "", edge.props?.caller as EdgeSimProps["caller"]);
  const kind = edgeReadoutKind(diagram, edge, topology);
  const summary =
    kind === "request" ? requestSummary(s?.calls, s?.breaker, policy.blocking, s?.active ?? 0) : flowSummary(kind, s);
  if (kind === "request")
    summary.sections.sort(
      (a, b) => ["breaker", "timeouts", "retries"].indexOf(a.key) - ["breaker", "timeouts", "retries"].indexOf(b.key),
    );
  const healthy =
    kind === "request"
      ? policy.blocking
        ? t("hover.holds")
        : t("hover.frees")
      : kind === "dependency"
        ? t("hover.dependencyVerdict")
        : edge.kind === "sync"
          ? t("hover.flowVerdict")
          : t("hover.messageVerdict");
  return (
    <DockedLive
      kind="edge"
      summary={summary}
      healthy={healthy}
      time={state.snapshot.time}
      value={kind === "request" ? (s?.calls?.windowSucceeded ?? 0) / 10 : previous.rate}
    >
      {(section) => <EdgeDetailSection diagram={diagram} id={id} section={section} />}
    </DockedLive>
  );
}
