export function verdictSection(key?: string, kind: "node" | "edge" = "node", readers?: boolean): string | null {
  if (kind === "edge")
    return key === "breaker"
      ? "breaker"
      : key === "timeout" || key === "failed"
        ? "outcomes"
        : key === "retry"
          ? "retries"
          : null;
  if (key === "waiting" && readers !== undefined) return readers ? "readers" : null;
  if (key === "threads" || key === "retry" || key === "breaker" || key === "waiting") return "threads";
  if (key === "timeout") return "latency";
  if (key === "lag" || key === "unread") return "readers";
  if (key === "memory") return "resources";
  if (key === "loss" || key === "failed" || key === "rejected" || key === "shed" || key === "down") return "outcomes";
  return null;
}

/** A preferred detail must exist on this surface; an empty connection has no fallback. */
export function availableVerdictSection(preferred: string | null, sections: readonly { key: string }[]): string | null {
  if (!preferred) return null;
  return sections.some((s) => s.key === preferred) ? preferred : (sections[0]?.key ?? null);
}
