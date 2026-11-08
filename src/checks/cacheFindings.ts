import { revisionAtLeast } from "../model/revisions";
import type { Simulation } from "../model/types";
import { freePlaySimulation } from "../live/threadFixPlan";
import type { CachePolicy, CacheRule, CacheTable } from "../model/caching";
import { cacheEnabled } from "../model/caching";
import { cacheAsideOrigins } from "../model/cacheAside";
import { popularityTable } from "../sim/cache/popularity";
import { cacheHitShare } from "../sim/cache/cacheMath";
import { confirmedCacheFix, cacheLadder, type CacheFixEvidence } from "../live/cacheFixPlan";
import { fitsRef, requestTargetMatches, type CheckContext } from "./context";
import { findingBudget, findingName, omission } from "./findingBudget";
import { cacheWork, coldCacheSimulation, probeCache } from "./cacheProbe";
import { scaleFix } from "./scaleFix";
import type { CheckFix, CheckRule, Finding } from "./types";

export const CACHE_RULES = ["cache-stampede", "cache-cold-start", "cache-ttl-short", "cache-method"] as const;
type Kind = (typeof CACHE_RULES)[number];
export const CACHE_ABOUT: Record<Kind, { name: string; about: string }> = {
  "cache-stampede": {
    name: "A hot item could flood the origin",
    about:
      "Checks hot-item demand and a Cold cache probe: hard purge at 5 s, replay to 20 s at configured rates. Offers a replay-proven cache policy.",
  },
  "cache-cold-start": {
    name: "The origin cannot carry a cold cache",
    about:
      "Checks whether origin demand exceeds capacity and a Cold cache probe fails to recover within 10 s. At most three caches are probed.",
  },
  "cache-ttl-short": {
    name: "Items expire before they are reused",
    about:
      "Checks rules below 20% expected hits where most requests are for items reused less than once per TTL. A longer TTL is offered only after a 30 s replay.",
  },
  "cache-method": {
    name: "These requests are never stored",
    about: "Checks cache rules matching only methods other than GET and HEAD. Those requests always reach the origin.",
  },
};

const update = (node: string, cache: CacheTable) => ({ op: "update" as const, target: node, props: { cache } });
const withPolicy = (table: CacheTable, rule: string, policy: CachePolicy): CacheTable =>
  rule === ""
    ? { ...table, default: policy }
    : { ...table, rules: table.rules.map((r) => (r.id === rule ? { ...r, policy } : r)) };
function* strings(value: unknown): Generator<string> {
  if (typeof value === "string" || typeof value === "number") yield String(value);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* strings(item);
    }
}

