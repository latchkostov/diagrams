import { t, useLocale } from "../i18n";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import type { BrokerSpec } from "../model/brokers";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useNodes, useStore } from "@xyflow/react";
import type { FlowNode } from "../canvas/types";
import type { CapacityFix, CapacityView, NodeHeat } from "./capacityModel";
import { LiveIcon } from "./icons";
import type { Trouble, TroubleAction } from "./observedTrouble";
import { calloutOffset } from "./calloutPlacement";
import { inflate, type Rect } from "../canvas/geometry/rect";

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
export function IdleChip({
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
  const placement = useFloatingPlacement(callout, !!floating);
  const applied = useRef(false);
  // The action's button goes once it's done (the fix applied, the consumer added): keep focus on the callout.
  useLayoutEffect(() => {
    if (applied.current && !fix && !reader) {
      callout.current?.focus();
      applied.current = false;
    }
  }, [fix, reader]);
  return (
    <div
      ref={callout}
      tabIndex={-1}
      className={`cap-callout is-${view.tone}${floating ? " is-floating" : ""}${placement.compact ? " is-compact" : ""}`}
      title={placement.compact ? view.detail : undefined}
      data-compact={placement.compact ? "" : undefined}
      style={placement.style}
      data-below={placement.below ? "" : undefined}
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
          onClick={() => {
            applied.current = true;
            onAddConsumer?.(reader);
          }}
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

/** The callout's one action for what playback shows, by kind: what to press, and its test id. */
const TROUBLE_ACTIONS: Record<TroubleAction["kind"], { label: string; icon?: "plus" | "play" }> = {
  revive: { label: "Revive", icon: "play" },
  "add-consumer": { label: "Add a consumer", icon: "plus" },
  "add-dlq": { label: "Add dead-letter queue", icon: "plus" },
  events: { label: "Show events" },
  inputs: { label: "Inputs…" },
};

interface TroubleProps {
  trouble: Trouble;
  /** Runs the trouble's action; omitted (no button) where it can't run here. */
  onAction?: (action: TroubleAction) => void;
  onDismiss: () => void;
  /** The callout is on screen with this cause (once per cause). */
  onShown?: (key: string) => void;
  /** Floating over the canvas (top centre). */
  floating?: boolean;
  disabledHint?: string;
}

/**
 * What playback shows going wrong (src/live/observedTrouble.ts): a node down, messages lost, a lag that keeps
 * rising. It comes on its own, with one action, and goes when dismissed or when the trouble ends.
 */
export function TroubleCallout({ trouble, onAction, onDismiss, onShown, floating, disabledHint }: TroubleProps) {
  const action = TROUBLE_ACTIONS[trouble.action.kind];
  // On screen: this cause has had its turn this run (one hidden behind a panel or a presentation hasn't).
  useEffect(() => onShown?.(trouble.key), [onShown, trouble.key]);
  const box = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(box, !!floating);
  // Focus inside the callout when it goes (dismissed, revived, the trouble over) returns to the canvas, never <body>.
  const focused = useRef(false);
  useEffect(() => {
    const wrap = box.current?.closest<HTMLElement>(".canvas-wrap");
    return () => {
      if (focused.current && (document.activeElement === document.body || !document.activeElement))
        wrap?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      ref={box}
      className={`cap-callout is-over${floating ? " is-floating" : ""}${placement.compact ? " is-compact" : ""}`}
      title={placement.compact ? trouble.detail : undefined}
      data-compact={placement.compact ? "" : undefined}
      style={placement.style}
      data-testid="trouble-callout"
      data-kind={trouble.kind}
      data-node={trouble.node}
      data-below={placement.below ? "" : undefined}
      data-canvas-overlay={floating ? "" : undefined}
      data-editor-overlay
      onFocus={() => (focused.current = true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused.current = false;
      }}
    >
      <span className="cap-callout-dot" aria-hidden />
      <div className="cap-callout-text">
        <strong data-testid="trouble-headline">{trouble.headline}</strong>
        {trouble.detail && <span data-testid="trouble-detail">{trouble.detail}</span>}
      </div>
      {onAction && (
        <button
          className="btn cap-callout-apply is-fix"
          onClick={() => onAction(trouble.action)}
          data-testid="trouble-action"
          data-action={trouble.action.kind}
          disabled={!!disabledHint}
          title={disabledHint}
        >
          {action.icon && <LiveIcon name={action.icon} size={13} />} {action.label}
        </button>
      )}
      <button
        className="icon-btn cap-callout-close"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
        data-testid="trouble-dismiss"
      >
        <LiveIcon name="close" size={12} />
      </button>
    </div>
  );
}

/** Room a floating callout needs beside the title card for its words and buttons. */
const CALLOUT_MIN = 420;

/**
 * Where a floating callout sits: top centre (CSS), or, when the canvas leaves too little room right of the diagram's
 * title card (narrow screens, side panels open), below the card at the canvas's full width, so its words and buttons
 * never squeeze or clip. Follows the canvas and the card as they resize.
 */
function useFloatingPlacement(box: RefObject<HTMLElement | null>, floating: boolean) {
  // Beside the card: centred in the room right of it (never on it, whatever the canvas centre); below: under it.
  const [place, setPlace] = useState<{
    below: boolean;
    top: number;
    left?: number;
    room?: number;
    dx: number;
    dy: number;
    compact: boolean;
  }>({
    below: false,
    top: 0,
    dx: 0,
    dy: 0,
    compact: false,
  });
  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.offsetParent;
    if (!floating || !el || !(parent instanceof HTMLElement)) return;
    const wrap = el.closest(".canvas-wrap");
    const card = wrap?.querySelector<HTMLElement>(".diagram-card");
    const toggle = wrap?.querySelector<HTMLElement>('[data-testid="live-toggle"]');
    const measure = () => {
      const p = parent.getBoundingClientRect();
      const c = card && !card.hidden ? card.getBoundingClientRect() : null;
      const t = toggle?.getBoundingClientRect();
      const right = t ? Math.min(p.right - 16, t.left - 16) : p.right - 16;
      const room = c ? right - (c.right + 16) : right - p.left - 16;
      const below = room < CALLOUT_MIN;
      const top = Math.round(Math.max(c?.bottom ?? p.top, t?.bottom ?? p.top) - p.top + 8);
      const left = !below ? Math.round((c?.right ?? p.left) - p.left + 16 + room / 2) : undefined;
      const width = !below ? Math.floor(room) : undefined;
      // A callout can arrive after fit-view. Move the callout off nodes rather than stealing
      // their pointer targets or moving the diagram. Re-evaluate after pan, zoom or resize.
      const rect = (r: DOMRect): Rect => ({ x: r.left - p.left, y: r.top - p.top, width: r.width, height: r.height });
      const obstacles = [
        ...(wrap?.querySelectorAll<HTMLElement>(
          '.react-flow__node-diagram, [data-canvas-overlay], [data-testid="live-toggle"], [data-testid="live-controls"], [data-testid="canvas-controls"], [data-testid="canvas-minimap"]',
        ) ?? []),
      ]
        .filter((item) => item !== el && !item.contains(el) && !el.contains(item))
        .map((item) => inflate(rect(item.getBoundingClientRect()), 8));
      const desired = () => ({
        x: below ? 16 : (left ?? p.width / 2) - el.offsetWidth / 2,
        y: below ? top : window.innerWidth <= 1280 ? 60 : 16,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
      // Measure the full card even while folded, so finding room for the compact row never
      // toggles it back to a full card that covers a node. Keep the reason in the accessible text.
      const wasCompact = el.classList.contains("is-compact");
      el.classList.remove("is-compact");
      let offset = calloutOffset(desired(), p, obstacles);
      const compact = !offset;
      if (compact) {
        el.classList.add("is-compact");
        offset = calloutOffset(desired(), p, obstacles);
      }
      el.classList.toggle("is-compact", wasCompact);
      const { dx, dy } = offset ?? { dx: 0, dy: 0 };
      setPlace((old) =>
        old.below === below &&
        old.top === top &&
        old.left === left &&
        old.room === width &&
        old.dx === dx &&
        old.dy === dy &&
        old.compact === compact
          ? old
          : { below, top, left, room: width, dx, dy, compact },
      );
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(parent);
    watch.observe(el);
    if (card) watch.observe(card);
    if (toggle) watch.observe(toggle);
    const viewport = wrap?.querySelector(".react-flow__viewport");
    const movement = new MutationObserver(measure);
    if (viewport) movement.observe(viewport, { attributes: true, attributeFilter: ["style"] });
    return () => {
      watch.disconnect();
      movement.disconnect();
    };
  }, [box, floating]);
  return {
    below: place.below,
    compact: place.compact,
    style: {
      translate: `${place.dx}px ${place.dy}px`,
      ...(place.below
        ? ({ "--callout-top": `${place.top}px` } as CSSProperties)
        : place.left !== undefined && place.room !== undefined
          ? ({ left: place.left, maxWidth: place.room, minWidth: Math.min(340, place.room) } as CSSProperties)
          : {}),
    },
  };
}
