import type { DiagramChecks } from "../model/types";
import type { Evidence, PlannedLoss } from "./evidence";
import type { CheckResult, Finding, FindingEvidence } from "./types";

// What Run simulations' counts (src/checks/evidence.ts) mean, decided against the checks as they are now: counts on
// the findings they bear out, `dropped` for losses nothing else explains, and the losses a simulation meant. Cheap and
// free of the simulation engine, so the Checks card can run it on every new check result (a check turned off, a
// finding ignored) without playing anything again, and check_diagram can use it too.

export interface WithEvidence {
  result: CheckResult;
  /** Losses the simulations caused on purpose: shown as notes, never findings. */
  planned: PlannedLoss[];
  /** Shown findings with counts on them, `dropped` included. */
  counted: number;
}

/**
 * `result` with `evidence` on it. `checks` is the file's own (ignores and turned-off checks) as `result` saw it.
 * - A loss the simulation's expectations count on is planned, whatever finding is there.
 * - At a node that isn't a broker, a `single-point` finding takes the whole loss (what one replica costs, outage
 *   included); otherwise the part lost while the simulation had the node down or failing is planned.
 * - The rest is the design's: at a broker it goes on `dead-letter` (nothing when that check is off: `dropped` would
 *   bring it back); anywhere else, and at a broker without that finding, it's `dropped` (unless that check is off).
 * - Dead letters left unread go on `no-reader`, unless expected.
 */
export function withEvidence(result: CheckResult, evidence: Evidence, checks: DiagramChecks | undefined): WithEvidence {
  const known = new Set([...result.findings, ...result.ignored].map((f) => f.id));
  const off = new Set<string>(checks?.off ?? []);
  const byFinding = new Map<string, FindingEvidence[]>();
  const droppedAt = new Map<string, FindingEvidence[]>();
  const planned: PlannedLoss[] = [];
  const add = (map: Map<string, FindingEvidence[]>, key: string, e: FindingEvidence) => {
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  };
  for (const loss of evidence.losses) {
    const { simulation, node, what } = loss;
    const ev = (count: number): FindingEvidence => ({
      simulation,
      what,
      count,
      ...(loss.capped ? { capped: true } : {}),
    });
    if (loss.expects === "some") {
      // Said the way that says most: "takes it down" when all of it was lost while the simulation had it down.
      const why = loss.onPurpose?.count === loss.count ? loss.onPurpose.why : "expected";
      planned.push({ node, simulation, what, count: loss.count, why });
      continue;
    }
    if (what === "unread") {
      if (known.has(`no-reader:${node}`)) add(byFinding, `no-reader:${node}`, ev(loss.count));
      continue;
    }
    if (!loss.broker && known.has(`single-point:${node}`)) {
      add(byFinding, `single-point:${node}`, ev(loss.count));
      continue;
    }
    const purpose = loss.expects === "none" ? undefined : loss.onPurpose;
    if (purpose?.count) planned.push({ node, simulation, what, count: purpose.count, why: purpose.why });
    const design = loss.count - (purpose?.count ?? 0);
    if (design <= 0) continue;
    if (loss.broker && known.has(`dead-letter:${node}`)) add(byFinding, `dead-letter:${node}`, ev(design));
    else if (!(loss.broker && off.has("dead-letter"))) add(droppedAt, node, ev(design));
  }
  const attach = (f: Finding): Finding => {
    const counts = byFinding.get(f.id);
    return counts?.length ? { ...f, evidence: counts } : f;
  };
  const dropped = off.has("dropped")
    ? []
    : evidence.dropped.flatMap((f) => {
        const counts = droppedAt.get(f.target);
        return counts?.length ? [{ ...f, evidence: counts }] : [];
      });
  const ignores = new Set((checks?.ignore ?? []).map((i) => `${i.rule}:${i.target}`));
  const findings = [...result.findings.map(attach), ...dropped.filter((f) => !ignores.has(f.id))];
  return {
    result: {
      ...result,
      findings,
      ignored: [...result.ignored.map(attach), ...dropped.filter((f) => ignores.has(f.id))],
    },
    planned,
    counted: findings.filter((f) => f.evidence?.length).length,
  };
}

const count = (n: number) => n.toLocaleString("en-US");

/** One count in words: "312 dropped in “Payments goes down”", "30 left unread in the first minute of “Backfill”". */
export function evidenceText(e: FindingEvidence): string {
  const what = e.what === "dropped" ? "dropped" : "left unread";
  return `${count(e.count)} ${what} in ${e.capped ? "the first minute of " : ""}“${e.simulation}”`;
}
