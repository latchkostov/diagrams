import type { NodeSimState } from "../sim/types";
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

export function ThreadMeter({
  id,
  threads,
  noun,
}: {
  id: string;
  threads: NonNullable<NodeSimState["threads"]>;
  noun: string;
}) {
  const busy = threads.working + threads.waiting;
  const fraction = (count: number) => `${Math.min(100, Math.max(0, (count / Math.max(1, threads.slots)) * 100))}%`;
  return (
    <div
      className="lv-threads"
      role="meter"
      aria-label={t("threads.busy", { busy, slots: threads.slots, noun })}
      aria-valuemin={0}
      aria-valuemax={Math.max(1, threads.slots)}
      aria-valuenow={Math.min(busy, threads.slots)}
      data-testid={`thread-meter-${id}`}
      data-working={threads.working}
      data-waiting={threads.waiting}
    >
      <span className="lv-threads-work" style={{ width: fraction(threads.working) }} />
      <span className="lv-threads-wait" style={{ width: fraction(threads.waiting) }}>
        {threads.waiting > 0 && <span aria-hidden>⌛</span>}
      </span>
      {threads.slots <= 32 &&
        Array.from({ length: Math.max(0, Math.floor(threads.slots) - 1) }, (_, i) => (
          <i key={i} style={{ left: `${((i + 1) / threads.slots) * 100}%` }} />
        ))}
    </div>
  );
}
