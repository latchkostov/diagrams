import type { EditorApi, EditOptions } from "./types";
import type { LiveUi } from "../live/context";
import { planningHost } from "../live/planningHost";
import { cacheEnabled, type CacheTable } from "../model/caching";
import { stencilRole } from "../stencils/roles";
import type { RouteTable } from "../model/requestRouting";
import type { DiagramFile } from "../model/types";

type CachePolicyLive = {
  controller: Pick<LiveUi["controller"], "getState" | "setBase">;
  slowmo: Pick<LiveUi["slowmo"], "active">;
};

/** One owner and writer for the inspector, origin menu and verified fix. */
export function nodeCachePolicy(
  editor: Pick<EditorApi, "getDiagram" | "setNodeProps" | "updateMeta">,
  nodeId: string,
  live: CachePolicyLive | null = planningHost.get(),
  rendered?: DiagramFile,
) {
  const d = rendered ?? editor.getDiagram(),
    node = d.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const state = live?.controller.getState(),
    props = state?.configuration[nodeId],
    table = (props ? props.cache : node.props?.cache) as CacheTable | undefined;
  if (!table) return;
  const saved = d.simulations?.find((s) => s.id === state?.simulation?.id);
  const draft = !!state?.simulation && (!saved || JSON.stringify(state.simulation) !== JSON.stringify(saved));
  const editable = !live?.slowmo.active && !draft;
  return {
    node: nodeId,
    table,
    editable,
    simulation: saved?.title,
    set(cache: CacheTable, options?: EditOptions) {
      if (!editable || JSON.stringify(cache) === JSON.stringify(table)) return false;
      if (saved) {
        const next = {
          ...saved,
          setup: {
            ...saved.setup,
            props: { ...saved.setup?.props, [nodeId]: { ...saved.setup?.props?.[nodeId], cache } },
          },
        };
        editor.updateMeta({ simulations: d.simulations!.map((s) => (s.id === saved.id ? next : s)) }, options);
        live?.controller.setBase(next);
      } else editor.setNodeProps(nodeId, { cache }, options);
      return true;
    },
  };
}

/** The node policy the current origin connection actually uses, with the same saved-run ownership as callers. */
export function effectiveCachePolicy(
  editor: Pick<EditorApi, "getDiagram" | "setNodeProps" | "updateMeta">,
  edgeId: string,
  live: CachePolicyLive | null = planningHost.get(),
) {
  const d = editor.getDiagram(),
    edge = d.edges.find((e) => e.id === edgeId);
  if (!edge || edge.kind !== "sync" || edge.props?.dlq || (edge.relation && edge.relation !== "flow")) return;
  const node = d.nodes.find((n) => n.id === edge.from);
  if (!node) return;
  const state = live?.controller.getState(),
    props = state?.configuration[node.id];
  const table = props ? props.cache : node.props?.cache;
  if (!cacheEnabled(d.planning, node.stencil, stencilRole(node.stencil), table)) return;
  const origins = d.edges.filter(
    (e) => e.from === node.id && e.kind === "sync" && !e.props?.dlq && (!e.relation || e.relation === "flow"),
  );
  if (origins.length > 1) {
    const routes = (props ? props.routeTable : node.props?.routeTable) as RouteTable | undefined;
    const targets = new Set(
      [...(routes?.rules ?? []), ...(routes?.default ? [routes.default] : [])].flatMap((r) =>
        r.targets.filter((target) => target.weight > 0).map((target) => target.edgeId),
      ),
    );
    // Different routed origins can own different cache rules. Their node's Properties
    // remains available; never present a node-wide policy edit as a change to an unrelated edge.
    if (targets.size !== 1 || !targets.has(edgeId)) return;
  }
  const policy = nodeCachePolicy(editor, node.id, live, d)!;
  const storing = [
    ...table.rules.filter((r) => !r.policy.noStore),
    ...(table.default && !table.default.noStore ? [{ id: "", policy: table.default }] : []),
  ];
  return {
    ...policy,
    storing,
  };
}
