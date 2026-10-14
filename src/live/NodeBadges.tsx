import { t } from "../i18n";
import { hoverTop } from "./hoverPlacement";
import { flowEdges } from "../model/relations";
import { memo, useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
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
  const nodes = useNodes<FlowNode>();
  const diagram = ui.controller.currentDiagram;
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
            s={s}
            peak={peak}
            hovered={hovered === n.id}
            cap={capacity?.nodes[n.id]}
            concurrency={props?.concurrency ?? 0}
            units={props?.device && props.device.ha !== "standalone" ? HA_LABEL[props.device.ha] : undefined}
            groups={
              hovered === n.id && (s.role === "topic" || s.role === "stream") ? groupNames(diagram, n.id) : undefined
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
  const domNode = useStore((s) => s.domNode);
  const [id, setId] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pointerLast, setPointerLast] = useState(false);
  useEffect(() => {
    if (!domNode) return;
    const over = (e: PointerEvent) => {
      const el =
        e.target instanceof Element ? e.target.closest<HTMLElement>(".react-flow__node-diagram[data-id]") : null;
      setId(el?.dataset.id ?? null);
      setPointerLast(true);
    };
    const leave = () => setId(null);
    const focus = () => {
      const el = document.activeElement?.closest<HTMLElement>(".react-flow__node-diagram[data-id]");
      setFocused(el?.dataset.id ?? null);
      setPointerLast(false);
    };
    focus();
    domNode.addEventListener("pointerover", over);
    domNode.addEventListener("pointerleave", leave);
    domNode.addEventListener("focusin", focus);
    domNode.addEventListener("focusout", focus);
    return () => {
      domNode.removeEventListener("pointerover", over);
      domNode.removeEventListener("pointerleave", leave);
      domNode.removeEventListener("focusin", focus);
      domNode.removeEventListener("focusout", focus);
    };
  }, [domNode]);
  return pointerLast ? (id ?? focused) : (focused ?? id);
}

/** Consumer-group name → who consumes it, for the lag breakdown. */
function groupNames(d: DiagramFile, nodeId: string): Map<string, string> {
  const labels = new Map(d.nodes.map((n) => [n.id, n.label]));
  const out = new Map<string, string>();
  for (const e of flowEdges(d.edges)) {
    if (e.from !== nodeId) continue;
    const group = typeof e.props?.group === "string" ? e.props.group : e.id;
    const who = labels.get(e.to) ?? e.to;
    out.set(group, out.has(group) ? `${out.get(group)}, ${who}` : who);
  }
  return out;
}

interface BadgeProps {
  node: DiagramFlowNode;
  s: NodeSimState;
  peak: number;
  hovered: boolean;
  concurrency: number;
  /** A network device in a pair or cluster: how its units work ("Active-standby pair"). */
  units?: string;
  groups?: Map<string, string>;
  cap?: NodeHeat;
}

const NodeBadge = memo(function NodeBadge({ node, s, peak, hovered, concurrency, units, groups, cap }: BadgeProps) {
  const domNode = useStore((store) => store.domNode);
  const transform = useStore((store) => (hovered ? store.transform : null));
  const tooltipId = `live-node-detail-${encodeURIComponent(node.id)}`;
  useLayoutEffect(() => {
    if (!hovered || !domNode) return;
    const tooltip = document.getElementById(tooltipId);
    const card = domNode.querySelector<HTMLElement>(`[data-testid="node-${CSS.escape(node.id)}"]`);
    if (!tooltip || !card) return;
    const place = () => {
      const pane = domNode.getBoundingClientRect(),
        box = card.getBoundingClientRect();
      const zoom = card.offsetWidth ? box.width / card.offsetWidth : 1;
      const detailScale = tooltip.offsetWidth ? tooltip.getBoundingClientRect().width / tooltip.offsetWidth : zoom;
      tooltip.style.maxWidth = `${Math.max(0, pane.width - 24) / detailScale}px`;
      tooltip.classList.remove("is-compact");
      if (tooltip.getBoundingClientRect().height > pane.height - 24) tooltip.classList.add("is-compact");
      tooltip.style.left = "0px";
      tooltip.style.bottom = "auto";
      tooltip.style.top = "0px";
      const detail = tooltip.getBoundingClientRect();
      const top = hoverTop(pane, box, detail.height);
      tooltip.style.top = `${(top - detail.top) / zoom}px`;
      const left = Math.max(pane.left + 12, Math.min(detail.left, pane.right - 12 - detail.width));
      tooltip.style.left = `${(left - detail.left) / zoom}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(tooltip);
    observer.observe(domNode);
    return () => observer.disconnect();
  }, [hovered, domNode, node.id, tooltipId, transform, node.position.x, node.position.y]);
  useEffect(() => {
    if (!hovered || !domNode) return;
    const el = domNode.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
    if (!el) return;
    el.dataset.testid = `node-live-focus-${node.id}`;
    const previous = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", [previous, tooltipId].filter(Boolean).join(" "));
    return () => {
      if (previous === null) el.removeAttribute("aria-describedby");
      else el.setAttribute("aria-describedby", previous);
    };
  }, [hovered, domNode, node.id, tooltipId]);
  const w = node.measured?.width ?? node.width ?? 220;
  const h = node.measured?.height ?? node.height ?? 72;
  const broker = BROKERS.has(s.role);
  const heat = heatOf(s.backlog);
  const problems = s.failed + s.deadLettered + s.dropped;
  // Blocked by a deny rule: on purpose, so never in the red count, and shown apart from it.
  const blocked = s.blocked ?? 0;
  const active = s.processed > 0 || s.inFlight > 0 || s.backlog > 0 || problems > 0 || blocked > 0;
  // One slot under the node: with the heat map on, its label (which carries the rate) replaces the
  // throughput readout; a broker keeps its lag only while something is waiting.
  const capShown = !!cap && cap.level !== "idle";
  const showMetric = active && !(capShown && (!broker || s.backlog === 0));
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
      data-processed={s.processed}
      data-backlog={s.backlog}
      data-inflight={s.inFlight}
      data-failed={s.failed}
      data-dlq={s.deadLettered}
      data-blocked={blocked}
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

      {(active || (cap && cap.level !== "idle") || !!s.idleReplicas) && (
        <div className="lv-strip">
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
          {s.failingOver && (
            <span className="lv-metric is-failover" data-testid={`node-failover-${node.id}`}>
              failing over
            </span>
          )}
          <IdleChip id={node.id} idle={s.idleReplicas ?? 0} replicas={s.replicas ?? 0} />
        </div>
      )}

      {hovered && (
        <div id={tooltipId} className="lv-detail" role="tooltip" data-testid={`node-detail-${node.id}`}>
          <HoverExplanation id={node.id} />
          <small className="lv-detail-more" data-testid="node-detail-more">
            {t("planning.moreInProperties")}
          </small>
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
              {s.idleReplicas} of {s.replicas} replicas are idle: a consumer group can&apos;t use more consumers than
              partitions.
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
          {groups && Object.keys(s.lag).length > 1 && (
            <div className="lv-lag-list">
              <div className="lv-lag-title">Lag by consumer group</div>
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
