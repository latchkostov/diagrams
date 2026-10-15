import { useContext, useState, useSyncExternalStore } from "react";
import type { EditorApi } from "../editor/types";
import type { DiagramFile } from "../model/types";
import type { LiveState } from "../live/controller";
import { LiveContext } from "../live/context";
import { addConsumer } from "../live/addConsumer";
import { configuredPlanning, planningRunStats } from "./cache";
import { ExplanationView } from "./ExplanationView";
import { planningHost } from "./host";
import { t, useLocale } from "../i18n";
import { PlanningConnections } from "./PlanningConnections";
import { LiveDetails } from "./LiveDetails";
import { formatRate } from "../i18n/format";

const noSubscribe = () => () => {};
const noState = () => null;
let fixSequence = 0;
export function NodePlanning({
  diagram,
  id,
  editor,
  state: provided,
  hover = false,
  revision,
  paused = false,
  counts,
  readDiagram,
}: {
  diagram?: DiagramFile;
  id: string;
  editor?: EditorApi;
  state?: LiveState;
  hover?: boolean;
  revision?: unknown;
  paused?: boolean;
  counts?: { nodes: number; edges: number };
  readDiagram?: () => DiagramFile;
}) {
  useLocale();
  // Name fields save every key, but planning reads once after naming ends. Check the cheap
  // graph-size ceiling before asking the editor to copy the whole document.
  const read = () => {
    if (diagram) return diagram;
    if (!editor || (counts && (counts.nodes > 256 || counts.edges > 512))) return undefined;
    planningRunStats.reads++;
    return readDiagram ? readDiagram() : editor.getDiagram();
  };
  const key = diagram ?? revision;
  const [snapshot, setSnapshot] = useState(() => ({ key, diagram: read() }));
  let current = snapshot;
  if (!paused && snapshot.key !== key) {
    current = { key, diagram: read() };
    setSnapshot(current);
  }
  const context = useContext(LiveContext);
  const activeSession = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  const live = context ?? activeSession;
  const subscribed = useSyncExternalStore(
    live?.controller.subscribe ?? noSubscribe,
    live?.controller.getState ?? noState,
  );
  const state = provided ?? subscribed;
  const d = current.diagram ?? live?.controller.currentDiagram;
  const published = state?.snapshot.nodes[id];
  // Replica rows read the current engine. Keep resource totals on that same clock when an inspector opens
  // between UI publications; explicitly provided snapshots still retain their caller's observation time.
  const observed = published?.resources && live && !provided ? live.controller.realSnapshot().nodes[id] : published;
  const configured = d ? configuredPlanning(d, state) : undefined;
  if (!configured && hover)
    return (
      <div className="planning-explanation">
        <p className="insp-note" data-testid="planning-unavailable">
          {t("planning.analysisLimit")}
        </p>
        {observed && (
          <p data-testid="planning-observed">
            {observed.role === "processor"
              ? t("planning.observedProcessor", {
                  throughput: formatRate(observed.throughput),
                  waiting: observed.backlog,
                  processed: observed.processed,
                  inFlight: observed.inFlight,
                })
              : t("planning.observed", { throughput: formatRate(observed.throughput), waiting: observed.backlog })}
          </p>
        )}
      </div>
    );
  if (!configured)
    return (
      <>
        <p className="insp-note" data-testid="planning-unavailable">
          {t("planning.analysisLimit")}
        </p>
        {!hover && observed && d && (
          <LiveDetails
            key={id}
            metrics={observed}
            diagram={d}
            readPage={live ? (page) => live.controller.replicaPage(id, page) : undefined}
          />
        )}
      </>
    );
  const explanation = configured.explanation(id);
  const node = configured.nodes.get(id);
  if (!node) return null;
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
    const fresh = configuredPlanning(current, latest)?.explanation(id);
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
  if (hover) return x ? <ExplanationView explanation={x} name={node.label} hover /> : null;
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
      <PlanningConnections configured={configured} id={id} />
      {observed && d && (
        <LiveDetails
          key={id}
          metrics={observed}
          diagram={d}
          readPage={live ? (page) => live.controller.replicaPage(id, page) : undefined}
        />
      )}
    </>
  );
}
