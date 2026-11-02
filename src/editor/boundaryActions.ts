import type { DiagramFile } from "../model/types";
import { t } from "../i18n";
import type { Action, ActionContext } from "./actions";

// A registry build gets a fresh context; all rows share its lazily read snapshot.
interface Snapshot {
  groups: NonNullable<DiagramFile["groups"]>;
  eligible: DiagramFile["nodes"];
  counts: Map<string, number>;
}
const snapshots = new WeakMap<ActionContext, Snapshot>();
function snapshot(ctx: ActionContext): Snapshot {
  const cached = snapshots.get(ctx);
  if (cached) return cached;
  const d: DiagramFile = ctx.editor.getDiagram();
  const selected = new Set(ctx.selection.nodeIds);
  const eligible = d.nodes.filter((n) => selected.has(n.id));
  const counts = new Map<string, number>();
  for (const n of d.nodes) if (n.group) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
  const value = { groups: d.groups ?? [], eligible, counts };
  snapshots.set(ctx, value);
  return value;
}
const eligible = (ctx: ActionContext) => snapshot(ctx).eligible;

export const boundaryMenu = {
  id: "selection.boundary",
  get label() {
    return t("inspector.boundary");
  },
  icon: "boundary" as const,
};

export function boundaryActions(): Action[] {
  return [
    {
      id: "selection.add-to-boundary",
      keywords: "adopt membership move into boundary",
      section: "arrange",
      targets: ["node", "selection"],
      inspectorSelection: true,
      menuGroup: boundaryMenu,
      order: 28,
      get label() {
        return t("menu.selectionAddBoundary");
      },
      icon: "boundary",
      hint: (ctx) => t("inspector.nodes", { count: eligible(ctx).length }),
      enabled: (ctx) => eligible(ctx).length > 0 && !!snapshot(ctx).groups.length,
      get searchable() {
        return t("menu.selectionSearchBoundaries");
      },
      children: (ctx) => {
        const { groups, eligible: nodes, counts } = snapshot(ctx);
        const byId = new Map(groups.map((g) => [g.id, g]));
        const memberships = new Set(nodes.map((n) => n.group));
        return groups.map((g) => {
          const path: string[] = [];
          let parent = g.group;
          const seen = new Set([g.id]);
          // Limit both traversal and output before concatenating imported labels.
          while (parent && !seen.has(parent) && path.length < 6) {
            seen.add(parent);
            const ancestor = byId.get(parent);
            if (!ancestor) break;
            path.unshift((ancestor.label || ancestor.id).slice(0, 80));
            parent = ancestor.group;
          }
          return {
            type: "item" as const,
            id: `add-to-boundary:${g.id}`,
            documentScoped: true,
            label: g.label || t("chrome.untitledBoundary"),
            keywords: `adopt membership move into ${g.id} ${path.join(" ")}`,
            hint: [...path, t("inspector.nodes", { count: counts.get(g.id) ?? 0 })].join(" / "),
            disabled: !nodes.length || (memberships.size === 1 && memberships.has(g.id)),
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
      inspectorSelection: true,
      menuGroup: boundaryMenu,
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
