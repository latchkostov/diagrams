import { BROKERS, sameBadge } from "./badgeMemo";
import { defineLazySurface } from "../lib/lazySurface";
import { useWorkbenchDock } from "../canvas/inspector/dockState";
import { inHoverBridge } from "./hoverBridge";
import { useReadoutFocus } from "./useReadoutFocus";
import { DetailsLoading } from "./DetailsLoading";
import { revisionAtLeast } from "../model/revisions";
import { profileOf } from "../stencils/profiles";
import { ThreadMeter, CallPills } from "./lazyWaitingVisuals";
import { nodeFaultLabels } from "../model/faultWords";
import { useInteraction } from "../canvas/interaction";
import { createReadoutLayer } from "../canvas/interaction/readoutLayer";
import { compileTopology } from "../sim/topology";
import { brokerAssignments } from "../sim/brokerAssignments";
import { resolveMultiplier } from "../sim/units";
import type { BrokerSpec } from "../model/brokers";
import { t, useLocale } from "../i18n";
import { memo, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useNodes, useStore } from "@xyflow/react";
import type { DiagramFile } from "../model/types";
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
import { latencyLabel, latencySampling } from "./latencyFormat";
import { readoutDiagram } from "./readoutDiagram";
import { currentHealth, retryPressure } from "./healthWindow";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";

