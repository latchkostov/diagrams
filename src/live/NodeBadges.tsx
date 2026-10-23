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
import { latencyLabel, latencySampling } from "./latencyFormat";
import { simulationEdges } from "../sim/simulationEdges";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";

import { lazyComponent } from "../lib/lazyLoad";

const NodeDetails = lazyComponent(() => import("./NodeDetails").then((m) => m.NodeDetails));

const EdgeDetails = lazyComponent(() => import("./NodeDetails").then((m) => m.EdgeDetails));

const BROKERS: ReadonlySet<SimRole> = new Set(["topic", "queue", "stream"]);

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
  const diagram = simulationEdges(ui.controller.currentDiagram, state.running ?? undefined);
  const names = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n.label || n.id])), [diagram]);
  const topology = useMemo(() => compileTopology(diagram), [diagram]);
  const assignmentMultiplier = resolveMultiplier(state.inputs.capacity ?? state.running?.multipliers?.capacity);
  const assignments = useMemo(
    () => brokerAssignments(diagram, state.configuration, assignmentMultiplier),
    [diagram, state.configuration, assignmentMultiplier],
  );
  // No breakdown while a card is edited inline: the editor hangs where the breakdown would show, and
  // focus in the editor would otherwise count as hovering its node.
  const { editing } = useDiagram();
  const pointed = useHoveredNode();
  const hovered = !editing && pointed?.kind === "node" ? pointed.id : null;
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
  const activeCalls = diagram.edges.flatMap((e) => {
    const calls = state.snapshot.edges[e.id]?.calls;
    const breaker = state.snapshot.edges[e.id]?.breaker;
    if (!calls) return [];
    const queued = ui.controller.queuedCalls(e.id);
    if (
      !(breaker && breaker.state !== "closed") &&
      !(calls.held || calls.inFlight || calls.timedOut || (calls.windowRetried ?? 0) >= 10 || queued)
    )
      return [];
    // Pills only read the pool; source wait semantics are already measured by held/inFlight.
    const policy = callPolicy("", e.props?.caller as EdgeSimProps["caller"]);
    return [
      {
        id: e.id,
        ...calls,
        breaker,
        queued,
        pool: policy.pool,
        from: names.get(e.from) ?? e.from,
        to: names.get(e.to) ?? e.to,
      },
    ];
  });
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
        />
      )}
      {activeCalls.length > 0 && <CallPills calls={activeCalls} readoutScale={inv} presenting={presenting} />}
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
            configuration={state.configuration}
            diagram={diagram}
            s={s}
            showOutageLoss={boundaryFault}
            fault={labels.get(n.id) ?? ""}
            properties={ui.canEdit && !presenting}
            peak={peak}
            hovered={hovered === n.id}
            pinned={pointed?.pinned ?? false}
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
const noInteraction = () => () => {};
function useHoveredNode() {
  const interaction = useInteraction();
  const domNode = useStore((s) => s.domNode);
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
      const edge = el.closest<HTMLElement>(".react-flow__edge[data-id]");
      return edge ? { kind: "edge" as const, id: edge.dataset.id! } : null;
    };
    const point = (e: PointerEvent) => {
      const target = itemAt(e.target instanceof Element ? e.target : null);
      if (!target) {
        const open = readouts.get();
        const card = document.querySelector<HTMLElement>("[data-live-readout]");
        const anchor =
          open && domNode.querySelector<HTMLElement>(`[data-testid="${open.kind}-${CSS.escape(open.id)}"]`);
        // A geometric bridge makes the card clickable without a timer or a hover race.
        if (card && anchor) {
          const a = anchor.getBoundingClientRect(),
            b = card.getBoundingClientRect();
          if (
            e.clientX >= Math.min(a.left, b.left) &&
            e.clientX <= Math.max(a.right, b.right) &&
            e.clientY >= Math.min(a.top, b.top) &&
            e.clientY <= Math.max(a.bottom, b.bottom)
          )
            return;
        }
      }
      readouts.point(target ?? itemAt(document.activeElement));
    };
    const focus = (e: FocusEvent) => readouts.point(itemAt(e.target instanceof Element ? e.target : null));
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
  configuration: LiveState["configuration"];
  diagram: DiagramFile;
  fault: string;
  properties: boolean;
  node: DiagramFlowNode;
  s: NodeSimState;
  peak: number;
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
  const { node, s, peak, hovered, cap, assignment, showOutageLoss, fault } = props;
  useLocale();
  const threadNoun = t("threads.noun", {
    kind: profileOf(node.data.stencil)?.family === "serverless" ? "execution" : "thread",
  });

  const threadBusy = s.threads ? s.threads.working + s.threads.waiting : 0;
  const w = node.measured?.width ?? node.width ?? 220;
  const h = node.measured?.height ?? node.height ?? 72;
  const broker = BROKERS.has(s.role);
  const heat = heatOf(s.backlog);
  const problems = s.deadLettered + s.dropped;
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
          title={t("threads.lostCount", { count: problems })}
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

      {hovered && <NodeDetails {...props} />}
    </div>
  );
});
