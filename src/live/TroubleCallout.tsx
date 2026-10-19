import { useEffect, useRef } from "react";
import { t } from "../i18n";
import { useInteraction } from "../canvas/interaction";
import { LiveIcon } from "./icons";
import type { Trouble, TroubleAction } from "./observedTrouble";
import { useFloatingPlacement } from "./CapacityLayer";

/** The callout's one action for what playback shows, by kind: what to press, and its test id. */
const TROUBLE_ACTIONS: Record<TroubleAction["kind"], { label: string; icon?: "plus" | "play" }> = {
  "free-thread": {
    get label() {
      return t("threads.freeAction");
    },
  },
  revive: { label: "Restore", icon: "play" },
  "restore-boundary": { label: "Restore", icon: "play" },
  "clear-fault": { label: "Clear fault" },
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
  // Focus inside the callout when it goes (dismissed, revived, the trouble over) returns to the canvas, never <body>
  // (focus policy row L3).
  const focused = useRef(false);
  const interaction = useInteraction();
  useEffect(() => {
    return () => interaction?.dispatch({ type: "callout.closed", hadFocus: focused.current });
  }, [interaction]);
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
          {action.icon && <LiveIcon name={action.icon} size={13} />}{" "}
          {trouble.action.kind === "restore-boundary"
            ? t("fault.restoreNamed", { label: trouble.action.label })
            : trouble.action.kind === "clear-fault"
              ? t("fault.clearAction")
              : action.label}
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
