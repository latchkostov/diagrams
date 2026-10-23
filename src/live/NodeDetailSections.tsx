import { CallsReadout } from "./CallsReadout";
import type { CSSProperties } from "react";
import { waitingDetails } from "./waitingDetails";
import { profileOf } from "../stencils/profiles";
import { t, useLocale } from "../i18n";
import { assignmentLabel, groupLabel } from "../stencils/brokerVocabulary";
import type { SimRole } from "../model/types";
import { formatCount, formatRate } from "./format";
import { NodePlanning } from "../planning/lazy";
import { useLive } from "./context";
import { LatencyReadout } from "./LatencyReadout";
import { ThreadCeiling } from "./ThreadCeiling";
import type { BadgeProps } from "./NodeBadges";
import { nodeOutcome } from "./nodeOutcome";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";
import { ReadoutFacts } from "./ReadoutFacts";

const doneLabel: Record<SimRole, () => string> = {
  source: () => t("hover.sent"),
  gateway: () => t("hover.routed"),
  processor: () => t("hover.processed"),
  topic: () => t("hover.published"),
  stream: () => t("hover.published"),
  queue: () => t("hover.enqueued"),
  store: () => t("hover.written"),
  sink: () => t("hover.received"),
  none: () => t("hover.passed"),
};

export function NodeDetailSections({
  section,
  node,
  diagram,
  s,
  concurrency,
  units,
  groups,
  cap,
  assignment,
  brokerSpec,
  currentModel,
  fault,
  properties,
  configuration,
  docked = false,
}: BadgeProps & { section: string; docked?: boolean }) {
  useLocale();
  const live = useLive();
  const effective = diagram;
  const wait = waitingDetails(effective, configuration)?.nodes.get(node.id);
  const edge = diagram.edges.find((e) => e.id === s.threads?.waitingOn[0]?.[0]);
  const waitingLabel = diagram.nodes.find((n) => n.id === edge?.to)?.label ?? edge?.to ?? "";
  const threadNoun = t("threads.noun", {
    kind: profileOf(node.data.stencil)?.family === "serverless" ? "execution" : "thread",
  });
  const threadBusy = s.threads ? s.threads.working + s.threads.waiting : 0;
  const outcome = nodeOutcome(effective, live.controller.getState().snapshot, node.id);
  const pools = effective.edges.filter(
    (e) => e.from === node.id && (e.props?.caller as { poolConnections?: number } | undefined)?.poolConnections,
  );
  const broker = s.role === "topic" || s.role === "queue" || s.role === "stream";
  const unread = !!s.noConsumer;
  const blocked = s.blocked ?? 0;
  const rejected = s.rejected ?? 0;
  return (
    <div className="hover-rail-body" data-testid={`node-sections-${node.id}`}>
      {section === "threads" && (
        <>
          {s.threads && (
            <div className="lv-thread-detail" data-testid={`thread-detail-${node.id}`}>
              <b>
                {profileOf(node.data.stencil)?.family === "serverless" ? t("threads.executions") : t("threads.heading")}
              </b>
              {docked ? (
                <ReadoutFacts
                  rows={[
                    [t("workspaceLive.threadsBusy"), `${formatCount(threadBusy)} / ${formatCount(s.threads.slots)}`],
                    [t("workspaceLive.working"), formatCount(s.threads.working)],
                    [t("workspaceLive.waitingLabel"), formatCount(s.threads.waiting)],
                  ]}
                />
              ) : (
                <p>
                  {Number.isFinite(s.threads.slots)
                    ? t("threads.busy", { busy: threadBusy, slots: s.threads.slots, noun: threadNoun })
                    : t("threads.unknownPool", { busy: threadBusy, noun: threadNoun })}
                </p>
              )}
              {!docked && !pools.length && (
                <p>
                  {s.threads.waiting
                    ? t("threads.waiting", {
                        working: s.threads.working,
                        count: s.threads.waitingOn[0]?.[1] ?? s.threads.waiting,
                        name: waitingLabel,
                      })
                    : t("threads.noneWaiting", { count: s.threads.working })}
                </p>
              )}
              {pools.map((e) => {
                const calls = live.controller.getState().snapshot.edges[e.id]?.calls;
                const queued = live.controller.queuedCalls(e.id);
                const caller = callPolicy(node.data.stencil, e.props?.caller as EdgeSimProps["caller"]);
                const values = {
                  working: s.threads?.working ?? 0,
                  count: calls?.inFlight ?? 0,
                  queued,
                  pool: caller.pool!,
                  name: diagram.nodes.find((n) => n.id === e.to)?.label ?? e.to,
                };
                return (
                  <p key={e.id} data-testid={`pool-detail-${e.id}`}>
                    {caller.blocking ? t("threads.poolHeldDetail", values) : t("threads.poolFreeDetail", values)}
                  </p>
                );
              })}
            </div>
          )}
          {s.threads && Number.isFinite(s.threads.slots) && wait && (
            <ThreadCeiling
              docked={docked}
              wait={{ ...wait, slots: s.threads.slots, ceiling: (s.threads.slots * 1000) / wait.threadHoldMs }}
              noun={threadNoun}
            />
          )}
          <CallsReadout
            docked={docked}
            diagram={effective}
            node={node.id}
            snapshot={live.controller.getState().snapshot}
          />
        </>
      )}
      {section === "latency" && (
        <>
          {s.latency && (
            <LatencyReadout
              id={docked ? `${node.id}-properties` : node.id}
              latency={s.latency}
              diagram={diagram}
              compact={!docked}
            />
          )}
        </>
      )}
      {section === "outcomes" && (
        <>
          {outcome && (
            <p className="lv-call-outcomes" data-testid={`node-outcome-${node.id}`}>
              {outcome}
            </p>
          )}
          {!!s.threads?.inFlight && (
            <p>
              {t("threads.inFlight", { count: s.threads.inFlight })} · {t("threads.memoryHint")}
            </p>
          )}
          {fault && <p data-testid={`node-fault-detail-${node.id}`}>{t("fault.hover", { fault })}</p>}
        </>
      )}
      {section === "planning" && (
        <>
          <HoverExplanation id={node.id} />
          {properties && (
            <small className="lv-detail-more" data-testid="node-detail-more">
              {t("planning.moreInProperties")}
            </small>
          )}
        </>
      )}
      {section === "outcomes" && (
        <>
          {
            <>
              <Row label={doneLabel[s.role]()} value={formatCount(s.processed)} />
              <Row label={t("hover.throughput")} value={formatRate(s.throughput)} />
              {broker ? (
                <Row
                  label={s.noConsumer ? t("hover.kept") : s.role === "queue" ? t("hover.queue") : t("hover.lag")}
                  value={formatCount(s.backlog)}
                />
              ) : (
                s.backlog > 0 && <Row label={t("hover.queue")} value={formatCount(s.backlog)} />
              )}
              {s.role === "processor" && <Row label={t("hover.inFlight")} value={formatCount(s.inFlight)} />}
              {s.role === "processor" && s.replicas !== undefined && (
                <Row
                  label={t("hover.replicas")}
                  value={
                    s.idleReplicas
                      ? t("hover.assigned", { active: s.activeReplicas ?? 0, total: s.replicas })
                      : String(s.replicas)
                  }
                />
              )}
              {s.role === "processor" && <Row label={t("hover.parallel")} value={String(concurrency)} />}
              {units && <Row label={t("hover.units")} value={`${s.replicas ?? 1} · ${units}`} />}
            </>
          }
          {!!s.idleReplicas && (
            <p className="lv-detail-note" data-testid={`node-detail-idle-${node.id}`}>
              {t("broker.assigned", { active: s.activeReplicas ?? 0, configured: s.replicas ?? 0 })} ·{" "}
              {assignmentLabel(assignment)}
            </p>
          )}
          {unread && (
            <p className="lv-detail-note" data-testid={`node-detail-unread-${node.id}`}>
              {t("hover.unread")}
            </p>
          )}
          {cap && cap.level !== "idle" && !unread && <Row label={t("hover.capacity")} value={cap.text} />}
          {blocked > 0 && <Row label={t("hover.blocked")} value={formatCount(blocked)} />}
          {rejected > 0 && <Row label={t("admission.rejected")} value={formatCount(rejected)} />}
          {groups && Object.keys(s.lag).length > 1 && (
            <div className="lv-lag-list">
              <div className="lv-lag-title">{currentModel ? groupLabel(brokerSpec) : t("hover.groupLag")}</div>
              {Object.entries(s.lag)
                .sort((a, b) => b[1] - a[1])
                .map(([g, v]) => (
                  <div key={g} className="lv-lag-row" data-testid={`live-lag-${g}`}>
                    <span>{groups.get(g) ?? g}</span>
                    <i style={{ "--w": `${Math.min(100, (v / Math.max(1, s.backlog)) * 100)}%` } as CSSProperties} />
                    <b className="mono">{formatCount(v)}</b>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HoverExplanation({ id }: { id: string }) {
  const ui = useLive();
  return <NodePlanning diagram={ui.controller.currentDiagram} id={id} hover />;
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`lv-detail-row${bad ? " is-bad" : ""}`}>
      <span>{label}</span>
      <b className="mono">{value}</b>
    </div>
  );
}
