import { t } from "../i18n";
import type { DiagramFile } from "../model/types";
import type { SimSnapshot, EdgeSimProps } from "../sim/types";
import { timeoutOutcome } from "./timeoutOutcome";

/** Display only: failed attempts may recover; only drops and dead letters count as lost. */
export function nodeOutcome(
  d: DiagramFile,
  snapshot: Pick<SimSnapshot, "nodes" | "edges">,
  id: string,
): string | undefined {
  const n = snapshot.nodes[id];
  if (!n) return;
  const calls = d.edges.filter((e) => e.from === id);
  const timedOut = calls.reduce((sum, e) => sum + (snapshot.edges[e.id]?.calls?.timedOut ?? 0), 0);
  const late = calls.reduce((sum, e) => sum + (snapshot.edges[e.id]?.calls?.late ?? 0), 0);
  const count = n.dropped + n.deadLettered;
  if (!(count || n.failed || timedOut || late)) return;
  const deadlines = new Set(
    calls
      .filter((e) => snapshot.edges[e.id]?.calls?.timedOut)
      .map((e) => (e.props?.caller as EdgeSimProps["caller"])?.deadlineMs),
  );
  const seconds = deadlines.size === 1 ? [...deadlines][0] : undefined;
  const gateway = timeoutOutcome(d, snapshot, id, count);
  const outcome =
    gateway ??
    t("threads.lossOutcome", {
      count,
      timedOut,
      seconds: (seconds ?? 0) / 1000,
      timeouts: count > 0 && timedOut === count && seconds ? "all" : timedOut ? "some" : "none",
      deadLettered: n.deadLettered,
      dropped: n.dropped,
    });
  return t("threads.outcome", {
    outcome,
    attempts: n.failed > 0 && n.failed !== count ? "show" : "hide",
    failed: n.failed,
    late,
  });
}
