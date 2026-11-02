import { t } from "../i18n";
import { surfaceCatalogs } from "../i18n/surfaces";
import { shortcutKeys } from "./shortcuts";
import type { Action, ActionContext, MenuItem, MenuNode } from "./actions";
import type { NavStep } from "./useCanvasShortcuts";
import { GROUP_PREFIX } from "../canvas/types";
import type { SelectionTarget } from "./selectionCommands";

export function selectionActions(): Action[] {
  return [
    {
      id: "selection.select",
      targets: ["canvas", "node", "edge", "group", "annotation", "selection"],
      inspectorSelection: true,
      section: "edit",
      order: 149,
      get label() {
        return t("rail.select");
      },
      icon: "select-all",
      keywords: "selection extend remove area inside box subset",
      children: (ctx) => selectionItems(ctx),
    },
  ];
}
function selectionItems(ctx: ActionContext): MenuNode[] {
  // Registration is eager; translated picker metadata is read only after the first menu's catalog is in.
  const pending = surfaceCatalogs(["selection"]);
  if (pending) {
    void pending.catch(() => {});
    return [{ type: "item", id: "selection.loading", label: t("common.loading"), disabled: true }];
  }
  const d = ctx.editor.getDiagram(),
    sel = ctx.selection;
  const selected = new Set([
    ...sel.nodeIds.map((id) => `node:${id}`),
    ...sel.groupIds.map((id) => `node:${GROUP_PREFIX}${id}`),
    ...sel.edgeIds.map((id) => `edge:${id}`),
  ]);
  const nodeLabel = (id: string) => d.nodes.find((n) => n.id === id)?.label || id;
  const targets: { target: SelectionTarget; label: string; keywords?: string }[] = [
    ...d.nodes.map((n) => ({
      target: { kind: "node" as const, id: n.id },
      label: n.label || n.id,
      keywords: `${n.sublabel ?? ""} ${n.id}`,
    })),
    ...(d.annotations ?? []).map((n) => ({
      target: { kind: "node" as const, id: n.id },
      label: n.text.split("\n")[0] || n.id,
    })),
    ...(d.groups ?? []).map((g) => ({
      target: { kind: "node" as const, id: GROUP_PREFIX + g.id },
      label: g.label || g.id,
    })),
    ...d.edges.map((e) => ({
      target: { kind: "edge" as const, id: e.id },
      label: e.label || `${nodeLabel(e.from)} → ${nodeLabel(e.to)}`,
    })),
  ];
  const navigation: [NavStep, string, string][] = [
    ["next", t("shortcuts.selectNext"), ""],
    ["prev", t("shortcuts.selectPrev"), ""],
    ["left", t("chrome.left"), "Ctrl+Alt+Shift+ArrowLeft"],
    ["right", t("chrome.right"), "Ctrl+Alt+Shift+ArrowRight"],
    ["up", t("selection.above"), "Ctrl+Alt+Shift+ArrowUp"],
    ["down", t("selection.below"), "Ctrl+Alt+Shift+ArrowDown"],
    ["edge-out", t("shortcuts.selectEdgeOut"), shortcutKeys("extend-edge-out")],
    ["edge-in", t("shortcuts.selectEdgeIn"), shortcutKeys("extend-edge-in")],
  ];
  const items: MenuNode[] = [
    {
      type: "item",
      id: "selection.extend",
      label: t("selection.extend"),
      searchable: t("menu.searchNodes"),
      keywords: "extend add selection subset",
      children: [
        ...navigation.map(([step, label, shortcut]): MenuItem => ({
          type: "item",
          id: `extend:${step}`,
          label,
          paletteLabel: t("chrome.valueValue", { parent: t("selection.extend"), leaf: label }),
          keywords: "extend selection add",
          shortcut,
          run: () => {
            ctx.editor.selectionTool({ type: "navigate", step });
          },
        })),
        { type: "separator" },
        ...d.nodes.map((n) => ({
          type: "item" as const,
          id: `extend:node:${n.id}`,
          documentScoped: true,
          label: n.label || n.id,
          paletteLabel: t("chrome.valueValue", { parent: t("selection.extend"), leaf: n.label || n.id }),
          keywords: `extend selection add ${n.sublabel ?? ""} ${n.id}`,
          run: () => {
            ctx.editor.selectionTool({ type: "extend", target: { kind: "node", id: n.id } });
          },
        })),
      ],
    },
    {
      type: "item",
      id: "selection.remove",
      label: t("selection.remove"),
      searchable: t("selection.searchSelected"),
      keywords: "remove deselect selection subset",
      disabled: !selected.size,
      children: targets
        .filter((item) => selected.has(`${item.target.kind}:${item.target.id}`))
        .map((item) => ({
          type: "item",
          id: `remove-selection:${item.target.kind}:${item.target.id}`,
          label: item.label,
          paletteLabel: t("chrome.valueValue", { parent: t("selection.remove"), leaf: item.label }),
          keywords: `remove selection deselect ${item.keywords ?? ""}`,
          documentScoped: true,
          run: () => {
            ctx.editor.selectionTool({ type: "remove", target: item.target });
          },
        })),
    },
    {
      type: "item",
      id: "selection.area",
      label: t("selection.area"),
      keywords: "box region rectangle inside area select",
      disabled: d.nodes.length === 0,
      run: () => ctx.editor.openSelectionArea(),
    },
  ];
  if (ctx.nodeId || ctx.edgeId)
    items.push({
      type: "item",
      id: "item.select-similar",
      label: t("menu.selectSimilar"),
      paletteLabel: t("menu.selectSimilar"),
      run: () => ctx.editor.selectSimilar({ nodeId: ctx.nodeId, edgeId: ctx.edgeId }),
    });
  return items;
}
