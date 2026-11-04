import { expect, it } from "vitest";
import { faultWindowLabel } from "./faultWindowWords";
import { cacheFixture } from "../lab/cacheFixture";

it("provides a purge clause for the latency scope's single since", () => {
  expect(faultWindowLabel({ kind: "purge", node: "cache" }, cacheFixture())).toBe("Edge cache was purged");
});
