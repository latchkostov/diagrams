import { matchesRequest, type CompiledRoute } from "../routeMatching";
import { acceptsType } from "../topology";
import type { CacheRuleState } from "./cacheState";

/** First-match selection shared by runtime lookups and tutorial repairs/checks. */
export function firstCacheRule<T extends Pick<CacheRuleState, "match" | "address" | "types">>(
  rules: readonly T[],
  type: string,
  request: CompiledRoute | undefined,
): T | undefined {
  return rules.find(
    (rule) => !rule.match || ((!rule.address || matchesRequest(rule.match, request)) && acceptsType(rule.types, type)),
  );
}
