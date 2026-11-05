import type { CacheRule } from "../model/caching";
import type { CacheExerciseRequest } from "./types";
import { firstCacheRule } from "../sim/cache/selectRule";
import { compileMatch, compileRoutes } from "../sim/routeMatching";

/** Compile predicates only: no cache items, counts, random draws or eager runtime loading. */
export function servingCacheRule(rules: readonly unknown[], { type, ...address }: CacheExerciseRequest): number {
  const compiled = (rules as CacheRule[]).map((rule) => {
    const { types, ...address } = rule.match;
    return { types, match: compileMatch(address), address: Object.keys(address).length > 0 };
  });
  const request = compileRoutes({ revision: "p3-w3", requestRoutes: [{ id: "exercise", address }] })!.get("exercise");
  const selected = firstCacheRule(compiled, type, request);
  return selected ? compiled.indexOf(selected) : -1;
}
