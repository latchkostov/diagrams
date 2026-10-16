import { useState } from "react";
import { kedaLesson } from "../model/autoscaling";
import type { DiagramFile } from "../model/types";
import type { ImportGraph } from "../interop/infra/graph";
import { defaultSelection, pickGraph, pickGroups } from "../interop/infra/pick";
import { graphToDiagram } from "../interop/infra/map";
import { ImportReportDialog } from "../interop/ui/ImportReportDialog";

/** Small, invented exhausted import, without needing a hostile graph to exhaust the real work cap. */
function fixture() {
  const graph: ImportGraph = {
    title: "Retry scaling",
    format: "Kubernetes",
    source: "retry.yaml",
    notes: [],
    unread: [],
    notDrawn: [],
    groups: [
      { key: "workers", label: "Workers" },
      { key: "readers", label: "Readers" },
    ],
    components: [
      {
        key: "worker",
        label: "Worker",
        group: "workers",
        hint: { name: "worker" },
        props: { autoscaling: kedaLesson("kafka", { node: "topic", group: "readers" }) },
      },
      { key: "topic", label: "Topic", group: "workers", stencil: "kafka.topic", hint: { name: "topic" } },
      { key: "reader", label: "Reader", group: "readers", hint: { name: "reader" } },
    ],
    links: [
      { from: "topic", to: "reader", relation: "flow", props: { group: "readers" }, evidence: { source: "spec" } },
    ],
  };
  const selection = defaultSelection(graph, 2, 0)!;
  const original = graphToDiagram(pickGraph(graph, selection));
  original.report.pick = {
    format: "kubernetes",
    total: graph.components.length,
    groups: pickGroups(graph, selection.keys),
    graph,
    selection,
  };
  return original;
}

/** Real report action and lazy replay pipeline; keep both documents observable for mutation checks. */
export function ImportRetryLab() {
  const [original] = useState(fixture);
  const [open, setOpen] = useState(true);
  const [replayed, setReplayed] = useState<DiagramFile | string>();
  return (
    <div>
      <pre data-testid="import-retry-original">{JSON.stringify(original.diagram)}</pre>
      <pre data-testid="import-retry-new">{JSON.stringify(replayed)}</pre>
      {open && (
        <ImportReportDialog
          report={original.report}
          isPrivate={() => false}
          onMakePrivate={() => {}}
          onClose={() => setOpen(false)}
          onReplay={(outcome) =>
            setReplayed(
              outcome.ok === true
                ? outcome.diagram
                : outcome.ok === false
                  ? outcome.error
                  : "Unexpected import outcome",
            )
          }
        />
      )}
    </div>
  );
}