const NodeDetails = defineLazySurface({
  id: "live.node-details",
  load: () => import("./NodeDetails").then((m) => m.NodeDetails),
  placeholder: {
    render: (props, { failed }) => (
      <DetailsLoading
        kind="node"
        id={props.node.id}
        pinned={props.pinned}
        focusClaim={props.focusClaim}
        failed={failed}
      />
    ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});

const EdgeDetails = defineLazySurface({
  id: "live.edge-details",
  load: () => import("./NodeDetails").then((m) => m.EdgeDetails),
  placeholder: {
    render: (props, { failed }) => (
      <DetailsLoading kind="edge" id={props.id} pinned={props.pinned} focusClaim={props.focusClaim} failed={failed} />
    ),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});

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
  const { diagram, topology } = readoutDiagram(ui.controller.currentDiagram, state.running ?? undefined);
  const names = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n.label || n.id])), [diagram]);
  const assignmentMultiplier = resolveMultiplier(state.inputs.capacity ?? state.running?.multipliers?.capacity);
  const assignments = useMemo(
    () => brokerAssignments(diagram, state.configuration, assignmentMultiplier),
    [diagram, state.configuration, assignmentMultiplier],
  );
  // No breakdown while a card is edited inline: the editor hangs where the breakdown would show, and
  // focus in the editor would otherwise count as hovering its node.
  const { editing } = useDiagram();
  const dock = useWorkbenchDock();
  const candidate = useHoveredNode(nodes, state);
  const edgesSelected = useStore((s) => s.edges?.some((e) => e.selected) ?? false);
  const singleNode = nodes.filter((n) => n.selected).length === 1 && !edgesSelected;
  const pointed =
    !presenting &&
    ui.canEdit &&
    dock.value === "properties" &&
    singleNode &&
    candidate?.kind === "node" &&
    nodes.some((n) => n.selected && n.id === candidate.id)
      ? null
      : candidate;
  const focusClaim = useReadoutFocus(pointed);
  useLayoutEffect(() => {
    if (candidate?.kind === "node") ui.controller.runHistory.probe(candidate.id);
  });
  const hovered = !editing && pointed?.kind === "node" ? pointed.id : null;
  // Badges live in flow space; counter-scale them when zoomed out so they stay readable.
  const zoom = useStore((s) => s.transform[2]);
  const boundaryFault = faults?.some((fault) => fault.kind === "boundary") ?? false;
  const inv = Math.min(presenting ? 1.8 : 1.6, Math.max(1, (presenting ? 0.95 : 0.72) / zoom));
  const activeCalls = [];
  for (const e of diagram.edges) {
    const { calls, breaker } = state.snapshot.edges[e.id] ?? {};
    if (!calls) continue;
    const queued = ui.controller.queuedCalls(e.id);
    const timedOut = currentHealth(calls).timedOut;
    if (
      !(breaker && breaker.state !== "closed") &&
      !(calls.held || calls.inFlight || timedOut || retryPressure(calls) || queued)
    )
      continue;
    // Pills only read the pool; source wait semantics are already measured by held/inFlight.
    activeCalls.push({
      id: e.id,
      ...calls,
      timedOut,
      breaker,
      queued,
      pool: callPolicy("", e.props?.caller as EdgeSimProps["caller"]).pool,
      from: names.get(e.from) ?? e.from,
      to: names.get(e.to) ?? e.to,
    });
  }
  return (
    <div
      className={`lv-badges${presenting ? " is-presenting" : ""}`}
      style={{ "--inv": inv.toFixed(3) } as CSSProperties}
    >
      {!editing && pointed?.kind === "edge" && (
        <EdgeDetails
          key={pointed.id}
          diagram={diagram}
          topology={topology}
          state={state}
          id={pointed.id}
          pinned={pointed.pinned}
          focusClaim={focusClaim}
        />
      )}
      {activeCalls.length > 0 && <CallPills calls={activeCalls} readoutScale={inv} presenting={presenting} />}
      {nodes.map((n) => {
        if (n.type !== "diagram") return null;
        const s = state.snapshot.nodes[n.id];
        if (!s || s.role === "none") return null;
        // Concurrency and units only show in the hover breakdown: resolve them for the hovered node alone.
        const props =
          hovered === n.id && (s.role === "processor" || s.role === "gateway")
            ? resolveProps(s.role, n.data.label, ui.controller.effectiveProps(n.id), n.data.stencil, diagram.planning)
            : undefined;
        return (
          <NodeBadge
            key={n.id}
            node={n}
            configuration={state.configuration}
            diagram={diagram}
            s={s}
            showOutageLoss={boundaryFault}
            fault={labels.get(n.id) ?? ""}
            properties={ui.canEdit && !presenting}
            hovered={hovered === n.id}
            pinned={pointed?.pinned ?? false}
            focusClaim={hovered === n.id ? focusClaim : undefined}
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
 * A focused readout keeps its owner; otherwise whichever moved last wins. Focusing a node after its label edit
 * doesn't hide the one hovered next.
 */
const noInteraction = () => () => {};
function useHoveredNode(nodes: FlowNode[], state: LiveState) {
  const interaction = useInteraction();
  const domNode = useStore((s) => s.domNode);
  // Without a canvas interaction layer there are no readout owners to reconcile.
  const edges = useStore((s) => (interaction ? s.edges : null));
  // Live's readout layer (src/canvas/interaction/readoutLayer.ts), attached to the canvas's controller while shown.
  const [readouts] = useState(() => (interaction ? createReadoutLayer(interaction) : null));
  useLayoutEffect(
    () => (interaction && readouts ? interaction.attachReadouts(readouts) : undefined),
    [interaction, readouts],
  );
  // Its own subscription: hovering re-renders this layer, never the canvas root.
  const pointed = useSyncExternalStore(
    readouts?.subscribe ?? noInteraction,
    () => readouts?.get() ?? null,
    () => null,
  );
  const readableNodes = useMemo(() => new Set(nodes.filter((n) => n.type === "diagram").map((n) => n.id)), [nodes]);
  const readableEdges = useMemo(() => new Set(edges?.map((e) => e.id)), [edges]);
  useLayoutEffect(() => {
    readouts?.reconcile((target) => {
      if (target.kind === "edge") return readableEdges.has(target.id);
      const snapshot = state.snapshot.nodes[target.id];
      return readableNodes.has(target.id) && !!snapshot && snapshot.role !== "none";
    });
  }, [readouts, readableNodes, readableEdges, state.snapshot.nodes]);
  useEffect(() => {
    if (!domNode || !readouts) return;
    const itemAt = (el: Element | null) => {
      const card = el?.closest<HTMLElement>("[data-live-readout]");
      if (card) return { kind: card.dataset.liveReadout as "node" | "edge", id: card.dataset.item! };
      if (!el || !domNode.contains(el)) return null;
      const pill = el.closest<HTMLElement>("[data-call-edge]");
      if (pill) return { kind: "edge" as const, id: pill.dataset.callEdge! };
      const node = el.closest<HTMLElement>(".react-flow__node-diagram[data-id]");
      if (node) return { kind: "node" as const, id: node.dataset.id! };
      // Labels live in React Flow's separate HTML layer, outside the SVG edge wrapper. The pointer can hit
      // one even when aimed at the line (for example, at the centre of a straight dead-letter route).
      const label = el.closest<HTMLElement>(".fe-label[data-edge]");
      // Dependencies open their own settings card: a second Live readout would cover it.
      if (label) return label.dataset.dependency ? null : { kind: "edge" as const, id: label.dataset.edge! };
      const edge = el.closest<HTMLElement>(".react-flow__edge[data-id]");
      return edge ? { kind: "edge" as const, id: edge.dataset.id! } : null;
    };
    const point = (e: PointerEvent) => {
      const target = itemAt(e.target instanceof Element ? e.target : null);
      // A geometric bridge makes the card clickable without a timer or a hover race.
      if (!target && inHoverBridge(readouts, domNode, e.clientX, e.clientY)) return;
      readouts.point(target ?? itemAt(document.activeElement));
    };
    const focus = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const target = itemAt(el);
      readouts.recordFocus(el?.closest("[data-live-readout]") ? target : null);
      readouts.point(target);
    };
    const down = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el?.closest("[data-live-readout]")) readouts.close("outside");
    };
    document.addEventListener("pointermove", point);
    document.addEventListener("focusin", focus);
    document.addEventListener("pointerdown", down, true);
    return () => {
      document.removeEventListener("pointermove", point);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", down, true);
      readouts.close("unmount");
    };
  }, [domNode, readouts]);
  return pointed;
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

export interface BadgeProps {
  focusClaim?: () => boolean;
  configuration: LiveState["configuration"];
  diagram: DiagramFile;
  fault: string;
  properties: boolean;
  node: DiagramFlowNode;
  s: NodeSimState;
  hovered: boolean;
  pinned: boolean;
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

const NodeBadge = memo(function NodeBadge(props: BadgeProps) {
  const { node, s, hovered, cap, assignment, showOutageLoss, fault } = props;
  // Each broker owns one immutable peak observation; publishing no longer clones a diagram-wide Map.
  const broker = BROKERS.has(s.role);
  const [[previous, peak], setDepth] = useState(() => [s, Math.max(20, s.backlog)] as const);
  if (broker && previous !== s) setDepth([s, Math.max(20, s.backlog, peak * 0.995)]);
  useLocale();
  const threadNoun = t("threads.noun", {
    kind: profileOf(node.data.stencil)?.family === "serverless" ? "execution" : "thread",
  });

  const threadBusy = s.threads ? s.threads.working + s.threads.waiting : 0;
  const w = node.measured?.width ?? node.width ?? 220;
  const h = node.measured?.height ?? node.height ?? 72;
  const recent = currentHealth(s);
  const problems = recent.dropped;
  // Blocked by a deny rule: on purpose, so never in the red count, and shown apart from it.
  const blocked = s.blocked ?? 0;
  const rejected = Math.max(0, recent.rejected - recent.shed);
  const active = s.processed > 0 || s.inFlight > 0 || s.backlog > 0 || problems > 0 || blocked > 0 || rejected > 0;
  // One slot under the node: with the heat map on, its label (which carries the rate) replaces the
  // throughput readout; a broker keeps its lag only while something is waiting.
  const capShown = !!cap && cap.level !== "idle";
  const latencyBadge = s.latency && (s.role === "sink" || !!cap);
  const showMetric = s.status !== "down" && active && !latencyBadge && !(capShown && (!broker || s.backlog === 0));
  const held = broker ? heldWords(s) : null;
  // A topic nobody reads says so with its count; the heat map's chip would only repeat it as a rate.
  const unread = !!held?.lead;
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
      {showOutageLoss && s.status === "down" && problems > 0 && (
        <div
          className="lv-alert is-lost"
          title={t("fault.droppedCount", { count: problems })}
          data-testid={`node-loss-${node.id}`}
        >
          {`${t("hover.lost")} ${formatCount(problems)}`}
        </div>
      )}
      {problems > 0 && s.status !== "down" && (
        <div
          className="lv-alert is-lost"
          title={t("threads.lostCount", { count: problems })}
          data-testid={`node-alert-${node.id}`}
        >
          {`${t("hover.lost")} ${formatCount(problems)}`}
        </div>
      )}

      {s.status === "up" && problems === 0 && s.processed > 0 && (
        <div className="lv-alert is-processed" title={t("hover.processed")} data-testid={`node-processed-${node.id}`}>
          {formatCount(s.processed)}
        </div>
      )}
      {broker && (s.backlog > 0 || s.processed > 0) && (
        <div className={`lv-depth${unread ? " is-kept" : ""}`} aria-hidden>
          <i style={{ "--d": `${Math.min(100, (s.backlog / peak) * 100).toFixed(1)}%` } as CSSProperties} />
        </div>
      )}

      {s.threads && <ThreadMeter id={node.id} threads={s.threads} noun={threadNoun} />}

      {(fault || active || (cap && cap.level !== "idle") || !!s.idleReplicas || !!s.fleet || !!s.shed) && (
        <div className="lv-strip">
          {!!s.threads?.inFlight && (
            <span className="lv-metric" data-testid={`thread-flight-${node.id}`}>
              ↗ {t("threads.inFlight", { count: s.threads.inFlight })}
            </span>
          )}
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
              className={`lv-metric is-backlog${recent.growing ? " is-hot" : ""}`}
              // Kept, not falling behind: the backlog's amber, never heating towards red.
              style={{ "--heat": unread ? "0" : heatOf(s.backlog).toFixed(3) } as CSSProperties}
              data-testid={`node-metric-${node.id}`}
            >
              <span className="lv-pill-glyph" aria-hidden>
                ◌
              </span>
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
          {!!s.shed && (
            <span
              className="lv-metric is-failover"
              data-testid={`node-shed-${node.id}`}
              title={t("resilience.shedDetail", { count: s.shed })}
            >
              ⤓ {t("resilience.shedCount", { count: s.shed })}
            </span>
          )}
          {s.queueLimit !== undefined && (s.queueDepth ?? 0) > 0 && (
            <span className="lv-metric" data-testid={`node-queue-limit-${node.id}`}>
              ⏳ {t("resilience.queueOf", { count: s.queueDepth ?? 0, limit: s.queueLimit })}
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
              <span className="lv-pill-glyph" aria-hidden>
                ◷
              </span>
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

      {hovered && <NodeDetails {...props} />}
    </div>
  );
}, sameBadge);
