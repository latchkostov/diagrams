import { useMemo, useSyncExternalStore } from "react";
import { planningHost } from "../../live/planningHost";
import type { EditorApi } from "../../editor/types";

const noSubscribe = () => () => {};
const noState = () => null;
/** Queue edits use the running setup; priority belongs to the base connection, not simulation overrides. */
export function useSimulationSetting(editor: EditorApi, kind: "node" | "edge", id: string, key: "queue" | "priority") {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  const state = useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const diagram = editor.getDiagram();
  const base = (kind === "node" ? editor.getNode(id) : editor.getEdge(id))?.props?.[key];
  const override = kind === "node" ? state?.running?.setup?.props?.[id] : undefined;
  const saved = diagram.simulations?.find((s) => s.id === state?.simulation?.id);
  const simulation = state?.simulation;
  const draft = useMemo(
    () => !!simulation && (!saved || JSON.stringify(simulation) !== JSON.stringify(saved)),
    [simulation, saved],
  );
  const editable = !live?.slowmo.active && !draft;
  return {
    value: override && key in override ? override[key as keyof typeof override] : base,
    base,
    overridden: !!override && key in override,
    editable,
    set(value: unknown) {
      if (!editable) return;
      if (saved && kind === "node") {
        const next = {
          ...saved,
          setup: {
            ...saved.setup,
            props: { ...saved.setup?.props, [id]: { ...saved.setup?.props?.[id], [key]: value } },
          },
        };
        editor.updateMeta({ simulations: diagram.simulations!.map((s) => (s.id === saved.id ? next : s)) });
        live?.controller.setBase(next);
      } else if (kind === "node") editor.setNodeProps(id, { [key]: value });
      else editor.setEdgeProps(id, { [key]: value });
    },
  };
}
