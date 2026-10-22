import type { Trouble } from "./observedTrouble";

/**
 * Whether the trouble leads the capacity callout when both could show: always, unless it\'s a rising lag the plan
 * already diagnoses with its own action: the same broker (nobody reads it, or it\'s the bottleneck) or one of the
 * consumers behind it over capacity. An unrelated overload elsewhere never hides it.
 */
export function troubleLeads(
  trouble: Trouble,
  view: { tone: string; top?: { id: string }; addConsumer?: string } | null,
): boolean {
  if (!view || trouble.kind !== "lag") return true;
  if (view.addConsumer === trouble.node) return false;
  const top = view.top?.id;
  const overloaded = view.tone === "over" || view.tone === "hot";
  return !(overloaded && !!top && (top === trouble.node || !!trouble.related?.includes(top)));
}
