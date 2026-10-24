import { t } from "../i18n";
import type { DiagramFile } from "../model/types";
import { revisionAtLeast } from "../model/revisions";
import { callPolicy } from "../sim/callPolicy";
import type { EdgeSimProps } from "../sim/types";
import { useLive } from "./context";
import { CallOutcomes } from "./CallOutcomes";
import { BreakerReadout } from "./BreakerReadout";
import { formatCount } from "./format";

/** Shared connection details for the pinned card and Properties. */
export function EdgeDetailSection({ diagram, id, section }: { diagram: DiagramFile; id: string; section: string }) {
  const ui = useLive();
  const edge = diagram.edges.find((e) => e.id === id);
  const source = diagram.nodes.find((n) => n.id === edge?.from);
  const policy = callPolicy(source?.stencil ?? "", edge?.props?.caller as EdgeSimProps["caller"]);
  const s = ui.controller.getState().snapshot.edges[id];
  const c = s?.calls;
  const breaker = s?.breaker;
  return (
    <div className="hover-rail-body" data-testid={`edge-section-${section}`}>
      {section === "breaker" ? (
        breaker ? (
          <BreakerReadout id={id} breaker={breaker} calls={c} testId={`edge-breaker-${id}`} />
        ) : revisionAtLeast(diagram.planning?.revision, "p3-w2") ? (
          <p data-testid="hover-breaker-none">{t("hover.breakerNone")}</p>
        ) : (
          // Models before p3-w2 do not simulate breakers, whatever the connection says.
          <p data-testid="hover-breaker-pending">{t("hover.breakerPending")}</p>
        )
      ) : section === "outcomes" ? (
        <CallOutcomes calls={c} />
      ) : (
        <>
          <p>{t("health.sinceRestart")}</p>
          <p>
            {t("hover.retries")}: {formatCount(c?.retried ?? 0)}
          </p>
          <p>
            {policy.blocking ? t("hover.holds") : t("hover.frees")}: {formatCount(c?.held ?? 0)}
          </p>
        </>
      )}
    </div>
  );
}
