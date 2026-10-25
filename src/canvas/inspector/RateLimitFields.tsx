import { AdmissionInput } from "../../planning/AdmissionFields";
import { admissionFieldBindings } from "../../planning/admissionFieldBindings";
import { t } from "../../i18n";
import { resolveProps } from "../../sim/defaults";
import type { NodeSimProps } from "../../sim/types";

/** The inline limiter edits the same local request quota as managed APIs, in the lazy Inspector. */
export function RateLimitFields({
  props,
  set,
}: {
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>, key?: string) => void;
}) {
  const resolved = resolveProps("processor", "", props, "generic.rate-limiter", { revision: "p3" });
  const field = admissionFieldBindings("generic.rate-limiter", props, resolved)[0];
  return (
    <AdmissionInput
      {...field}
      label={t("inspector.rateLimit")}
      hint={t("inspector.rateLimitHint")}
      testId="inspector-field-rate-limit"
      change={(value) => set(field.patch(value), "rate-limit")}
    />
  );
}
