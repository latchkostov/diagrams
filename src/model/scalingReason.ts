/** Persisted diagnostic details are deterministic English; UI presents a translated recovery category. */
export function scalingReasonCode(reason: string): string {
  return /Job execution/.test(reason)
    ? "job"
    : /Conflicting|owner|ownership/.test(reason)
      ? "conflict"
      : /container/i.test(reason)
        ? "container"
        : /bounds|budget|numeric|quantity|range/.test(reason)
          ? "bounds"
          : /topic|group|subscription|binding|history/.test(reason)
            ? "binding"
            : /Delayed|visibility/.test(reason)
              ? "visibility"
              : /version/.test(reason)
                ? "version"
                : /fields/.test(reason)
                  ? "fields"
                  : "metric";
}