/** Computed once with the request checks in their worker; all four rules read the same findings. */
export function computeCacheFindings(ctx: CheckContext): Finding[] {
  const nodes = ctx.diagram.nodes.filter((n) =>
    cacheEnabled(ctx.diagram.planning, n.stencil, ctx.role(n.id), n.props?.cache),
  );
  if (!nodes.length) return [];
  const analysis = ctx.capacity(),
    work = cacheWork(),
    output = findingBudget();
  let freePlay: Simulation | undefined;
  const setup = () => (freePlay ??= freePlaySimulation(ctx.diagram));
  const findings: Finding[] = [],
    omitted = new Map<Kind, number>();
  const emit = (finding: Finding) => {
    if (!requestTargetMatches(ctx, finding.elements)) return;
    if (output.take(strings(finding))) findings.push(finding);
    else omitted.set(finding.rule as Kind, (omitted.get(finding.rule as Kind) ?? 0) + 1);
  };
  const candidates: {
    node: string;
    table: CacheTable;
    rules: { rule: CacheRule; data: NonNullable<Finding["cacheFinding"]>; edge: string }[];
    score: number;
  }[] = [];
  const make = (
    kind: Kind,
    data: NonNullable<Finding["cacheFinding"]>,
    title: string,
    message: string,
    fix?: CheckFix,
  ): Finding => ({
    id: `${kind}:${data.node}:${data.rule}${
      (kind === "cache-stampede" || kind === "cache-cold-start") &&
      analysis.cacheDemand?.[data.node]?.[data.rule]?.origins &&
      Object.keys(analysis.cacheDemand[data.node][data.rule].origins!).length > 1
        ? `:${data.origin}`
        : ""
    }`,
    rule: kind,
    target: data.node,
    severity: kind === "cache-method" || kind === "cache-ttl-short" ? "suggestion" : "warning",
    elements: [data.node, data.origin].filter(Boolean),
    title,
    message,
    rationale:
      "Cache benefits depend on item reuse. Cold-cache probes use configured traffic, not saved story peaks; replay budgets can leave caches unchecked.",
    cacheFinding: { ...data, kind },
    ...(fix && fitsRef(data.node) ? { fix } : {}),
  });
  for (const node of nodes) {
    const table = node.props!.cache as CacheTable;
    const rules: CacheRule[] = [
      ...table.rules,
      ...(table.default ? [{ id: "", label: "Other requests", match: {}, policy: table.default }] : []),
    ];
    const origins = [
      ...new Set([
        ...ctx
          .requests(node.id)
          .filter((e) => !e.dlq && !e.deny)
          .map((e) => e.to),
        ...cacheAsideOrigins(ctx.diagram, node.id).map((e) => e.to),
      ]),
    ];
    if (ctx.requestTarget !== undefined && !requestTargetMatches(ctx, [node.id, ...origins])) continue;
    const probed: (typeof candidates)[number]["rules"] = [];
    let baseline: ReturnType<typeof probeCache>;
    let baselineTried = false;
    const ttlBase = () => ({ ...coldCacheSimulation(ctx.diagram, node.id, setup), durationMs: 30000, timeline: [] });
    for (const rule of rules) {
      if (rule.policy.noStore) continue;
      const demand = analysis.cacheDemand?.[node.id]?.[rule.id];
      const rate = demand?.rate ?? 0,
        fetchMs = demand?.fetchMs ?? 0;
      const popularity = popularityTable(rule.policy.keys, rule.policy.popularity);
      const hottestPerSec = rate * popularity.hottestShare;
      const ruleOrigins = Object.keys(demand?.origins ?? {});
      const origin = ruleOrigins.length === 1 ? ruleOrigins[0] : origins.length === 1 ? origins[0] : "";
      const capacity = analysis.nodes[origin]?.capacity;
      const data: NonNullable<Finding["cacheFinding"]> = {
        kind: "cache-method",
        node: node.id,
        rule: rule.id,
        origin,
        nodeName: findingName(ctx.name(node.id)),
        ruleName: findingName(rule.label || rule.id || "Other requests"),
        originName: origin ? findingName(ctx.name(origin)) : "the origin",
        hitRatio: demand?.hitRatio ?? 0,
        herd: (hottestPerSec * fetchMs) / 1000,
        coldPerSec: rate,
        capacityPerSec: Number.isFinite(capacity) ? capacity : null,
        ttlMs: rule.policy.ttlMs!,
        hottestPerSec,
      };
      const methods = rule.match.methods;
      if (methods?.length && methods.every((m) => m !== "GET" && m !== "HEAD")) {
        const method = methods.join(", ");
        // Dropping a method-only row avoids accidentally broadening it to every method.
        const cache = { ...table, rules: table.rules.filter((r) => r.id !== rule.id) };
        emit(
          make(
            "cache-method",
            { ...data, method },
            `${data.ruleName} matches ${method} requests, which are never stored.`,
            `They always reach ${data.originName}.`,
            {
              label: "Delete this cache rule",
              cacheLabel: { kind: "method", method },
              ops: [update(node.id, cache)],
            },
          ),
        );
        continue;
      }
      if (
        rate > 0 &&
        demand!.hitRatio < 0.2 &&
        popularity.bands.reduce(
          (sum, band) => sum + ((((rate * band.share) / band.count) * rule.policy.ttlMs!) / 1000 < 1 ? band.share : 0),
          0,
        ) > 0.5
      ) {
        let suggested: number | undefined;
        for (let magnitude = 100; magnitude <= 1e7 && !suggested; magnitude *= 10)
          for (const multiple of [1, 2, 5]) {
            const ttl = magnitude * multiple;
            if (
              ttl > rule.policy.ttlMs! &&
              ttl <= 86400000 &&
              cacheHitShare({ ...rule.policy, ttlMs: ttl }, rate, fetchMs) >= 2 * demand!.hitRatio
            ) {
              suggested = ttl;
              break;
            }
          }
        let fix: CheckFix | undefined;
        if (suggested) {
          const cache = withPolicy(table, rule.id, { ...rule.policy, ttlMs: suggested });
          if (!baselineTried) {
            baselineTried = true;
            baseline = probeCache(ctx.diagram, ttlBase, node.id, origins, work, 30000);
          }
          const before = baseline;
          const after =
            before &&
            probeCache(
              ctx.diagram,
              () => {
                const base = ttlBase();
                return {
                  ...base,
                  setup: {
                    ...base.setup,
                    props: { ...base.setup?.props, [node.id]: { ...base.setup?.props?.[node.id], cache } },
                  },
                };
              },
              node.id,
              origins,
              work,
              30000,
            );
          if (after && after.hitRatio > before!.hitRatio)
            fix = {
              label: `Keep for ${suggested / 1000} s`,
              cacheLabel: { kind: "ttl", value: suggested / 1000 },
              ops: [update(node.id, cache)],
            };
        }
        const suggestedHitRatio = suggested
          ? cacheHitShare({ ...rule.policy, ttlMs: suggested }, rate, fetchMs)
          : undefined;
        emit(
          make(
            "cache-ttl-short",
            { ...data, suggestedTtlMs: suggested, suggestedHitRatio },
            `Most ${data.ruleName} items are reused less often than every ${data.ttlMs / 1000} s.`,
            `So ${Math.round(data.hitRatio * 100)}% hit.` +
              (suggested
                ? ` If they can be up to ${suggested / 1000} s old, ${Math.round(suggestedHitRatio! * 100)}% would.`
                : ""),
            fix,
          ),
        );
      }
      for (const [origin, routed] of Object.entries(demand?.origins ?? {})) {
        if (routed.rate <= 0) continue;
        const hottestPerSec = routed.rate * popularity.hottestShare;
        const capacity = analysis.nodes[origin]?.capacity;
        probed.push({
          rule,
          edge: routed.edge,
          data: {
            ...data,
            origin,
            originName: findingName(ctx.name(origin)),
            coldPerSec: routed.rate,
            hottestPerSec,
            herd: (hottestPerSec * routed.fetchMs) / 1000,
            capacityPerSec: Number.isFinite(capacity) ? capacity : null,
          },
        });
      }
    }
    const coldRates = new Map<string, number>();
    for (const { data } of probed) coldRates.set(data.origin, (coldRates.get(data.origin) ?? 0) + data.coldPerSec);
    // Playback only confirms analytically possible warnings; healthy policies need no replay.
    if (
      probed.some(
        ({ rule, data }) =>
          (data.herd >= 20 && !rule.policy.coalesce && !rule.policy.staleWhileRevalidateMs) ||
          (data.capacityPerSec !== null && coldRates.get(data.origin)! > data.capacityPerSec),
      )
    )
      candidates.push({
        node: node.id,
        table,
        rules: probed,
        score: Math.max(...probed.map((r) => (r.data.herd * r.data.coldPerSec) / (r.data.capacityPerSec || 1))),
      });
  }
  candidates.sort(
    (a, b) => b.score - a.score || ctx.rank(a.node) - ctx.rank(b.node) || a.node.localeCompare(b.node, "en"),
  );
  let unchecked = Math.max(0, candidates.length - 3);
  for (const candidate of candidates.slice(0, 3)) {
    let simulation: Simulation | undefined;
    const coldSimulation = () => (simulation ??= coldCacheSimulation(ctx.diagram, candidate.node, setup));
    const origins = [...new Set(candidate.rules.map((r) => r.data.origin))];
    const before = probeCache(ctx.diagram, coldSimulation, candidate.node, origins, work);
    if (!before) {
      unchecked++;
      continue;
    }
    const emittedCold = new Set<string>();
    const coldDemand = new Map<string, number>();
    for (const { data } of candidate.rules)
      coldDemand.set(data.origin, (coldDemand.get(data.origin) ?? 0) + data.coldPerSec);
    for (const { rule, data, edge } of candidate.rules) {
      const evidence = before.origins[data.origin];
      if (!evidence) continue;
      const probe = { kind: "cold-cache" as const, startMs: 5000, horizonMs: 20000, recovered: evidence.recovered };
      const coldPerSec = coldDemand.get(data.origin)!;
      const stampede =
        data.herd >= 20 && !rule.policy.coalesce && !rule.policy.staleWhileRevalidateMs && evidence.harmed;
      const cold =
        !emittedCold.has(data.origin) &&
        data.capacityPerSec !== null &&
        coldPerSec > data.capacityPerSec &&
        !evidence.recovered;
      if (!stampede && !cold) continue;
      let fix: CheckFix | undefined;
      if (stampede) {
        let baseline: CacheFixEvidence | undefined;
        const context = {
          revision: 0,
          origin: {
            diagram: ctx.diagram,
            simulation: {
              ...coldSimulation(),
              timeline: [],
              durationMs: Math.min(60000, Math.max(20000, 3 * rule.policy.ttlMs! + 5000)),
            },
            initialTraffic: true,
          },
          controls: [],
        };
        const time = Math.max(evidence.herdTime, rule.policy.ttlMs! + 1000);
        const action = confirmedCacheFix({
          context,
          node: candidate.node,
          rule: rule.id,
          edge,
          time,
          budget: work,
          proven: (b) => {
            baseline = b;
          },
        });
        if (action) {
          fix = {
            label: action.step === "coalesce" ? "One fetch per item" : "Serve stale while refreshing",
            cacheLabel: { kind: action.step },
            ops: [update(candidate.node, action.cache)],
          };
          const other =
            action.step === "coalesce"
              ? confirmedCacheFix({
                  context,
                  node: candidate.node,
                  rule: rule.id,
                  edge,
                  time,
                  budget: work,
                  baseline,
                  step: "stale",
                })
              : undefined;
          if (other)
            fix.options = [
              {
                label: "Serve stale while refreshing",
                short: "Serve stale while refreshing",
                cacheLabel: { kind: "stale" },
                ops: [update(candidate.node, other.cache)],
              },
            ];
        }
        emit(
          make(
            "cache-stampede",
            { ...data, probe },
            `A hot item's expiry would flood ${data.originName}.`,
            `${data.ruleName}'s most popular item gets ${Math.round(data.hottestPerSec)}/s. Each time it expires, about ${Math.round(data.herd)} requests reach ${data.originName} before the first reply. Cold cache probe: hard purge at 5 s, replay to 20 s at configured rates.`,
            fix,
          ),
        );
      }
      if (cold) {
        let coldFix: CheckFix | undefined;
        const collapse = cacheLadder(candidate.table, rule.id)[0];
        if (collapse?.step === "coalesce") {
          const next = {
            ...coldSimulation(),
            setup: {
              ...coldSimulation().setup,
              props: {
                ...coldSimulation().setup?.props,
                [candidate.node]: { ...coldSimulation().setup?.props?.[candidate.node], cache: collapse.cache },
              },
            },
          };
          const evidence = probeCache(ctx.diagram, next, candidate.node, origins, work);
          if (evidence?.origins[data.origin]?.recovered)
            coldFix = {
              label: "One fetch per item",
              cacheLabel: { kind: "coalesce" },
              ops: [update(candidate.node, collapse.cache)],
            };
        }
        if (!coldFix) {
          const origin = analysis.nodes[data.origin];
          const sizing =
            origin && scaleFix(ctx, { ...origin, offered: coldPerSec, utilization: coldPerSec / origin.capacity });
          const scale = sizing?.ops?.find((op) => op.op === "update" && op.target === data.origin);
          const replicas = scale?.op === "update" ? scale.props?.replicas : undefined;
          if (sizing && typeof replicas === "number")
            coldFix = {
              ...sizing,
              label: `Add replicas (${replicas})`,
              cacheLabel: { kind: "replicas", value: replicas },
            };
        }
        emit(
          make(
            "cache-cold-start",
            { ...data, coldPerSec, probe },
            `${data.originName} can't carry ${data.nodeName}'s traffic when the cache is cold.`,
            `After a purge or deploy, ${data.originName} gets ${Math.round(coldPerSec)}/s, ${data.capacityPerSec ? (coldPerSec / data.capacityPerSec).toFixed(1) : "∞"}× its capacity, until the cache refills. Cold cache probe: hard purge at 5 s, replay to 20 s; no recovery within 10 s.`,
            coldFix,
          ),
        );
        emittedCold.add(data.origin);
      }
    }
  }
  if (unchecked) findings.push({ ...omission("cache-stampede", 0), unchecked });
  for (const [rule, count] of omitted) findings.push(omission(rule, count));
  return findings;
}

export function cacheRules(read: (ctx: CheckContext) => Finding[]): CheckRule[] {
  return CACHE_RULES.map((id) => ({
    id,
    ...CACHE_ABOUT[id],
    detect(ctx) {
      if (!revisionAtLeast(ctx.diagram.planning?.revision, "p3-w3")) return [];
      const marker = CACHE_RULES.find((rule) => !ctx.ran || ctx.ran.has(rule));
      return read(ctx).flatMap((f) =>
        f.unchecked && f.rule === "cache-stampede"
          ? id === marker
            ? [{ ...f, rule: id }]
            : []
          : f.rule === id
            ? [f]
            : [],
      );
    },
  }));
}
