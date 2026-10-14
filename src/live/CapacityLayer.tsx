import { memo, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useNodes, useStore } from "@xyflow/react";
import type { FlowNode } from "../canvas/types";
import type { CapacityFix, CapacityView, NodeHeat } from "./capacityModel";
import { LiveIcon } from "./icons";

// The capacity heat map: a coloured ring around each node, a compact label in the badge slot under
// it ("82% · 4.1k/s of 5k/s"), "3/6 idle" for consumers starved of partitions, and the bottleneck
// callout. Live mode draws these inside NodeBadges; edit mode uses <CapacityLayer>.

const LEVEL_WORD: Record<NodeHeat["level"], string> = {
  idle: "no traffic",
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
      data-utilization={Number.isFinite(heat.utilization) ? heat.utilization.toFixed(3) : "inf"}
      aria-label={`${heat.label}: ${LEVEL_WORD[heat.level]}, ${heat.text}`}
    >
      <i aria-hidden />
      <span className="mono">{heat.text}</span>
    </span>
  );
}

/** "3/6 idle", with a hover explanation (the chip takes the pointer; the rest of the layer doesn't). */
export function IdleChip({ id, idle, replicas }: { id: string; idle: number; replicas: number }) {
  if (!(idle > 0)) return null;
  return (
    <span className="cap-idle" data-testid={`capacity-idle-${id}`} data-idle={idle}>
      <b className="mono">
        {idle}/{replicas}
      </b>{" "}
      idle
      <span className="cap-idle-tip" role="tooltip">
        {idle} of {replicas} replicas have no partition to read. A consumer group can&apos;t use more consumers than its
        topic has partitions: add partitions, or run fewer replicas.
      </span>
    </span>
  );
}

/** Edit mode: the heat map over the canvas (live mode renders the same marks in NodeBadges). */
export function CapacityLayer({ view, presenting = false }: { view: CapacityView; presenting?: boolean }) {
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
        <IdleChip id={heat.id} idle={heat.idleReplicas} replicas={heat.replicas} />
      </div>
    </div>
  );
});

interface CalloutProps {
  view: CapacityView;
  /** Applies the fix as an undoable edit; omitted where nothing can be edited. */
  onApply?: (fix: CapacityFix) => void;
  /** Floating over the canvas (top centre) rather than inside the panel. */
  floating?: boolean;
  onOpenPanel?: () => void;
  disabledHint?: string;
  /** "Nobody reads X": adds a consumer of that broker (one undoable edit); omitted where nothing can be edited. */
  onAddConsumer?: (brokerId: string) => void;
}

/** The top bottleneck in plain language, with a one-click fix when it maps to replicas or partitions. */
export function BottleneckCallout({ view, onApply, floating, onOpenPanel, disabledHint, onAddConsumer }: CalloutProps) {
  // Nobody reads the broker in the headline: a consumer is the one action, not resizing something else.
  const reader = view.addConsumer && onAddConsumer ? view.addConsumer : undefined;
  const fix = reader ? null : view.fix;
  const callout = useRef<HTMLDivElement>(null);
  const applied = useRef(false);
  useLayoutEffect(() => {
    if (applied.current && !fix) {
      callout.current?.focus();
      applied.current = false;
    }
  }, [fix]);
  return (
    <div
      ref={callout}
      tabIndex={-1}
      className={`cap-callout is-${view.tone}${floating ? " is-floating" : ""}`}
      data-testid="bottleneck-callout"
      data-tone={view.tone}
      data-node={view.top?.id ?? ""}
      data-canvas-overlay={floating ? "" : undefined}
      data-editor-overlay
      role="status"
    >
      <span className="cap-callout-dot" aria-hidden />
      <div className="cap-callout-text">
        <strong data-testid="bottleneck-headline">{view.headline}</strong>
        <span>{view.detail}</span>
        {fix && (
          <span
            className="cap-callout-fix"
            data-testid="bottleneck-fix"
            title={fix.changes.map((c) => `${c.label} ${c.from} → ${c.to} ${c.key}`).join(", ")}
          >
            Fix: {fix.label}
          </span>
        )}
      </div>
      {reader ? (
        <button
          className="btn cap-callout-apply is-fix"
          onClick={() => onAddConsumer!(reader)}
          data-testid="bottleneck-add-consumer"
          disabled={!!disabledHint}
          title={disabledHint ?? "Add a service that reads it (undo with Ctrl+Z)"}
        >
          <LiveIcon name="plus" size={13} /> Add a consumer
        </button>
      ) : fix && onApply ? (
        <button
          className="btn cap-callout-apply is-fix"
          onClick={() => {
            applied.current = true;
            onApply(fix);
          }}
          data-testid="bottleneck-apply"
          disabled={!!disabledHint}
          title={disabledHint ?? "Apply the fix (undo with Ctrl+Z)"}
        >
          <LiveIcon name="check" size={13} /> Apply fix
        </button>
      ) : (
        onOpenPanel && (
          <button className="btn cap-callout-apply" onClick={onOpenPanel} data-testid="bottleneck-open-panel">
            Inputs…
          </button>
        )
      )}
    </div>
  );
}
