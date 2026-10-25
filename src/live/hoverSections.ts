import { t } from "../i18n";
import type { HoverSummary } from "./hoverSummary";

/** Complete availability precedes ranking, including details exposed only after pinning. */
export function cardSections(summary: HoverSummary, kind: "node" | "edge") {
  if (kind === "edge") return summary.sections;
  return [
    ...summary.sections,
    { key: "outcomes", label: t("hover.outcomes"), summary: "" },
    { key: "planning", label: t("hover.planning"), summary: "" },
  ].filter((s, i, all) => all.findIndex((a) => a.key === s.key) === i);
}
