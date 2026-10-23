import { useEffect, useRef } from "react";
import { t, msg } from "../i18n";
import { useInteraction } from "../canvas/interaction";
import { LiveIcon } from "./icons";
import type { Trouble, TroubleAction } from "./observedTrouble";
import { useFloatingPlacement } from "./useFloatingPlacement";
import { planFixLabel } from "../planning/scalingPlanText";
import { applyThreadFix, type ApplyThreadFix } from "./threadFixes";

/** The callout's one action for what playback shows, by kind: what to press, and its test id. */
const TROUBLE_ACTIONS: Record<TroubleAction["kind"], { label: () => string; icon?: "plus" | "play" }> = {
  resilience: { label: msg("resilience.addBreaker") },
  "scale-threads": { label: msg("autoscaling.scaleBusy") },
  "add-timeout": {
    label: msg("threads.addTimeout"),
  },
  "free-thread": {
    label: msg("threads.freeAction"),
  },
  revive: { label: msg("trouble.restore"), icon: "play" },
  "restore-boundary": { label: msg("trouble.restore"), icon: "play" },
  "clear-fault": { label: msg("fault.clearAction") },
  "add-consumer": { label: msg("trouble.addConsumer"), icon: "plus" },
  "add-dlq": { label: msg("trouble.addDlq"), icon: "plus" },
  events: { label: msg("trouble.events") },
  inputs: { label: msg("trouble.inputs") },
};

interface TroubleProps {
  trouble: Trouble;
  /**
   * Runs the trouble's action, with the button's words (a fix's toast repeats them) and the code that applies a
   * thread fix, which ships in this chunk; omitted where it can't run.
   */
  onAction?: (action: TroubleAction, label: string, applyFix: ApplyThreadFix) => void;
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
  const label =
    trouble.action.kind === "restore-boundary"
      ? t("fault.restoreNamed", { label: trouble.action.label })
      : trouble.action.kind === "resilience"
        ? resilienceFixLabel(trouble.action.step)
        : trouble.action.kind === "scale-threads"
          ? (planFixLabel(trouble.action.plan) ?? "")
          : trouble.action.kind === "clear-fault"
            ? t("fault.clearAction")
            : action.label();
  // On screen: this cause has had its turn this run (one hidden behind a panel or a presentation hasn't).
  useEffect(() => onShown?.(trouble.key), [onShown, trouble.key]);
  const box = useRef<HTMLDivElement>(null);
  const placement = useFloatingPlacement(box, !!floating);
  // Focus inside the callout when it goes (dismissed, revived, the trouble over) returns to the canvas, never <body>
  // (focus policy row L3).
  const focused = useRef(false);
  const interaction = useInteraction();
  const detail =
    trouble.action.kind === "resilience"
      ? t("resilience.fixDescription", { reason: trouble.detail, changes: resilienceFixDetail(trouble.action.step) })
      : trouble.detail;
  useEffect(() => {
    return () => interaction?.dispatch({ type: "callout.closed", hadFocus: focused.current });
  }, [interaction]);
  return (
    <div
      ref={box}
      className={`cap-callout is-over${floating ? " is-floating" : ""}${placement.compact ? " is-compact" : ""}`}
      title={placement.compact ? detail : undefined}
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
        {detail && <span data-testid="trouble-detail">{detail}</span>}
      </div>
      {onAction && (
        <button
          className="btn cap-callout-apply is-fix"
          onClick={() => onAction(trouble.action, label, applyThreadFix)}
          data-testid="trouble-action"
          data-action={trouble.action.kind}
          disabled={!!disabledHint}
          title={disabledHint}
        >
          {action.icon && <LiveIcon name={action.icon} size={13} />} {label}
        </button>
      )}
      <button
        className="icon-btn cap-callout-close"
        onClick={onDismiss}
        aria-label={t("trouble.dismiss")}
        title={t("trouble.dismiss")}
        data-testid="trouble-dismiss"
      >
        <LiveIcon name="close" size={12} />
      </button>
    </div>
  );
}

function resilienceFixLabel(step: import("./resilienceFixPlan").ResilienceStep): string {
  switch (step) {
    case "jitter":
      return t("resilience.fixJitter");
    case "budget":
      return t("resilience.fixBudget");
    case "breaker":
      return t("resilience.addBreaker");
    case "attempts":
      return t("resilience.fixAttempts");
  }
}

function resilienceFixDetail(step: import("./resilienceFixPlan").ResilienceStep): string {
  switch (step) {
    case "jitter":
      return t("resilience.fixJitterDetail");
    case "budget":
      return t("resilience.fixBudgetDetail");
    case "breaker":
      return t("resilience.fixBreakerDetail");
    case "attempts":
      return t("resilience.fixAttemptsDetail");
  }
}
