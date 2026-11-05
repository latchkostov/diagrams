import { stencils } from "../../stencils/registry";
import { familyOf } from "../../stencils/profileFamilies";
import { msg } from "../../i18n";
import type { Check, Demo, PropPath, TutorialStep, UiStep, Words } from "../types";

/** Match meaning across vendor variants, independently of the example's node ids. */
const family = (name: NonNullable<ReturnType<typeof familyOf>>) => ({
  stencils: stencils.filter((s) => familyOf(s.id) === name).map((s) => s.id),
});
export const cachingSubjects = { readers: family("client"), edge: family("edge"), origin: family("service") };
export const rulePath = (field: string, rule = "products"): PropPath => [
  "cache",
  "rules",
  { where: { id: rule } },
  "policy",
  field,
];
export const cacheProperties: UiStep[] = [
  { dblclick: "node-{edge}" },
  { open: "dock-edit-properties" },
  { open: "inspector-section-node-cache" },
];

export function cacheEdit(
  id: string,
  copy: { title: Words; goal: Words; done: Words },
  check: Check,
  demo: readonly Demo[],
  field: string,
  solution: readonly UiStep[],
  rule = "products",
): TutorialStep {
  return {
    id,
    ...copy,
    hint: msg("tutorials.caching.editHint"),
    check,
    sticky: true,
    demo,
    targets: [
      { testId: field, priority: "field", tip: copy.title },
      { testId: `cache-rule-${rule}-expires-toggle`, priority: "disclosure", tip: msg("tutorials.caching.openExpiry") },
      { testId: `cache-rule-${rule}`, priority: "disclosure", tip: msg("tutorials.caching.openRule") },
      { testId: "inspector-section-node-cache", selected: "edge", tip: msg("tutorials.caching.openRules") },
      { testId: "dock-edit-properties", selected: "edge", tip: msg("tutorials.caching.editProperties") },
      { testId: "node-{edge}", tip: msg("tutorials.caching.selectEdge") },
    ],
    solution,
  };
}
