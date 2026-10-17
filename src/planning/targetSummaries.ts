/** One measurement batch per table: read every full label before compacting any of them. */
export function createTargetSummaries() {
  interface Summary {
    full: string;
    short: string;
    width?: number;
  }
  const summaries = new Map<HTMLElement, Summary>();
  let observer: ResizeObserver | undefined;
  let queued = false;
  const paint = (span: HTMLElement, summary: Summary, available: number) => {
    const text = available < summary.width! ? summary.short : summary.full;
    if (span.textContent !== text) span.textContent = text;
  };
  return {
    add(span: HTMLElement, full: string, short: string) {
      const summary: Summary = { full, short };
      summaries.set(span, summary);
      observer ??= new ResizeObserver((entries) => {
        for (const entry of entries) {
          const span = entry.target as HTMLElement;
          const summary = summaries.get(span);
          if (summary?.width !== undefined) paint(span, summary, entry.contentRect.width);
        }
      });
      observer.observe(span);
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          const pending = [...summaries].filter(([, summary]) => summary.width === undefined);
          // React may retain our compact DOM text when only the localized short form changed.
          // Restore every changed label before measuring any of them.
          for (const [span, summary] of pending) if (span.textContent !== summary.full) span.textContent = summary.full;
          const measurements = pending.map(([span, summary]) => {
            const range = document.createRange();
            range.selectNodeContents(span);
            summary.width = Math.ceil(range.getBoundingClientRect().width);
            return { span, summary, available: span.clientWidth };
          });
          for (const { span, summary, available } of measurements) paint(span, summary, available);
        });
      }
      return () => {
        observer?.unobserve(span);
        summaries.delete(span);
        if (!summaries.size) {
          observer?.disconnect();
          observer = undefined;
        }
      };
    },
  };
}
