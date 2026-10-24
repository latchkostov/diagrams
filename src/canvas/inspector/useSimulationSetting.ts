import { useSyncExternalStore } from "react";
import { planningHost } from "../../live/planningHost";
import type { EditorApi } from "../../editor/types";

const noSubscribe = () => () => {};
const noState = () => null;
/** The queue and priority controls edit the same setup overlay the running simulation sees. */
export function useSimulationSetting(editor: EditorApi, kind: "node" | "edge", id: string, key: "queue" | "priority") {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get);
  const state = useSyncExternalStore(live?.controller.subscribe ?? noSubscribe, live?.controller.getState ?? noState);
  const diagram = editor.getDiagram();
  const base = (kind === "node" ? editor.getNode(id) : editor.getEdge(id))?.props?.[key];
  const override = kind === "node" ? state?.running?.setup?.props?.[id] : state?.running?.setup?.edges?.[id];
  const saved = diagram.simulations?.find((s) => s.id === state?.simulation?.id);
  const editable =
    !live?.slowmo.active &&
    !(state?.simulation && (!saved || JSON.stringify(state.simulation) !== JSON.stringify(saved)));
  return {
    value: override && key in override ? override[key as keyof typeof override] : base,
    base,
    overridden: !!override && key in override,
    editable,
    set(value: unknown) {
      if (!editable) return;
      if (saved) {
        const part = kind === "node" ? "props" : "edges";
        const next = {
          ...saved,
          setup: {
            ...saved.setup,
            [part]: { ...saved.setup?.[part], [id]: { ...saved.setup?.[part]?.[id], [key]: value } },
          },
        };
        editor.updateMeta({ simulations: diagram.simulations!.map((s) => (s.id === saved.id ? next : s)) });
        live?.controller.setBase(next);
      } else if (kind === "node") editor.setNodeProps(id, { [key]: value });
      else editor.setEdgeProps(id, { [key]: value });
    },
  };
}
