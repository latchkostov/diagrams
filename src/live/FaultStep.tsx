import { t, useLocale } from "../i18n";
import { faultTarget, type Fault } from "../model/faults";
import type { DiagramFile } from "../model/types";
import { defaultFault, faultTargets } from "./faults";

export function FaultStep({
  fault,
  diagram,
  testId,
  onChange,
}: {
  fault: Fault;
  diagram: DiagramFile;
  testId: string;
  onChange(fault: Fault): void;
}) {
  useLocale();
  const targets = faultTargets(diagram, fault.kind);
  const target = faultTarget(fault);
  const value =
    fault.kind === "boundary"
      ? String(fault.down)
      : fault.kind === "link"
        ? String(fault.cut)
        : fault.kind === "slow"
          ? String(fault.factor)
          : String(fault.rate);
  return (
    <div className="lv-step-body">
      <label>
        <span>{t("fault.kind")}</span>
        <select
          value={fault.kind}
          aria-label={t("fault.kind")}
          data-testid={`${testId}-fault-kind`}
          onChange={(e) => onChange(defaultFault(e.target.value as Fault["kind"], diagram))}
        >
          <option value="boundary" disabled={!faultTargets(diagram, "boundary").length}>
            {t("fault.boundary")}
          </option>
          <option value="link" disabled={!faultTargets(diagram, "link").length}>
            {t("fault.link")}
          </option>
          <option value="slow" disabled={!faultTargets(diagram, "slow").length}>
            {t("fault.slow")}
          </option>
          <option value="fail" disabled={!faultTargets(diagram, "fail").length}>
            {t("fault.fail")}
          </option>
        </select>
      </label>
      <label>
        <span>{t("fault.target")}</span>
        <select
          value={target}
          aria-label={t("fault.target")}
          data-testid={`${testId}-fault-target`}
          onChange={(e) =>
            onChange(
              fault.kind === "boundary"
                ? { ...fault, boundary: e.target.value }
                : fault.kind === "link"
                  ? { ...fault, edge: e.target.value }
                  : { ...fault, node: e.target.value },
            )
          }
        >
          {!targets.some((n) => n.id === target) && <option value={target}>{target || t("fault.target")}</option>}
          {targets.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label || n.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("fault.magnitude")}</span>
        <select
          value={value}
          aria-label={t("fault.magnitude")}
          data-testid={`${testId}-fault-value`}
          onChange={(e) =>
            onChange(
              fault.kind === "boundary"
                ? { ...fault, down: e.target.value === "true" }
                : fault.kind === "link"
                  ? { ...fault, cut: e.target.value === "true" }
                  : fault.kind === "slow"
                    ? { ...fault, factor: Number(e.target.value) as 1 | 2 | 5 | 10 }
                    : { ...fault, rate: Number(e.target.value) as 0 | 0.1 | 0.5 },
            )
          }
        >
          {fault.kind === "boundary" ? (
            <>
              <option value="true">{t("fault.takeDown")}</option>
              <option value="false">{t("fault.restore")}</option>
            </>
          ) : fault.kind === "link" ? (
            <>
              <option value="true">{t("fault.cut")}</option>
              <option value="false">{t("fault.reconnect")}</option>
            </>
          ) : fault.kind === "slow" ? (
            [1, 2, 5, 10].map((factor) => (
              <option key={factor} value={factor}>
                {factor === 1 ? t("fault.normal") : t("fault.factor", { factor })}
              </option>
            ))
          ) : (
            [0, 0.1, 0.5].map((rate) => (
              <option key={rate} value={rate}>
                {rate === 0 ? t("fault.noFailures") : t("fault.rate", { rate: rate * 100 })}
              </option>
            ))
          )}
        </select>
      </label>
    </div>
  );
}
