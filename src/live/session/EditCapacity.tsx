import { surfaceCatalogs } from "../../i18n/surfaces";
import { capacityView } from "../capacityView";
import { ViewportPortal, useStore } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import type { EditorApi } from "../../editor/types";
import { t, useLocale } from "../../i18n";
import { notify } from "../../interop/ui/toast";
import { edgeSemanticSignature } from "../../model/relations";
import type { DiagramFile } from "../../model/types";
import { CapacityLayer } from "../CapacityLayer";
import { BottleneckCallout } from "../lazyBottleneckCallout";
import { addConsumer } from "../addConsumer";
import { emptyInputs, freePlaySimulation, type CapacityFix } from "../capacityModel";

import { sayConsumerAdded } from "./useLiveFixes";
/** Edit mode's capacity heat map: the diagram's own rates and sizes, with the bottleneck callout. */
export function EditCapacity({
  editor,
  presenting,
  planning,
}: {
  editor: EditorApi;
  presenting: boolean;
  planning?: DiagramFile["planning"];
}) {
  const locale = useLocale();
  const nodes = useStore((st) => st.nodes);
  const edges = useStore((st) => st.edges);
  // Positions don't change capacity: key the analysis on what does.
  const structure = useMemo(
    () =>
      JSON.stringify([
        planning?.revision,
        nodes.map((n) => (n.type === "diagram" ? [n.id, n.data.stencil, n.data.label, n.data.props ?? null] : n.id)),
        edges.map((e) => edgeSemanticSignature({ id: e.id, from: e.source, to: e.target, ...e.data })),
      ]),
    [nodes, edges, planning?.revision],
  );
  const { value: view } = useMemo(() => {
    const current = structure ? editor.getDiagram() : null;
    // The editor's imperative metadata catches up in a layout effect, after this render's children.
    const d = current ? { ...current, planning } : null;
    return { locale, value: d ? capacityView(d, freePlaySimulation(d, emptyInputs())) : null };
  }, [structure, editor, locale, planning]);
  const apply = useCallback(
    (fix: CapacityFix) => {
      const merge = "capacity:fix:" + Date.now();
      for (const c of fix.changes) editor.setNodeProps(c.nodeId, { [c.key]: c.to }, { merge });
      notify(t("liveSession.appliedFix", { name: fix.label }), {
        action: { label: t("shortcuts.undo"), run: () => editor.undo(), testId: "capacity-fix-undo", undoes: true },
      });
    },
    [editor],
  );
  if (!view) return null;
  return (
    <>
      <ViewportPortal>
        <CapacityLayer view={view} presenting={presenting} />
      </ViewportPortal>
      <div className={"cap-hud" + (presenting ? " is-presenting" : "")}>
        <BottleneckCallout
          view={view}
          floating
          onApply={presenting ? undefined : apply}
          onAddConsumer={presenting ? undefined : (id) => addConsumer(editor, id) && sayConsumerAdded(editor, id)}
        />
      </div>
    </>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function editCapacityWhenReady() {
  await surfaceCatalogs(["simulation"]);
  return EditCapacity;
}
