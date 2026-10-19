import type { NodeSimState } from "../sim/types";
import { t } from "../i18n";

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
  const known = Number.isFinite(threads.slots);
  const fraction = (count: number) => `${Math.min(100, Math.max(0, (count / Math.max(1, threads.slots)) * 100))}%`;
  if (!known)
    return (
      <span className="sr-only" data-testid={`thread-meter-${id}`}>
        {t("threads.unknownPool", { busy, noun })}
      </span>
    );
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
