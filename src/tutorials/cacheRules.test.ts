import { expect, it, vi } from "vitest";
import type { CacheRule } from "../model/caching";
import * as routing from "../sim/routeMatching";
import { servingCacheRule } from "./cacheRules";
import type { CacheExerciseRequest } from "./types";

it("reuses compiled exercise addresses and predicates across live publishes, and follows edits", () => {
  const match = vi.spyOn(routing, "compileMatch");
  const route = vi.spyOn(routing, "compileRoutes");
  const rules: CacheRule[] = [
    { id: "products", match: { methods: ["GET"], path: { kind: "prefix", value: "/products/" } }, policy: {} },
  ];
  const request: CacheExerciseRequest = { type: "Readers", method: "GET", path: "/products/item" };
  try {
    for (let publish = 0; publish < 24; publish++) expect(servingCacheRule(rules, request)).toBe(0);
    expect(match).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledTimes(1);
    // An in-place edit must invalidate the compiled meaning too.
    rules[0].match.path!.value = "/orders/";
    expect(servingCacheRule(rules, request)).toBe(-1);
    expect(match).toHaveBeenCalledTimes(2);
    request.path = "/orders/item";
    expect(servingCacheRule(rules, request)).toBe(0);
    expect(route).toHaveBeenCalledTimes(2);
    rules[0].match.types = ["Orders"];
    expect(servingCacheRule(rules, request)).toBe(-1);
    request.type = "Orders";
    expect(servingCacheRule(rules, request)).toBe(0);
    expect(match).toHaveBeenCalledTimes(2);
    expect(route).toHaveBeenCalledTimes(2);
  } finally {
    vi.restoreAllMocks();
  }
});
