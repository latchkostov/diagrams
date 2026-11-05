import { stencils } from "../../stencils/registry";
import { familyOf } from "../../stencils/profileFamilies";
import { msg } from "../../i18n";
import type { CachePolicy, CacheRule } from "../../model/caching";
import type { Check, Demo, PropPatch, PropPath, TutorialStep, UiStep, Words } from "../types";

/** Match meaning across vendor variants, independently of the example's node ids. */
const family = (name: NonNullable<ReturnType<typeof familyOf>>) => ({
  stencils: stencils.filter((s) => familyOf(s.id) === name).map((s) => s.id),
});
export const cachingSubjects = { readers: family("client"), edge: family("edge"), origin: family("service") };
const matches = {
  products: { methods: ["GET"], path: { kind: "template", value: "/products/{id}" } },
  launch: { path: { kind: "exact", value: "/launch" } },
} satisfies Record<string, CacheRule["match"]>;
type RuleName = keyof typeof matches;
export const rulePath = (field?: string, rule: RuleName = "products"): PropPath => [
  "cache",
  "rules",
  { where: { match: matches[rule] } },
  "policy",
  ...(field ? [field] : []),
];

const ruleMatch = (rule: CacheRule) => {
  const { path, ...rest } = rule.match;
  return { ...rest, ...(path ? { path: { ...path } } : {}) };
};
export const ensureCacheRule = (rule: CacheRule): PropPatch => ({
  op: "ensureItem",
  uniqueId: true,
  path: ["cache", "rules"],
  match: { match: ruleMatch(rule) },
  with: { id: rule.id, policy: { ...rule.policy } },
});

/** Restore missing policy defaults while keeping learner settings and unrelated rules. */
export function repairCacheRule(rule: CacheRule): PropPatch[] {
  const policy: PropPath = ["cache", "rules", { where: { match: ruleMatch(rule) } }, "policy"];
  return [
    ensureCacheRule(rule),
    { op: "unset", path: [...policy, "noStore"] },
    ...Object.entries(rule.policy).map(([field, value]): PropPatch => ({
      op: "setIfMissing",
      path: [...policy, field],
      value,
    })),
  ];
}

export const storingRule = (policy: CachePolicy, rule: RuleName = "products") =>
  repairCacheRule({ id: rule, match: matches[rule], policy });

export const cacheRuleStoringCheck = (rule: CacheRule): Check => ({
  kind: "all",
  checks: [
    {
      kind: "prop",
      subject: "edge",
      prop: ["cache", "rules", { where: { match: ruleMatch(rule) } }, "policy", "noStore"],
      effective: true,
      op: "falsy",
    },
    {
      kind: "prop",
      subject: "edge",
      prop: ["cache", "rules", { where: { match: ruleMatch(rule) } }, "policy", "ttlMs"],
      effective: true,
      op: ">=",
      value: 100,
    },
  ],
});
export const storingCheck = (rule: RuleName = "products"): Check =>
  cacheRuleStoringCheck({ id: rule, match: matches[rule], policy: {} });
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
  keyboardSolution?: TutorialStep["keyboardSolution"],
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
    ...(keyboardSolution ? { keyboardSolution } : {}),
  };
}
