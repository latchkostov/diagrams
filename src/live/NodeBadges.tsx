import { revisionAtLeast } from "../model/revisions";
import { waitingPlan, type WaitCapacity } from "../sim/waitingPlan";
import { stencilRole } from "../stencils/roles";
import { profileOf } from "../stencils/profiles";
import { ThreadMeter, ThreadCeiling } from "./ThreadMeter";
import { nodeFaultLabels } from "../model/faultWords";
import { useInteraction } from "../canvas/interaction";
import { compileTopology } from "../sim/topology";
import { brokerAssignments } from "../sim/brokerAssignments";
import { resolveMultiplier } from "../sim/units";
import type { BrokerSpec } from "../model/brokers";
import { assignmentLabel, groupLabel } from "../stencils/brokerVocabulary";
import { t, useLocale } from "../i18n";
import { hoverRoom, hoverTop } from "./hoverPlacement";
import { memo, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { useNodes, useStore } from "@xyflow/react";
import type { DiagramFile, SimRole } from "../model/types";
import type { NodeSimState } from "../sim/types";
import { resolveProps } from "../sim/defaults";
import type { DiagramFlowNode, FlowNode } from "../canvas/types";
import type { LiveState } from "./controller";
import { useLive } from "./context";
import { useDiagram } from "../canvas/DiagramContext";
import { formatCount, formatRate, heatOf, heldWords } from "./format";
import { LiveIcon } from "./icons";
import type { CapacityView, NodeHeat } from "./capacityModel";
import { CapacityChip, CapacityRing, IdleChip } from "./CapacityLayer";
import { HA_LABEL } from "../stencils/netDevices";
import { NodePlanning } from "../planning/lazy";
import { LatencyReadout } from "./LatencyReadout";
import { latencyLabel, latencySampling } from "./latencyFormat";

const BROKERS: ReadonlySet<SimRole> = new Set(["topic", "queue", "stream"]);

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

/**
 * Per-node live readouts in React Flow's viewport (they pan and zoom with the diagram). Each node
 * shows one primary metric (backlog / lag for brokers, throughput for everything else), a status
 * ring when it isn't up, and a red count when something failed. Hovering a node shows the full
 * breakdown. Re-renders at the UI clock (~8 Hz), never per frame.
 */
export function NodeBadges({
  state,
  presenting,
  capacity,
}: {
  state: LiveState;
  presenting: boolean;
  /** The capacity heat map, when "Show capacity" is on. */
  capacity?: CapacityView | null;
}) {
  const ui = useLive();
  useLocale();
  const faults = state.snapshot.faults;
  const labels = nodeFaultLabels(faults);
  const nodes = useNodes<FlowNode>();
  const diagram = ui.controller.currentDiagram;
  const holds = useMemo(() => {
    if (!revisionAtLeast(diagram.planning?.revision, "p3-w1")) return new Map<string, WaitCapacity>();
    const resolved = Object.fromEntries(
      diagram.nodes.map((n) => [
        n.id,
        resolveProps(
          stencilRole(n.stencil),
          n.label,
          state.configuration[n.id] ?? n.props ?? {},
          n.stencil,
          diagram.planning,
        ),
      ]),
    );
    return waitingPlan(diagram, resolved).nodes;
  }, [diagram, state.configuration]);
  const topology = useMemo(() => compileTopology(diagram), [diagram]);
  const calleeLabels = useMemo(() => {
    const labels = new Map(diagram.nodes.map((n) => [n.id, n.label]));
    return new Map(diagram.edges.map((e) => [e.id, labels.get(e.to) ?? e.to]));
  }, [diagram]);
  const assignmentMultiplier = resolveMultiplier(state.inputs.capacity ?? state.running?.multipliers?.capacity);
  const assignments = useMemo(
    () => brokerAssignments(diagram, state.configuration, assignmentMultiplier),
    [diagram, state.configuration, assignmentMultiplier],
  );
  // No breakdown while a card is edited inline: the editor hangs where the breakdown would show, and
  // focus in the editor would otherwise count as hovering its node.
  const { editing } = useDiagram();
  const pointed = useHoveredNode();
  const hovered = editing ? null : pointed;
  // Badges live in flow space; counter-scale them when zoomed out so they stay readable.
  const zoom = useStore((s) => s.transform[2]);
  const inputs = [state, nodes, ui, hovered, zoom, presenting];
  const [peaks, setPeaks] = useState(() => ({
    inputs,
    values: new Map(Object.entries(state.snapshot.nodes).map(([id, s]) => [id, Math.max(20, s.backlog)])),
  }));
  if (inputs.some((input, i) => input !== peaks.inputs[i])) {
    const values = new Map(peaks.values);
    for (const n of nodes) {
      if (n.type !== "diagram") continue;
      const s = state.snapshot.nodes[n.id];
      if (!s || s.role === "none") continue;
      values.set(n.id, Math.max(20, s.backlog, (values.get(n.id) ?? 0) * 0.995));
    }
    setPeaks({ inputs, values });
  }
  const boundaryFault = state.snapshot.faults?.some((fault) => fault.kind === "boundary") ?? false;
  const inv = Math.min(presenting ? 1.8 : 1.6, Math.max(1, (presenting ? 0.95 : 0.72) / zoom));
  return (
    <div
      className={`lv-badges${presenting ? " is-presenting" : ""}`}
      style={{ "--inv": inv.toFixed(3) } as CSSProperties}
    >
      {nodes.map((n) => {
        if (n.type !== "diagram") return null;
        const s = state.snapshot.nodes[n.id];
        if (!s || s.role === "none") return null;
        const peak = Math.max(20, s.backlog, peaks.values.get(n.id) ?? 0);
        // Concurrency and units only show in the hover breakdown: resolve them for the hovered node alone.
        const props =
          hovered === n.id && (s.role === "processor" || s.role === "gateway")
            ? resolveProps(s.role, n.data.label, ui.controller.effectiveProps(n.id), n.data.stencil, diagram.planning)
            : undefined;
        return (
          <NodeBadge
            key={n.id}
            node={n}
            wait={holds.get(n.id)}
            waitingLabel={calleeLabels.get(s.threads?.waitingOn[0]?.[0] ?? "") ?? ""}
            diagram={diagram}
            s={s}
            showOutageLoss={boundaryFault}
            fault={labels.get(n.id) ?? ""}
            properties={ui.canEdit && !presenting}
            peak={peak}
            hovered={hovered === n.id}
            cap={capacity?.nodes[n.id]}
            assignment={assignments.consumers.get(n.id)?.spec}
            brokerSpec={assignments.brokers.get(n.id)}
            currentModel={revisionAtLeast(diagram.planning?.revision, "p2")}
            concurrency={props?.concurrency ?? 0}
            units={props?.device && props.device.ha !== "standalone" ? HA_LABEL[props.device.ha] : undefined}
            groups={
              hovered === n.id && (s.role === "topic" || s.role === "stream")
                ? groupNames(diagram, n.id, topology)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

/**
 * The diagram node under the pointer, or the focused one (the badge layer itself ignores the pointer).
 * Whichever moved last wins: a node focused after its label edit doesn't hide the one hovered next.
 */
function useHoveredNode(): string | null {
  const interaction = useInteraction();
  const domNode = useStore((s) => s.domNode);
  const [id, setId] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pointerLast, setPointerLast] = useState(false);
  useEffect(() => {
    if (!domNode) return;
    const nodeAt = (target: Element | null) => {
      const detail = target?.closest<HTMLElement>("[data-live-node-detail]");
      return (
        detail?.dataset.liveNodeDetail ??
        target?.closest<HTMLElement>(".react-flow__node-diagram[data-id]")?.dataset.id ??
        null
      );
    };
    const over = (e: PointerEvent) => {
      const node = nodeAt(e.target instanceof Element ? e.target : null);
      // Latency details stay open across the gap to their scrollable surface.
      if (node || !domNode.querySelector("[data-live-node-detail].is-summary")) setId(node);
      setPointerLast(true);
    };
    const leave = () => setId(null);
    const focus = () => {
      setFocused(nodeAt(document.activeElement));
      setPointerLast(false);
    };
    const down = (e: PointerEvent) => {
      if (!nodeAt(e.target instanceof Element ? e.target : null)) setId(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const active = document.activeElement;
      if (e.shiftKey && active?.hasAttribute("data-live-node-detail")) {
        const card = domNode.querySelector<HTMLElement>(`[data-testid="node-${CSS.escape(nodeAt(active)!)}"]`);
        const target = card?.parentElement;
        if (target?.hasAttribute("tabindex")) {
          e.preventDefault();
          interaction?.dispatch({ type: "node.details", target });
        }
        return;
      }
      if (e.shiftKey) return;
      if (!active?.matches(".react-flow__node-diagram[data-id]")) return;
      const detail = document.getElementById(`live-node-detail-${encodeURIComponent(nodeAt(active)!)}`);
      if (!detail?.hasAttribute("data-live-node-detail")) return;
      e.preventDefault();
      interaction?.dispatch({ type: "node.details", target: detail });
    };
    focus();
    domNode.addEventListener("pointerover", over);
    domNode.addEventListener("pointerleave", leave);
    domNode.addEventListener("pointerdown", down);
    domNode.addEventListener("keydown", key);
    domNode.addEventListener("focusin", focus);
    domNode.addEventListener("focusout", focus);
    return () => {
      domNode.removeEventListener("pointerover", over);
      domNode.removeEventListener("pointerleave", leave);
      domNode.removeEventListener("pointerdown", down);
      domNode.removeEventListener("keydown", key);
      domNode.removeEventListener("focusin", focus);
      domNode.removeEventListener("focusout", focus);
    };
  }, [domNode, interaction]);
  return pointerLast ? (id ?? focused) : (focused ?? id);
}

/** Consumer-group name → who consumes it, for the lag breakdown. */
function groupNames(d: DiagramFile, nodeId: string, topology: ReturnType<typeof compileTopology>): Map<string, string> {
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

interface BadgeProps {
  wait?: WaitCapacity;
  waitingLabel: string;
  diagram: DiagramFile;
  fault: string;
  properties: boolean;
  node: DiagramFlowNode;
  s: NodeSimState;
  peak: number;
  hovered: boolean;
  concurrency: number;
  /** A network device in a pair or cluster: how its units work ("Active-standby pair"). */
  units?: string;
  groups?: Map<string, string>;
  cap?: NodeHeat;
  assignment?: BrokerSpec;
  brokerSpec?: BrokerSpec;
  currentModel: boolean;
  showOutageLoss: boolean;
}

const NodeBadge = memo(function NodeBadge({
  node,
  diagram,
  s,
  peak,
  hovered,
  waitingLabel,
  wait,
  concurrency,
  units,
  groups,
  cap,
  assignment,
  brokerSpec,
  currentModel,
  showOutageLoss,
  fault,
  properties,
}: BadgeProps) {
  useLocale();
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
  const threadNoun = t("threads.noun", {
    kind: profileOf(node.data.stencil)?.family === "serverless" ? "execution" : "thread",
  });

  const threadBusy = s.threads ? s.threads.working + s.threads.waiting : 0;
  const w = node.measured?.width ?? node.width ?? 220;
  const h = node.measured?.height ?? node.height ?? 72;
  const broker = BROKERS.has(s.role);
  const heat = heatOf(s.backlog);
  const problems = s.failed + s.deadLettered + s.dropped;
  // Blocked by a deny rule: on purpose, so never in the red count, and shown apart from it.
  const blocked = s.blocked ?? 0;
  const rejected = s.rejected ?? 0;
  const active = s.processed > 0 || s.inFlight > 0 || s.backlog > 0 || problems > 0 || blocked > 0 || rejected > 0;
  // One slot under the node: with the heat map on, its label (which carries the rate) replaces the
  // throughput readout; a broker keeps its lag only while something is waiting.
  const capShown = !!cap && cap.level !== "idle";
  const latencyBadge = s.latency && (s.role === "sink" || !!cap);
  const showMetric = s.status !== "down" && active && !latencyBadge && !(capShown && (!broker || s.backlog === 0));
  const held = broker ? heldWords(s) : null;
  // A topic nobody reads says so with its count; the heat map's chip would only repeat it as a rate.
  const unread = !!held?.lead;
  const explained = s.role === "processor" || unread;
  const style = {
    transform: `translate(${node.position.x}px, ${node.position.y}px)`,
    width: w,
    height: h,
  } as CSSProperties;

  return (
    <div
      className={`lv-node is-${s.status}${hovered ? " is-hovered" : ""}`}
      style={style}
      data-testid={`node-badge-${node.id}`}
      data-status={s.status}
      data-ready={s.fleet?.ready}
      data-starting={s.fleet?.starting}
      data-desired={s.fleet?.desired}
      data-cpu={s.resources?.cpuRequestPct}
      data-processed={s.processed}
      data-backlog={s.backlog}
      data-inflight={s.inFlight}
      data-failed={s.failed}
      data-dropped={s.dropped}
      data-dlq={s.deadLettered}
      data-blocked={blocked}
      data-rejected={rejected}
    >
      {s.status !== "up" && <div className={`lv-ring is-${s.status}`} />}
      {cap && s.status === "up" && <CapacityRing heat={cap} />}
      {s.status === "down" && (
        <div className="lv-down" title="Down: messages fail or are dropped">
          <LiveIcon name="x" size={18} />
        </div>
      )}
      {s.status === "paused" && (
        <div className="lv-paused" title="Paused: messages wait here">
          <LiveIcon name="pause" size={9} /> paused
        </div>
      )}
      {showOutageLoss && s.status === "down" && s.dropped > 0 && (
        <div
          className="lv-alert mono"
          title={t("fault.droppedCount", { count: s.dropped })}
          data-testid={`node-loss-${node.id}`}
        >
          {formatCount(s.dropped)}
        </div>
      )}
      {problems > 0 && s.status !== "down" && (
        <div
          className="lv-alert mono"
          title={`${problems} failed, dead-lettered or dropped`}
          data-testid={`node-alert-${node.id}`}
        >
          {formatCount(problems)}
        </div>
      )}

      {broker && (s.backlog > 0 || s.processed > 0) && (
        <div className={`lv-depth${unread ? " is-kept" : ""}`} aria-hidden>
          <i style={{ "--d": `${Math.min(100, (s.backlog / peak) * 100).toFixed(1)}%` } as CSSProperties} />
        </div>
      )}

      {s.threads && <ThreadMeter id={node.id} threads={s.threads} noun={threadNoun} />}

      {(fault || active || (cap && cap.level !== "idle") || !!s.idleReplicas || !!s.fleet) && (
        <div className="lv-strip">
          {s.threads && threadBusy > 0 && threadBusy >= 0.8 * s.threads.slots && (
            <span className="lv-metric" data-testid={`thread-chip-${node.id}`}>
              ⌛ {t("threads.busy", { busy: threadBusy, slots: s.threads.slots, noun: threadNoun })}
            </span>
          )}
          {fault && (
            <span className="lv-metric is-failover" data-testid={`node-fault-${node.id}`}>
              {fault}
            </span>
          )}
          {!showMetric ? null : broker ? (
            <span
              className={`lv-metric is-backlog${s.backlog > 0 ? " is-hot" : ""}`}
              // Kept, not falling behind: the backlog's amber, never heating towards red.
              style={{ "--heat": unread ? "0" : heat.toFixed(3) } as CSSProperties}
              data-testid={`node-metric-${node.id}`}
            >
              {held!.lead && `${held!.lead} · `}
              <b className="mono">{formatCount(s.backlog)}</b> {held!.unit}
            </span>
          ) : (
            <span
              className={`lv-metric is-rate${s.throughput >= 0.05 ? " is-on" : ""}`}
              data-testid={`node-metric-${node.id}`}
            >
              <LiveIcon name="bolt" size={10} />
              <b className="mono">{formatRate(s.throughput)}</b>
            </span>
          )}
          {s.status !== "down" && latencyBadge && s.latency && (
            <span className="lv-metric mono" data-testid={`node-latency-${node.id}`} title={latencySampling(s.latency)}>
              {latencyLabel(s.latency)}
            </span>
          )}
          {/* Capacity describes the current outage and waiting traffic, unlike stale throughput/latency. */}
          {cap && !(unread && showMetric) && <CapacityChip heat={cap} />}
          {blocked > 0 && (
            <span
              className="lv-metric is-blocked"
              title="Blocked by a deny rule: on purpose, not lost"
              data-testid={`node-blocked-${node.id}`}
            >
              <span className="lv-blocked-glyph" aria-hidden />
              <b className="mono">{formatCount(blocked)}</b> blocked
            </span>
          )}
          {rejected > 0 && (
            <span className="lv-metric is-blocked" data-testid={`node-rejected-${node.id}`}>
              {t("admission.rejected")} · {formatCount(rejected)}
            </span>
          )}
          {s.failingOver && (
            <span className="lv-metric is-failover" data-testid={`node-failover-${node.id}`}>
              failing over
            </span>
          )}
          {s.fleet && (
            <span className="lv-metric" data-testid={`node-fleet-${node.id}`}>
              {s.fleet.starting
                ? t("autoscaling.startingBadge", s.fleet)
                : s.fleet.draining
                  ? t("autoscaling.drainingBadge", s.fleet)
                  : t("autoscaling.badge", s.fleet)}
              {s.fleet.decision?.reason === "max" && <> · {t("autoscaling.maxReached")}</>}
            </span>
          )}
          <IdleChip id={node.id} idle={s.idleReplicas ?? 0} replicas={s.replicas ?? 0} assignment={assignment} />
        </div>
      )}

      {hovered && (
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
              wait={{ ...wait, slots: s.threads.slots, ceiling: (s.threads.slots * 1000) / wait.holdMs }}
              noun={threadNoun}
            />
          )}
          {s.latency && <LatencyReadout id={node.id} latency={s.latency} diagram={diagram} compact />}
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
      )}
    </div>
  );
});

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
