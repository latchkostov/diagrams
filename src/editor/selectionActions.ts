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
      // The empty canvas's right-click keeps Select all and its row budget; there the Select tools are in
      // Ctrl+K (the canvas context) and the Inspector's Selection actions.
      when: (ctx) => ctx.target !== "canvas" || ctx.surface === "palette",
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
  const nodeLabels = new Map(d.nodes.map((n) => [n.id, n.label || n.id]));
  const nodeLabel = (id: string) => nodeLabels.get(id) ?? id;
  const targets: { target: SelectionTarget; label: string; keywords?: string }[] = [
    ...d.nodes
      .filter((n) => selected.has(`node:${n.id}`))
      .map((n) => ({
        target: { kind: "node" as const, id: n.id },
        label: n.label || n.id,
        keywords: `${n.sublabel ?? ""} ${n.id}`,
      })),
    ...(d.annotations ?? [])
      .filter((n) => selected.has(`node:${n.id}`))
      .map((n) => ({
        target: { kind: "node" as const, id: n.id },
        label: n.text.split("\n")[0] || n.id,
      })),
    ...(d.groups ?? [])
      .filter((g) => selected.has(`node:${GROUP_PREFIX}${g.id}`))
      .map((g) => ({
        target: { kind: "node" as const, id: GROUP_PREFIX + g.id },
        label: g.label || g.id,
      })),
    ...d.edges
      .filter((e) => selected.has(`edge:${e.id}`))
      .map((e) => ({
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
      children: targets.map((item) => ({
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
  const similar = selectSimilarAction();
  if (similar.targets.includes(ctx.target) && similar.when?.(ctx))
    items.push({
      type: "item",
      id: similar.id,
      label: typeof similar.label === "function" ? similar.label(ctx) : similar.label,
      paletteLabel: t("menu.selectSimilar"),
      run: () => similar.run?.(ctx),
    });
  return items;
}

/** Canonical eligibility and execution for both the palette and the Select submenu. */
export function selectSimilarAction(): Action {
  return {
    id: "item.select-similar",
    paletteOnly: true,
    section: "edit",
    targets: ["node", "edge"],
    get label() {
      return t("menu.selectSimilar");
    },
    icon: "select-all",
    order: 150,
    when: (ctx) => (ctx.nodeId ? !!ctx.editor.getNode(ctx.nodeId) : !!ctx.edgeId),
    run: (ctx) => void ctx.editor.selectSimilar({ nodeId: ctx.nodeId, edgeId: ctx.edgeId }),
  };
}
