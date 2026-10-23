import { actionRegistry } from "../editor/actions";
import { t } from "../i18n";

// Selection reset is palette-only, so its implementation travels with the palette.
const unregister = actionRegistry.register([
  {
    id: "selection.reset-routes",
    section: "edge",
    targets: ["selection"],
    paletteOnly: true,
    get label() {
      return t("route.resetSelection");
    },
    icon: "route",
    when: (ctx) => ctx.selection.edgeIds.some((id) => !!ctx.editor.getEdge(id)?.waypoints?.length),
    run: (ctx) => ctx.editor.updateEdges(ctx.selection.edgeIds, { waypoints: undefined }),
  },
]);

if (import.meta.hot) import.meta.hot.dispose(unregister);
