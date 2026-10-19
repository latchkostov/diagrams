import { t } from "../i18n";
import type { DiagramFile } from "../model/types";
import type { LiveState } from "./controller";

/** The final run evidence, in real units. Authored expectation labels and IDs are never parsed as prose. */
export function runEndResult(state: LiveState, diagram: DiagramFile): string | undefined {
  if (!state.run?.done) return;
  const largest = diagram.nodes.reduce<{ count: number; label: string }>(
    (loss, node) => {
      const sample = state.snapshot.nodes[node.id];
      // Match expectations and Checks' dropped evidence. Dead-letter transfers are retained traffic.
      const count = sample?.dropped ?? 0;
      return count > loss.count ? { count, label: node.label || t("fault.unnamedTarget") } : loss;
    },
    { count: 0, label: "" },
  );
  if (largest.count > 0) return t("runResult.loss", largest);
  if (state.run.expectations.some((expectation) => expectation.status === "fail")) return t("runResult.noLossFailed");
  if (state.run.expectations.some((expectation) => expectation.status === "pending"))
    return t("runResult.noLossPending");
  return t("runResult.noLoss");
}
