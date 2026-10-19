import { useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react";
import { useStore } from "@xyflow/react";
import { waitingDetails } from "./waitingDetails";
import { simulationEdges } from "../sim/simulationEdges";
import { profileOf } from "../stencils/profiles";
import { t, useLocale } from "../i18n";
import { assignmentLabel, groupLabel } from "../stencils/brokerVocabulary";
import type { SimRole } from "../model/types";
import { hoverRoom, hoverTop } from "./hoverPlacement";
import { formatCount, formatRate, heldWords } from "./format";
import { NodePlanning } from "../planning/lazy";
import { useLive } from "./context";
import { LatencyReadout } from "./LatencyReadout";
import { ThreadCeiling } from "./ThreadCeiling";
import type { BadgeProps } from "./NodeBadges";

const doneLabel: Record<SimRole, string> = {
  source: "Sent",
  gateway: "Routed",
  processor: "Processed",
  topic: "Published",
  stream: "Published",
  queue: "Enqueued",
  store: "Written",
  sink: "Received",
  none: "Passed",
};

export function NodeDetails({
  node,
  diagram,
  s,
  hovered,
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
}: BadgeProps) {
  useLocale();
  const live = useLive();
  const running = live.controller.getState().running;
  const effective = useMemo(() => simulationEdges(diagram, running ?? undefined), [diagram, running]);
  const wait = waitingDetails(effective, configuration)?.nodes.get(node.id);
  const edge = diagram.edges.find((e) => e.id === s.threads?.waitingOn[0]?.[0]);
  const waitingLabel = diagram.nodes.find((n) => n.id === edge?.to)?.label ?? edge?.to ?? "";
  const threadNoun = t("threads.noun", {
    kind: profileOf(node.data.stencil)?.family === "serverless" ? "execution" : "thread",
  });
  const threadBusy = s.threads ? s.threads.working + s.threads.waiting : 0;
  const broker = s.role === "topic" || s.role === "queue" || s.role === "stream";
  const held = broker ? heldWords(s) : null;
  const unread = !!held?.lead;
  const explained = s.role === "processor" || unread;
  const blocked = s.blocked ?? 0;
  const rejected = s.rejected ?? 0;
  const domNode = useStore((store) => store.domNode);
  const transform = useStore((store) => (hovered ? store.transform : null));
  const tooltipId = `live-node-detail-${encodeURIComponent(node.id)}`;
  const hasLatency = !!s.latency;
  useLayoutEffect(() => {
    if (!hovered || !domNode) return;
    const tooltip = document.getElementById(tooltipId);
    const card = domNode.querySelector<HTMLElement>(`[data-testid="node-${CSS.escape(node.id)}"]`);
    if (!tooltip || !card) return;
    const place = () => {
      const scrollTop = tooltip.scrollTop;
      const bounds = domNode.getBoundingClientRect();
      const overlays = document.querySelectorAll<HTMLElement>(
        '[data-testid="live-controls"], [data-testid="live-note"]',
      );
      const bottom = Math.min(bounds.bottom, ...Array.from(overlays).map((el) => el.getBoundingClientRect().top - 8));
      const pane = {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom,
          width: bounds.width,
          height: bottom - bounds.top,
        },
        box = card.getBoundingClientRect();
      const zoom = card.offsetWidth ? box.width / card.offsetWidth : 1;
      const detailScale = tooltip.offsetWidth ? tooltip.getBoundingClientRect().width / tooltip.offsetWidth : zoom;
      tooltip.style.maxWidth = `${Math.max(0, pane.width - 24) / detailScale}px`;
      tooltip.classList.remove("is-compact", "is-summary");
      tooltip.style.maxHeight = "none";
      const room = hasLatency ? Math.min(pane.height - 24, hoverRoom(pane, box)) : pane.height - 24;
      if (tooltip.getBoundingClientRect().height > room) tooltip.classList.add("is-compact");
      // Compact planning rows can still leave a latency card taller than either gap.
      // Keep the percentiles and Properties hint; the full readout stays in Live details.
      if (hasLatency && tooltip.getBoundingClientRect().height > room) {
        tooltip.classList.add("is-summary");
        tooltip.style.maxHeight = `${room / detailScale}px`;
      }
      tooltip.style.left = "0px";
      tooltip.style.bottom = "auto";
      tooltip.style.top = "0px";
      const detail = tooltip.getBoundingClientRect();
      const top = hoverTop(pane, box, detail.height);
      // Round away from the card so fractional viewport scales preserve the badge clearance.
      const offset = (top - detail.top) / zoom;
      tooltip.style.top = `${top >= box.bottom ? Math.ceil(offset) : Math.floor(offset)}px`;
      const left = Math.max(pane.left + 12, Math.min(detail.left, pane.right - 12 - detail.width));
      tooltip.style.left = `${(left - detail.left) / zoom}px`;
      // Measuring at natural height temporarily removes overflow. Keep the user's scroll position.
      tooltip.scrollTop = scrollTop;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(tooltip);
    observer.observe(domNode);
    return () => observer.disconnect();
  }, [hovered, domNode, node.id, tooltipId, transform, node.position.x, node.position.y, hasLatency]);
  useEffect(() => {
    if (!hovered || !domNode) return;
    const el = domNode.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
    if (!el) return;
    const testId = el.dataset.testid;
    el.dataset.testid = `node-live-focus-${node.id}`;
    const previous = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", [previous, tooltipId].filter(Boolean).join(" "));
    return () => {
      // React Flow's own test id comes back with the hover.
      if (testId === undefined) delete el.dataset.testid;
      else el.dataset.testid = testId;
      if (previous === null) el.removeAttribute("aria-describedby");
      else el.setAttribute("aria-describedby", previous);
    };
  }, [hovered, domNode, node.id, tooltipId]);
  return (
    <div
      id={tooltipId}
      className={`lv-detail${hasLatency ? " has-latency nowheel nopan" : ""}`}
      role={hasLatency ? "region" : "tooltip"}
      aria-label={hasLatency ? t("latency.heading") : undefined}
      tabIndex={hasLatency ? 0 : undefined}
      data-live-node-detail={hasLatency ? node.id : undefined}
      data-canvas-reading-region={hasLatency ? "" : undefined}
      data-testid={`node-detail-${node.id}`}
      onKeyDown={
        hasLatency
          ? (event) => {
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              const region = event.currentTarget;
              const page = region.clientHeight * 0.875;
              const top =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? region.scrollHeight
                    : event.key === "PageDown"
                      ? region.scrollTop + page
                      : event.key === "PageUp"
                        ? region.scrollTop - page
                        : null;
              if (top === null) return;
              // Keep paging in this transformed region. Native smooth Home/End scrolls can
              // overlap when the next key arrives before the previous scroll has settled.
              event.preventDefault();
              region.scrollTo({ top, behavior: "instant" });
            }
          : undefined
      }
    >
      {s.threads && (
        <div className="lv-thread-detail" data-testid={`thread-detail-${node.id}`}>
          <b>
            {profileOf(node.data.stencil)?.family === "serverless" ? t("threads.executions") : t("threads.heading")}
          </b>
          <p>
            {Number.isFinite(s.threads.slots)
              ? t("threads.busy", { busy: threadBusy, slots: s.threads.slots, noun: threadNoun })
              : t("threads.unknownPool", { busy: threadBusy, noun: threadNoun })}
          </p>
          <p>
            {s.threads.waiting
              ? t("threads.waiting", {
                  working: s.threads.working,
                  count: s.threads.waitingOn[0]?.[1] ?? s.threads.waiting,
                  name: waitingLabel,
                })
              : t("threads.noneWaiting", { count: s.threads.working })}
          </p>
        </div>
      )}
      {s.threads && Number.isFinite(s.threads.slots) && wait && (
        <ThreadCeiling
          wait={{ ...wait, slots: s.threads.slots, ceiling: (s.threads.slots * 1000) / wait.threadHoldMs }}
          noun={threadNoun}
        />
      )}
      {s.latency && <LatencyReadout id={node.id} latency={s.latency} diagram={diagram} compact />}
      {!!s.threads?.inFlight && (
        <p>
          {t("threads.inFlight", { count: s.threads.inFlight })} · {t("threads.memoryHint")}
        </p>
      )}
      {fault && <p data-testid={`node-fault-detail-${node.id}`}>{t("fault.hover", { fault })}</p>}
      <HoverExplanation id={node.id} />
      {properties && (
        <small className="lv-detail-more" data-testid="node-detail-more">
          {t("planning.moreInProperties")}
        </small>
      )}
      {!explained && (
        <>
          <Row label={doneLabel[s.role]} value={formatCount(s.processed)} />
          <Row label="Throughput" value={formatRate(s.throughput)} />
          {broker ? (
            <Row label={held!.row} value={formatCount(s.backlog)} />
          ) : (
            s.backlog > 0 && <Row label="Waiting" value={formatCount(s.backlog)} />
          )}
          {s.role === "processor" && <Row label="In flight" value={formatCount(s.inFlight)} />}
          {s.role === "processor" && s.replicas !== undefined && (
            <Row
              label="Replicas"
              value={s.idleReplicas ? `${s.activeReplicas} of ${s.replicas} working` : String(s.replicas)}
            />
          )}
          {s.role === "processor" && <Row label="Parallel per replica" value={String(concurrency)} />}
          {units && <Row label="Units" value={`${s.replicas ?? 1} · ${units}`} />}
        </>
      )}
      {!!s.idleReplicas && (
        <p className="lv-detail-note" data-testid={`node-detail-idle-${node.id}`}>
          {t("broker.assigned", { active: s.activeReplicas ?? 0, configured: s.replicas ?? 0 })} ·{" "}
          {assignmentLabel(assignment)}
        </p>
      )}
      {unread && (
        <p className="lv-detail-note" data-testid={`node-detail-unread-${node.id}`}>
          Nobody reads this yet: it keeps every message. Lag is per consumer group, and it has none.
        </p>
      )}
      {cap && cap.level !== "idle" && !unread && <Row label="Capacity" value={cap.text} />}
      {s.failed > 0 && <Row label="Failed attempts" value={formatCount(s.failed)} bad />}
      {s.deadLettered > 0 && <Row label="Dead-lettered" value={formatCount(s.deadLettered)} bad />}
      {s.dropped > 0 && <Row label="Dropped" value={formatCount(s.dropped)} bad />}
      {blocked > 0 && <Row label="Blocked by a deny rule" value={formatCount(blocked)} />}
      {rejected > 0 && <Row label={t("admission.rejected")} value={formatCount(rejected)} />}
      {groups && Object.keys(s.lag).length > 1 && (
        <div className="lv-lag-list">
          <div className="lv-lag-title">{currentModel ? groupLabel(brokerSpec) : "Lag by consumer group"}</div>
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
