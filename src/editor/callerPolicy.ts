import type { EditOptions, EditorApi } from "./types";
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
  const state = live?.controller.getState();
  const active = state?.running;
  const override = active?.setup?.edges?.[edgeId];
  const caller = { ...(edge.props?.caller as EdgeSimProps["caller"]), ...override?.caller };
  const saved = editor.getDiagram().simulations?.find((s) => s.id === state?.simulation?.id);
  const draft = !!state?.simulation && (!saved || JSON.stringify(state.simulation) !== JSON.stringify(saved));
  // An unsaved draft owns its overrides; a base-only edit cannot change that run.
  const editable = !live?.slowmo.active && !draft;
  return {
    caller,
    diagramCaller: edge.props?.caller as EdgeSimProps["caller"],
    override: override?.caller,
    simulation: saved?.title,
    policy: callPolicy(editor.getNode(edge.from)?.stencil ?? "", caller),
    editable,
    // A caller may opt into merging split writes; ordinary edits keep their own Undo steps.
    set(patch: EdgeSimProps["caller"], options?: EditOptions) {
      if (!editable) return;
      const normalized = Object.fromEntries(
        Object.entries({
          ...override?.caller,
          ...patch,
          ...(Object.hasOwn(patch ?? {}, "deadlineMs") && patch?.deadlineMs === undefined ? { deadlineMs: null } : {}),
          ...(Object.hasOwn(patch ?? {}, "breaker") && patch?.breaker === undefined ? { breaker: null } : {}),
        }).filter(([, v]) => v !== undefined),
      );
      if (saved) {
        // Reselecting an existing value must not write or disturb the pending Undo step.
        if (JSON.stringify(normalized) === JSON.stringify(override?.caller ?? {})) return;
        const next = {
          ...saved,
          setup: {
            ...saved.setup,
            edges: {
              ...saved.setup?.edges,
              [edgeId]: { ...saved.setup?.edges?.[edgeId], caller: normalized },
            },
          },
        };
        editor.updateMeta(
          { simulations: editor.getDiagram().simulations!.map((s) => (s.id === saved.id ? next : s)) },
          options,
        );
        live?.controller.setBase(next);
      } else {
        const next = { ...caller, ...patch };
        if (JSON.stringify(next) === JSON.stringify(caller)) return;
        editor.setEdgeProps(edgeId, { caller: next }, options);
      }
    },
  };
}
