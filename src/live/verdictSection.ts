export function verdictSection(key?: string, kind: "node" | "edge" = "node", readers?: boolean): string | null {
  if (kind === "edge")
    return key === "breaker" ? "breaker" : key === "timeout" ? "timeouts" : key === "retry" ? "retries" : null;
  if (key === "waiting" && readers !== undefined) return readers ? "readers" : null;
  if (key === "threads" || key === "retry" || key === "waiting") return "threads";
  if (key === "timeout") return "latency";
  if (key === "lag" || key === "unread") return "readers";
  if (key === "memory") return "resources";
  if (key === "loss" || key === "failed" || key === "rejected" || key === "down") return "outcomes";
  return null;
}
