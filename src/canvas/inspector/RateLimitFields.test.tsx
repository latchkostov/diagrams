import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RateLimitFields } from "./RateLimitFields";
import { admissionFieldBindings } from "../../planning/admissionFieldBindings";
import { resolveProps } from "../../sim/defaults";
import { localRateQuota } from "../../model/admissionPresets";
import { checkApi } from "../../model/admissionSchema";
import type { ApiBehaviour } from "../../model/admission";
import { BulkAdmissionFields } from "../../planning/AdmissionFields";

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
  expect(field.patch(20).api).toEqual({ ...api, quotas: [localRateQuota(20), tokenQuota, sharedQuota] });
  expect(field.patch(undefined).api).toEqual({ ...api, quotas: [tokenQuota, sharedQuota] });
});

const rateBinding = (api: ApiBehaviour) => {
  const props = { api };
  return admissionFieldBindings(
    "generic.rate-limiter",
    props,
    resolveProps("processor", "", props, "generic.rate-limiter", { revision: "p3" }),
  )[0];
};

it.each([false, true])(
  "bulk rate respects the quota ceiling in either selection order (R-d61492b595; full first: %s)",
  (fullFirst) => {
    const quotas = Array.from({ length: 32 }, (_, i) => ({ ...localRateQuota(100), id: `other-${i}` }));
    const full = { id: "full", stencil: "generic.rate-limiter", props: { api: { quotas } } };
    const available = { id: "available", stencil: "generic.rate-limiter", props: { api: { quotas: quotas.slice(1) } } };
    const render = (nodes: (typeof full)[]) =>
      renderToStaticMarkup(<BulkAdmissionFields nodes={nodes} set={() => {}} />);
    const html = render(fullFirst ? [full, available] : [available, full]);
    const input = html.match(/<input[^>]*data-testid="admission-rate"[^>]*>/)?.[0];
    expect(input).toContain('disabled=""');
    const hintId = input?.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toContain(
      `<p id="${hintId}" class="insp-note">This API already has 32 quotas. Remove a quota before adding a local rate limit.</p>`,
    );
    // A full API can still edit or clear its existing rate, whichever node leads the selection.
    const withRate = { ...full, props: { api: { quotas: [localRateQuota(10), ...quotas.slice(1)] } } };
    const editable = render(fullFirst ? [withRate, available] : [available, withRate]);
    expect(editable.match(/<input[^>]*data-testid="admission-rate"[^>]*>/)?.[0]).not.toContain('disabled=""');
    expect(editable).not.toContain("Remove a quota before adding a local rate limit.");
    expect(rateBinding(withRate.props.api).patch(20).api?.quotas).toHaveLength(32);
    expect(rateBinding(withRate.props.api).patch(undefined).api?.quotas).toEqual(quotas.slice(1));
  },
);

it("keeps editing the same first local quota through renders, preserving its unrelated sibling", () => {
  let api: ApiBehaviour = { quotas: [localRateQuota(10), { ...localRateQuota(50), id: "local-rate-2" }] };
  const unrelated = api.quotas![1];
  for (const amount of [20, 30, 40]) {
    const field = rateBinding(api);
    api = field.patch(amount).api!;
    expect(rateBinding(api).value).toBe(amount);
    expect(api.quotas).toEqual([localRateQuota(amount), unrelated]);
    expect(api.quotas![1]).toBe(unrelated);
  }
});

it("refuses a 33rd quota, explains the limit accessibly, and still edits or clears an existing local rate", () => {
  const quotas = Array.from({ length: 32 }, (_, i) => ({ ...localRateQuota(100), id: `other-${i}` }));
  const api = { quotas, maxInFlight: 7 };
  const field = rateBinding(api);
  expect(field.disabled).toBe(true);
  expect(field.patch(20).api).toEqual(api);
  expect(() => checkApi(field.patch(20).api)).not.toThrow();
  const html = renderToStaticMarkup(<RateLimitFields props={{ api }} set={() => {}} />);
  expect(html).toContain('disabled=""');
  expect(html).toContain("Remove a quota before adding a local rate limit.");
  const hintId = html.match(/<p id="([^"]+)" class="insp-note"/)?.[1];
  expect(hintId).toBeTruthy();
  expect(html).toContain(`aria-describedby="${hintId}"`);
  const available = rateBinding({ quotas: quotas.slice(1) });
  expect(available.disabled).toBe(false);
  expect(available.patch(20).api?.quotas).toHaveLength(32);
  const full = rateBinding(available.patch(20).api!);
  expect(full.disabled).toBe(false);
  expect(full.patch(30).api?.quotas).toHaveLength(32);
  expect(rateBinding(full.patch(30).api!).value).toBe(30);
  expect(full.patch(undefined).api?.quotas).toEqual(quotas.slice(1));
});
