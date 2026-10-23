import type { NodeCapacity } from "../sim/capacity";
import { t } from "../i18n";
import { formatNumber } from "../i18n/format";
import { ReadoutFacts } from "./ReadoutFacts";
import { formatRate } from "./format";

export function ThreadCeiling({
  wait,
  noun,
  docked = false,
}: {
  wait: NonNullable<NodeCapacity["waits"]>;
  noun: string;
  docked?: boolean;
}) {
  return (
    <>
      {docked && (
        <ReadoutFacts
          rows={[[t("threads.ceilingLabel"), formatRate(Math.min(wait.ceiling, wait.poolCeiling ?? Infinity))]]}
        />
      )}
      <p className="lv-thread-ceiling" data-testid="thread-ceiling">
        {!docked && (
          <>
            <b>{t("threads.ceilingLabel")}</b>{" "}
          </>
        )}
        {wait.poolCeiling !== undefined && wait.poolCeiling < wait.ceiling
          ? t("threads.poolCeiling", { rate: formatNumber(wait.poolCeiling, { maximumSignificantDigits: 3 }) })
          : Number.isFinite(wait.threadHoldMs)
            ? wait.replyMs !== undefined && wait.callMs === wait.replyMs
              ? t("threads.freeCeiling", {
                  rate: formatNumber(wait.ceiling, { maximumSignificantDigits: 3 }),
                  slots: wait.slots,
                  noun,
                  seconds: formatNumber(wait.threadHoldMs / 1000),
                  work: wait.workMs,
                  reply: wait.replyMs,
                })
              : t("threads.ceiling", {
                  rate: formatNumber(wait.ceiling, { maximumSignificantDigits: 3 }),
                  slots: wait.slots,
                  noun,
                  seconds: formatNumber(wait.threadHoldMs / 1000),
                  work: wait.workMs,
                  call: wait.callMs,
                })
            : t("threads.cycle")}
      </p>
    </>
  );
}
