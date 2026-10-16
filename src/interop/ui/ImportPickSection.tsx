import { useId, useMemo, useState } from "react";
import { t as tr } from "../../i18n";
import { formatNumber } from "../../i18n/format";
import type { ImportPick } from "../infra/graph";
import { MAX_DRAWN, pickedNodes, pickGraph } from "../infra/pick";
import { Breakable } from "./Breakable";

export function ImportPickSection({ pick, onDraw }: { pick: ImportPick; onDraw: (keys: string[]) => void }) {
  const [chosen, setChosen] = useState(() => new Set(pick.groups.filter((g) => g.drawn).map((g) => g.key)));
  const keys = useMemo(() => pick.groups.filter((g) => chosen.has(g.key)).map((g) => g.key), [pick.groups, chosen]);
  const count = useMemo(() => pickedNodes(pick.graph, { keys }), [pick.graph, keys]);
  const drawn = useMemo(() => (pick.selection.unresolved?.size ? pickGraph(pick.graph, pick.selection) : null), [pick]);
  const degraded = !!drawn;
  const same =
    keys.length === pick.groups.filter((g) => g.drawn).length &&
    pick.groups.every((g) => g.drawn === chosen.has(g.key));
  const statusId = useId();
  const over = count > MAX_DRAWN;
  const unavailable = !keys.length || over || (same && !degraded);
  const toggle = (key: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <section className="ix-report-section" data-testid="import-report-pick">
      <h3>
        {tr("importReport.boundariesSelected", {
          selected: keys.length,
          total: pick.groups.length,
        })}
      </h3>
      <p className="ix-report-note" data-testid="import-report-pick-lede">
        {tr("importReport.pickLede", { count: pick.total })}
      </p>
      <ul className="ix-report-pick-list" data-testid="import-report-pick-list">
        {pick.groups.map((g, i) => (
          <li key={g.key} className="ix-report-row" data-testid={`import-report-pick-row-${i}`}>
            <label className="ix-check ix-report-what">
              <input
                type="checkbox"
                checked={chosen.has(g.key)}
                onChange={(e) => toggle(g.key, e.target.checked)}
                aria-describedby={statusId}
                data-testid={`import-report-pick-${i}`}
              />
              <Breakable text={g.label} />
            </label>
            <span className="ix-report-why">{tr("importReport.groupCounts", { nodes: g.nodes, flows: g.flows })}</span>
          </li>
        ))}
      </ul>
      <div className="ix-report-pick-foot">
        {/* Unavailable rather than disabled: it stays in the Tab order, and says why with the status beside it. */}
        <button
          className="btn"
          aria-disabled={unavailable || undefined}
          aria-describedby={statusId}
          onClick={() => {
            if (!unavailable) onDraw(keys);
          }}
          title={tr("importReport.opensANewDiagramWithTheTicked")}
          data-testid="import-report-pick-draw"
        >
          {tr("importReport.drawThese", { count })}
        </button>
        {/* Announced as the ticks change: the total, and why the button is unavailable when it is. */}
        <span
          id={statusId}
          role="status"
          className={over ? "ix-report-pick-status is-over" : "ix-report-pick-status"}
          data-testid="import-report-pick-status"
        >
          {over
            ? tr("importReport.overLimit", { count, limit: formatNumber(MAX_DRAWN) })
            : !keys.length
              ? tr("importReport.nothingTicked")
              : same && !degraded
                ? tr("importReport.alreadyDrawn", { count })
                : tr("importReport.ticked", { count })}
          {drawn && (
            <>
              {" "}
              {tr("importReport.drew", {
                nodes: drawn.components.length,
                connections: drawn.links.length,
                boundaries: drawn.groups.length,
              })}
            </>
          )}
        </span>
      </div>
    </section>
  );
}
