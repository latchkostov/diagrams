import { useContext, useSyncExternalStore } from "react";
import type { EditorApi } from "../editor/types";
import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { LiveContext } from "../live/context";
import { addConsumer } from "../live/addConsumer";
import { analyzeCapacity } from "../sim/capacity";
import { planningSimulation } from "../sim/capacityPlanning";
import { explainNode } from "./explanation";
import { configuredPlanning } from "./cache";
import { planningRun } from "./run";
import { ExplanationView } from "./ExplanationView";
import { planningHost } from "./host";
import { t, useLocale } from "../i18n";
import { formatDuration, formatList, formatPercent } from "../i18n/format";

const noSubscribe = () => () => {};
const noState = () => null;
let fixSequence = 0;
export function NodePlanning({
  diagram: d,
  id,
  editor,
  state: provided,
  hover = false,
}: {
  diagram: DiagramFile;
  id: string;
  editor?: EditorApi;
  state?: LiveState;
  hover?: boolean;
}) {
  useLocale();
  const context = useContext(LiveContext);
  const activeSession = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  const live = context ?? activeSession;
  const subscribed = useSyncExternalStore(
    live?.controller.subscribe ?? noSubscribe,
    live?.controller.getState ?? noState,
  );
  const state = provided ?? subscribed;
  const configured = configuredPlanning(d, state);
  const { analysis } = configured;
  const rows = configured.rows(id);
  const explanation = configured.explanation(id);
  const node = d.nodes.find((n) => n.id === id);
  if (!node) return null;
  const observed = state?.snapshot.nodes[id];
  const x = explanation && {
    ...explanation,
    ...(observed
      ? {
          observed: {
            throughput: observed.throughput,
            waiting: observed.backlog,
            processed: observed.processed,
            inFlight: observed.inFlight,
          },
        }
      : {}),
  };
  const apply = () => {
    if (!editor || !x || live?.slowmo.active) return;
    if (x.addConsumer) {
      if (live?.addReader) live.addReader(x.addConsumer);
      else addConsumer(editor, x.addConsumer);
      return;
    }
    // Recompute from the latest graph; never apply stale cached counts. Changes share one undo step.
    const current = editor.getDiagram();
    const latest = live?.controller.getState() ?? state;
    const sim = planningRun(current, latest);
    const status = Object.fromEntries(Object.entries(latest?.snapshot.nodes ?? {}).map(([id, n]) => [id, n.status]));
    const analysis = analyzeCapacity(current, planningSimulation(current, sim), { status });
    const fresh = explainNode(current, id, { sim, analysis });
    if (!fresh?.changes) return;
    if (live?.applyCapacityFix) {
      live.applyCapacityFix({
        label: t("planning.apply"),
        changes: fresh.changes.map((c) => ({ ...c, label: current.nodes.find((n) => n.id === c.nodeId)!.label })),
      });
      return;
    }
    const next = structuredClone(current);
    if (latest?.simulation) {
      const saved = next.simulations?.find((s) => s.id === latest.simulation!.id);
      if (!saved) return;
      const props = (saved.setup ??= {}).props ?? {};
      for (const c of fresh.changes) props[c.nodeId] = { ...props[c.nodeId], [c.key]: c.to };
      saved.setup.props = props;
      editor.applyDiagram(next);
      editor.select({ nodeIds: [id] });
    } else {
      const merge = `planning:fix:${++fixSequence}`;
      for (const c of fresh.changes) editor.setNodeProps(c.nodeId, { [c.key]: c.to }, { merge });
    }
  };
  if (hover) return x ? <ExplanationView explanation={x} name={node.label} /> : null;
  return (
    <>
      {x && (
        <section className="insp-section" aria-label={t("planning.heading")}>
          <h3 className="insp-section-title">{t("planning.heading")}</h3>
          <ExplanationView
            explanation={x}
            name={node.label}
            apply={editor ? apply : undefined}
            disabledReason={live?.slowmo.active ? t("planning.slowMotion") : undefined}
          />
        </section>
      )}
      <section className="insp-section" aria-label={t("planning.connections")} data-testid="planning-connections">
        <h3 className="insp-section-title">{t("planning.connections")}</h3>
        {Number.isFinite(analysis.resolved[id].concurrency) && (
          <p className="insp-note" data-testid="planning-pool">
            {t("planning.pool", { replicas: analysis.nodes[id].replicas, slots: analysis.resolved[id].concurrency })}
          </p>
        )}
        {!rows.length && <p className="insp-note">{t("planning.noConnections")}</p>}
        {rows.map((row) => (
          <div
            className="planning-connection"
            key={row.edge}
            data-testid={`planning-connection-${row.edge}`}
            data-capability={row.kind}
          >
            <strong>
              {row.kind === "consumes"
                ? t("planning.consumes", { name: d.nodes.find((n) => n.id === row.peer)!.label })
                : row.kind === "publishes"
                  ? t("planning.publishes", { name: d.nodes.find((n) => n.id === row.peer)!.label })
                  : t("planning.calls", { name: d.nodes.find((n) => n.id === row.peer)!.label })}
            </strong>
            {row.group !== undefined && <p data-testid="planning-group">{t("planning.group", { name: row.group })}</p>}
            {row.filter && <p>{t("planning.filter", { types: formatList(row.filter) })}</p>}
            {row.emits && <p>{t("planning.emits", { type: row.emits })}</p>}
            {row.share !== undefined && <p>{t("planning.share", { share: formatPercent(row.share) })}</p>}
            {row.retry && (
              <p>
                {row.retry === "requeue"
                  ? t("planning.requeue", { duration: formatDuration(row.retryBackoffMs ?? 0) })
                  : t("planning.inplace", { duration: formatDuration(row.retryBackoffMs ?? 0) })}
              </p>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
