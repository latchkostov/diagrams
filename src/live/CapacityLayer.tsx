import { t, useLocale } from "../i18n";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import type { BrokerSpec } from "../model/brokers";
import { memo, type CSSProperties } from "react";
import { useNodes, useStore } from "@xyflow/react";
import type { FlowNode } from "../canvas/types";
import type { CapacityView, NodeHeat } from "./capacityModel";

// The capacity heat map: a coloured ring around each node, a compact label in the badge slot under
// it ("82% · 4.1k/s of 5k/s"), "3/6 idle" for consumers starved of partitions, and the bottleneck
// callout. Live mode draws these inside NodeBadges; edit mode uses <CapacityLayer>.

const LEVEL_WORD: Record<Exclude<NodeHeat["level"], "idle">, string> = {
  ok: "healthy",
  warn: "busy",
  hot: "near capacity",
  over: "over capacity",
};

export function CapacityRing({ heat }: { heat: NodeHeat }) {
  if (heat.level === "idle") return null;
  return (
    <div className={`cap-ring is-${heat.level}`} data-testid={`capacity-ring-${heat.id}`} data-level={heat.level} />
  );
}

export function CapacityChip({ heat }: { heat: NodeHeat }) {
  if (heat.level === "idle" || !heat.text) return null;
  return (
    <span
      className={`cap-chip is-${heat.level}`}
      data-testid={`capacity-label-${heat.id}`}
      data-level={heat.level}
      {...(import.meta.env.VITE_E2E === "1"
        ? { "data-utilization": Number.isFinite(heat.utilization) ? heat.utilization.toFixed(3) : "inf" }
        : {})}
      aria-label={`${heat.label}: ${LEVEL_WORD[heat.level]}, ${heat.text}`}
    >
      <i aria-hidden />
      <span className="mono">{heat.text}</span>
    </span>
  );
}

/** "3/6 idle", with a hover explanation (the chip takes the pointer; the rest of the layer doesn't). */
export const IdleChip = memo(function IdleChip({
  id,
  idle,
  replicas,
  assignment,
}: {
  id: string;
  idle: number;
  replicas: number;
  assignment?: BrokerSpec;
}) {
  useLocale();
  if (!(idle > 0)) return null;
  return (
    <span className="cap-idle" data-testid={`capacity-idle-${id}`} data-idle={idle}>
      <b className="mono">
        {idle}/{replicas}
      </b>{" "}
      idle
      <span className="cap-idle-tip" role="tooltip">
        {assignmentLabel(assignment)} · {t("broker.assigned", { active: replicas - idle, configured: replicas })}
      </span>
    </span>
  );
});

/** Edit mode: the heat map over the canvas (live mode renders the same marks in NodeBadges). */
export function CapacityLayer({ view, presenting }: { view: CapacityView; presenting?: boolean }) {
  const nodes = useNodes<FlowNode>();
  const zoom = useStore((s) => s.transform[2]);
  const inv = Math.min(presenting ? 1.8 : 1.6, Math.max(1, (presenting ? 0.95 : 0.72) / zoom));
  return (
    <div
      className={`lv-badges cap-layer${presenting ? " is-presenting" : ""}`}
      style={{ "--inv": inv.toFixed(3) } as CSSProperties}
      data-testid="capacity-layer"
    >
      {nodes.map((n) => {
        if (n.type !== "diagram") return null;
        const heat = view.nodes[n.id];
        if (!heat || (heat.level === "idle" && !heat.idleReplicas)) return null;
        return (
          <CapacityNode
            key={n.id}
            heat={heat}
            x={n.position.x}
            y={n.position.y}
            w={n.measured?.width ?? n.width ?? 220}
            h={n.measured?.height ?? n.height ?? 72}
          />
        );
      })}
    </div>
  );
}

const CapacityNode = memo(function CapacityNode({
  heat,
  x,
  y,
  w,
  h,
}: {
  heat: NodeHeat;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  useLocale();
  return (
    <div
      className="lv-node"
      style={{ transform: `translate(${x}px, ${y}px)`, width: w, height: h }}
      data-testid={`capacity-node-${heat.id}`}
      data-level={heat.level}
    >
      <CapacityRing heat={heat} />
      <div className="lv-strip">
        <CapacityChip heat={heat} />
        <IdleChip id={heat.id} idle={heat.idleReplicas} replicas={heat.replicas} assignment={heat.assignment} />
      </div>
    </div>
  );
});
