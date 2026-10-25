import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RateLimitFields } from "./RateLimitFields";
import { admissionFieldBindings } from "../../planning/admissionFieldBindings";
import { resolveProps } from "../../sim/defaults";
import { localRateQuota } from "../../model/admissionPresets";

it("the lazy inline limiter field names its units and represents an unknown quota", () => {
  const html = renderToStaticMarkup(<RateLimitFields props={{}} set={() => {}} />);
  expect(html).toContain('data-testid="inspector-field-rate-limit"');
  expect(html).toContain("Rate limit");
  expect(html).toContain("Requests per second.");
  expect(html).toContain('value=""');
});

it("editing or clearing the inline quota preserves all other budgets and API settings", () => {
  const tokenQuota = { ...localRateQuota(30), id: "tokens", unit: "tokens" as const };
  const sharedQuota = { ...localRateQuota(40), id: "account", sharedGroup: "partner" };
  const api = {
    maxInFlight: 7,
    sharedConcurrency: "partner",
    costPerRequest: { tokens: 2 },
    quotas: [localRateQuota(10), tokenQuota, sharedQuota],
  };
  const props = { api };
  const [field] = admissionFieldBindings(
    "generic.rate-limiter",
    props,
    resolveProps("processor", "", props, "generic.rate-limiter", { revision: "p3" }),
  );
  expect(field.value).toBe(10);
  expect(field.patch(20).api).toEqual({ ...api, quotas: [tokenQuota, sharedQuota, localRateQuota(20)] });
  expect(field.patch(undefined).api).toEqual({ ...api, quotas: [tokenQuota, sharedQuota] });
});
