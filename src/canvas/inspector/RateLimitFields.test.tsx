import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RateLimitFields } from "./RateLimitFields";
import { admissionFieldBindings } from "../../planning/admissionFieldBindings";
import { resolveProps } from "../../sim/defaults";
import { localRateQuota } from "../../model/admissionPresets";
import { checkApi } from "../../model/admissionSchema";
import type { ApiBehaviour } from "../../model/admission";

it("the lazy inline limiter field names its units and represents an unknown quota", () => {
  const html = renderToStaticMarkup(<RateLimitFields props={{}} set={() => {}} />);
  expect(html).toContain('data-testid="inspector-field-rate-limit"');
  expect(html).toContain("Rate limit");
  expect(html).toContain("Requests per second.");
  expect(html).toContain('value=""');
  const hintId = html.match(/<p id="([^"]+)" class="insp-note"/)?.[1];
  expect(hintId).toBeTruthy();
  expect(html).toContain(`aria-describedby="${hintId}"`);
  expect(html).not.toContain("title=");
});

it.each([
  { ...localRateQuota(30), unit: "tokens" as const },
  { ...localRateQuota(40), unit: "bytes" as const },
  { ...localRateQuota(50), sharedGroup: "partner" },
])("preserves an unrelated quota named local-rate: %j", (unrelated) => {
  const binding = (api: ApiBehaviour) => {
    const props = { api };
    return admissionFieldBindings(
      "generic.rate-limiter",
      props,
      resolveProps("processor", "", props, "generic.rate-limiter", { revision: "p3" }),
    )[0];
  };
  const field = binding({ quotas: [unrelated] });
  expect(field.value).toBeUndefined();
  expect(field.patch(undefined).api).toEqual({ quotas: [unrelated] });
  const added = field.patch(20).api!;
  expect(added).toEqual({ quotas: [unrelated, { ...localRateQuota(20), id: "local-rate-2" }] });
  expect(() => checkApi(added)).not.toThrow();
  const edited = binding(added);
  expect(edited.value).toBe(20);
  expect(edited.patch(10).api).toEqual({ quotas: [unrelated, { ...localRateQuota(10), id: "local-rate-2" }] });
  expect(edited.patch(undefined).api).toEqual({ quotas: [unrelated] });
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
