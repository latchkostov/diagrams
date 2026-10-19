import { expect, it } from "vitest";
import { PLANNING_REVISIONS, revisionAtLeast } from "./revisions";

it("enables every predecessor capability and rejects unknown revisions", () => {
  for (const [i, revision] of PLANNING_REVISIONS.entries())
    for (const [j, minimum] of PLANNING_REVISIONS.entries()) expect(revisionAtLeast(revision, minimum)).toBe(i >= j);
  for (const value of [undefined, "constructor", "p99", {}, null]) expect(revisionAtLeast(value, "p1")).toBe(false);
});
