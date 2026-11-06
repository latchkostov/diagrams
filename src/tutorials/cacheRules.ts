import type { CacheRule } from "../model/caching";
import type { CacheExerciseRequest } from "./types";
import { firstCacheRule } from "../sim/cache/selectRule";
import { compileMatch, compileRoutes, type CompiledRoute } from "../sim/routeMatching";

// Live checks and pending repairs revisit the same paths on every publish. Reuse their compiled meaning;
// content stamps also follow in-place edits, and weak keys release discarded exercises and rule tables.
const predicates = new WeakMap<CacheRule["match"], { key: string; match: ReturnType<typeof compileMatch> }>();
const requests = new WeakMap<CacheExerciseRequest, { key: string; request: CompiledRoute }>();

/** Compile predicates only: no cache items, counts, random draws or eager runtime loading. */
export function servingCacheRule(rules: readonly unknown[], exercise: CacheExerciseRequest): number {
  const { type, ...address } = exercise;
  const compiled = (rules as CacheRule[]).map((rule) => {
    const { types, ...address } = rule.match;
    const key = JSON.stringify(address);
    let cached = predicates.get(rule.match);
    if (cached?.key !== key) {
      cached = { key, match: compileMatch(address) };
      predicates.set(rule.match, cached);
    }
    return { types, match: cached.match, address: Object.keys(address).length > 0 };
  });
  const key = JSON.stringify(address);
  let cached = requests.get(exercise);
  if (cached?.key !== key) {
    cached = {
      key,
      request: compileRoutes({ revision: "p3-w3", requestRoutes: [{ id: "exercise", address }] })!.get("exercise")!,
    };
    requests.set(exercise, cached);
  }
  const selected = firstCacheRule(compiled, type, cached.request);
  return selected ? compiled.indexOf(selected) : -1;
}
