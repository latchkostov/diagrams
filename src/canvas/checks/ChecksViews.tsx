import { useSyncExternalStore, type ReactNode } from "react";
import { lazyComponent } from "../../lib/lazyLoad";
import type { RowHost } from "../../checks/ui/FindingRow";
import { checksPanel } from "./checksPanel";
import { defineLazySurface } from "../../lib/lazySurface";
const ChecksMarkers = defineLazySurface({
  id: "canvas.check-markers",
  load: () => import("./ChecksMarkers").then((m) => m.ChecksMarkers),
  placeholder: {},
  focus: {},
  export: "skip",
  retryToast: true,
});
import { useChecksState, useHotFinding, type ChecksStore } from "./useChecks";

// What shows the checks on the canvas, each subscribed to the canvas's ChecksStore on its own, so a new result or
// a hovered row re-renders only these, never the canvas. The card and the inspector's row are a lazy chunk.

const loadChecksUi = () => import("../../checks/ui/ChecksCard");
const ChecksCard = lazyComponent(() => loadChecksUi().then((m) => m.ChecksCard));
const InspectorFindings = lazyComponent(() => loadChecksUi().then((m) => m.InspectorFindings));

export type ChecksHost = RowHost & {
  open(): void;
  /** Focus back to what opened the card, else the canvas. */
  returnFocus(): void;
};

/**
 * The diagram card's meta row: "Edited, reset" (when given) and the count of warnings. Warnings only: suggestions
 * never show uninvited, and with none there's nothing (never "0 issues").
 */
export function DiagramCardMeta({
  store,
  reset,
  showWarnings,
}: {
  store: ChecksStore;
  reset: ReactNode;
  open: boolean;
  showWarnings: boolean;
}) {
  const warnings = useSyncExternalStore(store.subscribe, () => (showWarnings ? store.get().warnings : 0));
  if (!reset && !warnings) return null;
  return <div className="diagram-card-meta">{reset}</div>;
}

export function ChecksCardView({
  store,
  host,
  top,
  onMount,
}: {
  store: ChecksStore;
  host: ChecksHost;
  top: number;
  onMount(): void;
}) {
  const state = useChecksState(store);
  return (
    <ChecksCard
      {...host}
      applied={store.markStale}
      result={state.result}
      state={state}
      top={top}
      onMount={() => {
        onMount();
        // The card's code arrived (on a Retry, too): a check that couldn't download its own code runs again.
        store.retryFailed();
      }}
      onClose={() => checksPanel.close()}
      simulations={{ view: state.evidence, run: store.runSimulations, stop: store.stopSimulations }}
    />
  );
}

export function ChecksMarkersView({ store }: { store: ChecksStore }) {
  const { result, byElement } = useChecksState(store);
  const hot = useHotFinding(store);
  return result ? <ChecksMarkers byElement={byElement} hot={hot} /> : null;
}

/** A single selected node's or connection's findings, at the top of its inspector. */
export function SelectionFindings({ store, id, host }: { store: ChecksStore; id: string; host: ChecksHost }) {
  const state = useChecksState(store);
  const findings = state.byElement.get(id);
  return findings?.length ? (
    <InspectorFindings findings={findings} host={{ ...host, applied: store.markStale }} state={state} />
  ) : null;
}
