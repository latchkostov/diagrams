import type { LiveState } from "./controller";
import { t } from "../i18n";
import { formatCount, formatScale } from "./format";

export function InFlight({ state }: { state: LiveState }) {
  return (
    <span
      className="lv-stat"
      data-testid="live-in-system"
      data-count={state.snapshot.inSystem}
      title={`Messages travelling, queued or being processed${state.scale > 1 ? ` (real messages; 1 dot ≈ ${formatScale(state.scale)})` : ""}`}
    >
      {t("hover.inFlight")} <strong>{formatCount(state.snapshot.inSystem)}</strong>
    </span>
  );
}
