import type { NodeCapacity } from "../sim/capacity";
import { t } from "../i18n";
import { formatNumber } from "../i18n/format";

export function ThreadCeiling({ wait, noun }: { wait: NonNullable<NodeCapacity["waits"]>; noun: string }) {
  return (
    <p className="lv-thread-ceiling" data-testid="thread-ceiling">
      <b>{t("threads.ceilingLabel")}</b>{" "}
      {Number.isFinite(wait.holdMs)
        ? t("threads.ceiling", {
            rate: formatNumber(wait.ceiling, { maximumFractionDigits: 2 }),
            slots: wait.slots,
            noun,
            seconds: formatNumber(wait.holdMs / 1000),
            work: wait.workMs,
            call: wait.callMs,
          })
        : t("threads.cycle")}
    </p>
  );
}
