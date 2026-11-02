import { t } from "../i18n";
import type { Action, ActionContext } from "./actions";

const eligible = (ctx: ActionContext) =>
  ctx.editor.getDiagram().nodes.filter((n) => ctx.selection.nodeIds.includes(n.id));

export function boundaryActions(): Action[] {
  return [
    {
      id: "selection.add-to-boundary",
      keywords: "adopt membership move into boundary",
      section: "arrange",
      targets: ["node", "selection"],
      order: 28,
      get label() {
        return t("menu.selectionAddBoundary");
      },
      icon: "boundary",
      hint: (ctx) => t("inspector.nodes", { count: eligible(ctx).length }),
      enabled: (ctx) => eligible(ctx).length > 0 && !!ctx.editor.getDiagram().groups?.length,
      get searchable() {
        return t("menu.selectionSearchBoundaries");
      },
      children: (ctx) => {
        const d = ctx.editor.getDiagram();
        const groups = d.groups ?? [];
        return groups.map((g) => {
          const path: string[] = [];
          let parent = g.group;
          const seen = new Set([g.id]);
          while (parent && !seen.has(parent)) {
            seen.add(parent);
            const ancestor = groups.find((a) => a.id === parent);
            if (!ancestor) break;
            path.unshift(ancestor.label || ancestor.id);
            parent = ancestor.group;
          }
          return {
            type: "item" as const,
            id: `add-to-boundary:${g.id}`,
            documentScoped: true,
            label: g.label || t("chrome.untitledBoundary"),
            keywords: `adopt membership move into ${g.id} ${path.join(" ")}`,
            hint: [...path, t("inspector.nodes", { count: d.nodes.filter((n) => n.group === g.id).length })].join(
              " / ",
            ),
            disabled: !eligible(ctx).some((n) => n.group !== g.id),
            run: () => {
              void ctx.editor.transferBoundary(ctx.selection.nodeIds, g.id);
            },
          };
        });
      },
    },
    {
      id: "selection.remove-from-boundary",
      keywords: "leave detach outside membership",
      section: "arrange",
      targets: ["node", "selection"],
      order: 29,
      get label() {
        return t("menu.selectionRemoveBoundary");
      },
      icon: "boundary",
      enabled: (ctx) => eligible(ctx).some((n) => !!n.group),
      run: (ctx) => {
        void ctx.editor.transferBoundary(ctx.selection.nodeIds);
      },
    },
  ];
}
