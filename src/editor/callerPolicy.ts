import type { EditorApi } from "./types";
import type { EdgeSimProps } from "../sim/types";
import type { LiveUi } from "../live/context";
import { planningHost } from "../live/planningHost";
import { callPolicy } from "../sim/callPolicy";

/** All connection controls edit the policy playback sees, with one document-history operation. */
export function effectiveCallerPolicy(
  editor: Pick<EditorApi, "getEdge" | "getNode" | "getDiagram" | "updateMeta" | "setEdgeProps">,
  edgeId: string,
  live: {
    controller: Pick<LiveUi["controller"], "getState" | "setBase">;
    slowmo: Pick<LiveUi["slowmo"], "active">;
  } | null = planningHost.get(),
) {
  const edge = editor.getEdge(edgeId);
  if (!edge) return undefined;
  const active = live?.controller.getState().running;
  const override = active?.setup?.edges?.[edgeId];
  const caller = { ...(edge.props?.caller as EdgeSimProps["caller"]), ...override?.caller };
  const saved = override && editor.getDiagram().simulations?.find((s) => s.id === active?.id);
  // An unsaved draft owns its overrides; a base-only edit cannot change that run.
  const editable = !live?.slowmo.active && (!override || !!saved);
  return {
    caller,
    policy: callPolicy(editor.getNode(edge.from)?.stencil ?? "", caller),
    editable,
    set(patch: EdgeSimProps["caller"]) {
      if (!editable) return;
      if (saved) {
        const next = {
          ...saved,
          setup: {
            ...saved.setup,
            edges: {
              ...saved.setup?.edges,
              [edgeId]: { ...saved.setup?.edges?.[edgeId], caller: { ...override?.caller, ...patch } },
            },
          },
        };
        editor.updateMeta({ simulations: editor.getDiagram().simulations!.map((s) => (s.id === saved.id ? next : s)) });
        live?.controller.setBase(next);
      } else editor.setEdgeProps(edgeId, { caller: { ...caller, ...patch } });
    },
  };
}
