import { useLayoutEffect, useRef } from "react";
import type { CapacityFix, CapacityView } from "./capacityModel";
import { LiveIcon } from "./icons";
import { useFloatingPlacement } from "./useFloatingPlacement";

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
