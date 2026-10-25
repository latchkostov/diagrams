import { t } from "../i18n";
import type { NodeSimProps } from "../sim/types";
import type { ResolvedProps } from "../sim/defaults";
import { managedKind, localRateQuota } from "../model/admissionPresets";

/** Property mappings used by single and bulk editors; every exposed field changes admission. */
export function admissionFieldBindings(stencil: string, props: Record<string, unknown>, resolved: ResolvedProps) {
  const api = resolved.admission?.api ?? {};
  const serverless = managedKind(stencil) === "serverless";
  const patchApi = (patch: Partial<NonNullable<NodeSimProps["api"]>>) => ({ api: { ...api, ...patch } });
  const field = (
    name: "allocation" | "rate" | "concurrency" | "latency" | "errors",
    value: number | undefined,
    patch: (value: number | undefined) => Partial<NodeSimProps>,
    max: number,
    step = 1,
  ) => ({ name, value, patch, max, step });
  const rate = api.quotas?.find(
    (quota) => /^local-rate(?:-\d+)?$/.test(quota.id) && quota.unit === "requests" && !quota.sharedGroup,
  );
  // A file may already use the conventional ID for a different unit or shared scope.
  const quotaIds = new Set(api.quotas?.map((quota) => quota.id));
  let rateId = rate?.id ?? "local-rate";
  for (let suffix = 2; !rate && quotaIds.has(rateId); suffix++) rateId = `local-rate-${suffix}`;
  return [
    serverless
      ? field("allocation", resolved.admission?.slots, (value) => ({ maxConcurrency: value }), 10000)
      : field(
          "rate",
          rate ? (rate.amount * 1000) / rate.windowMs : undefined,
          (value) =>
            patchApi({
              quotas: [
                ...(api.quotas ?? []).filter((quota) => quota !== rate),
                ...(value !== undefined && value > 0 ? [{ ...localRateQuota(value), id: rateId }] : []),
              ],
            }),
          10000000,
          0.1,
        ),
    ...(serverless && (props.scaling ?? "auto") === "auto"
      ? []
      : [
          field(
            "concurrency",
            serverless ? resolved.concurrency * resolved.replicas : api.maxInFlight,
            (value) => (serverless ? { concurrency: value, replicas: 1 } : patchApi({ maxInFlight: value })),
            10000,
          ),
        ]),
    field(
      "latency",
      api.latencyMs ?? resolved.latencyMs,
      (value) => ({ latencyMs: value, api: { ...api, latencyMs: undefined } }),
      600000,
    ),
    field(
      "errors",
      (api.errorRate ?? resolved.failureRate) * 100,
      (value) => ({ failureRate: (value ?? 0) / 100, api: { ...api, errorRate: undefined } }),
      100,
      0.1,
    ),
  ];
}

/** Display labels shared by admission fields and their collapsed Inspector summary. */
export const admissionFieldLabel = (name: ReturnType<typeof admissionFieldBindings>[number]["name"]) =>
  ({
    allocation: t("admission.allocation"),
    rate: t("admission.rate"),
    concurrency: t("admission.concurrency"),
    latency: t("admission.latency"),
    errors: t("admission.errors"),
  })[name];
