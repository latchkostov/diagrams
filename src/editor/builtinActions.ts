import { stencils, getStencil } from "../stencils/registry";
import { CATEGORY_ORDER, categoryLabel } from "../lib/categories";
import { toneColor, toneLabel } from "../canvas/groupTones";
import type { GroupTone } from "../canvas/types";
import type { AnnotationKind, AnnotationShape, Side, Stencil } from "../model/types";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_IDS,
  ANNOTATION_SHAPES,
  annotationColor,
  kindLabel,
  shapeLabel,
} from "../canvas/annotations";
import type { Action, ActionContext, MenuItem, MenuNode } from "./actions";
import type { AlignMode } from "./arrange";
import { shortcutKeys } from "./shortcuts";
import { capacityOverlay } from "../live/capacityOverlay";
import { isFlowEdgeTarget, relationshipAction } from "./relationActions";
import { dependencyVisibility } from "../canvas/dependencyVisibility";

// Built-in context-menu actions. Each reads the target from ctx and mutates through ctx.editor.

const TONES = Object.keys(toneColor) as GroupTone[];
const SIDE_LABEL: Record<Side, string> = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };

/** Category ▸ stencil submenus. `pick` builds the leaf for one stencil. */
export function stencilMenu(
  idPrefix: string,
  pick: (s: Stencil) => Pick<MenuItem, "run" | "checked">,
  first?: string,
): MenuNode[] {
  const cats = [...CATEGORY_ORDER];
  if (first) cats.sort((a, b) => (a === first ? -1 : b === first ? 1 : 0));
  return cats.map((c) => ({
    type: "item" as const,
    id: `${idPrefix}:cat:${c}`,
    label: categoryLabel[c],
    children: stencils
      .filter((s) => s.category === c)
      .map((s) => ({
        type: "item" as const,
        id: `${idPrefix}:${s.id}`,
        label: s.label,
        stencil: s.id,
        hint: s.vendor,
        keywords: `${s.vendor} ${s.id} ${s.category}`,
        ...pick(s),
      })),
  }));
}

/** How many recently used stencils quick-add lists above the categories (menus stay ≤ 12 items). */
const QUICK_ADD_RECENT = 3;

/**
 * Quick-add (double-click the canvas, or drop a connection on it): the recently used stencils first,
 * then Category ▸ stencil. Search covers everything, each stencil once.
 */
export function quickAddMenu(pick: (s: Stencil) => void, recent: readonly string[] = []): MenuNode[] {
  const recents = recent
    .map((id) => stencils.find((s) => s.id === id))
    .filter((s): s is Stencil => !!s)
    .slice(0, QUICK_ADD_RECENT);
  const all = stencilMenu("quick-add", (s) => ({ run: () => pick(s) }));
  if (!recents.length) return all;
  return [
    { type: "header", label: "Recently used" },
    ...recents.map((s): MenuItem => ({
      type: "item",
      id: `quick-add:recent:${s.id}`,
      label: s.label,
      stencil: s.id,
      hint: s.vendor,
      keywords: `${s.vendor} ${s.id} ${s.category}`,
      run: () => pick(s),
    })),
    { type: "separator" },
    ...all,
  ];
}

const nodeCount = (ctx: ActionContext) => ctx.selection.nodeIds.length;
const total = (ctx: ActionContext) =>
  ctx.selection.nodeIds.length + ctx.selection.groupIds.length + ctx.selection.edgeIds.length;

const ALIGN: { mode: AlignMode; label: string; icon: MenuItem["icon"] }[] = [
  { mode: "left", label: "Left edges", icon: "align-left" },
  { mode: "center", label: "Horizontal centres", icon: "align-center" },
  { mode: "right", label: "Right edges", icon: "align-right" },
  { mode: "top", label: "Top edges", icon: "align-top" },
  { mode: "middle", label: "Vertical middles", icon: "align-middle" },
  { mode: "bottom", label: "Bottom edges", icon: "align-bottom" },
];

function sideMenu(ctx: ActionContext, end: "sourceSide" | "targetSide"): MenuNode[] {
  const id = ctx.edgeId!;
  const current = ctx.editor.getEdge(id)?.[end];
  const prefix = end === "sourceSide" ? "edge.from-side" : "edge.to-side";
  return [
    {
      type: "item",
      id: `${prefix}:auto`,
      label: "Auto",
      hint: "follows layout",
      checked: !current,
      run: () => ctx.editor.updateEdge(id, { [end]: undefined }),
    },
    { type: "separator" },
    ...(["top", "right", "bottom", "left"] as Side[]).map((side): MenuItem => ({
      type: "item",
      id: `${prefix}:${side}`,
      label: SIDE_LABEL[side],
      checked: current === side,
      run: () => ctx.editor.updateEdge(id, { [end]: side }),
    })),
  ];
}

function toneMenu(prefix: string, current: GroupTone | undefined, pick: (t: GroupTone) => void): MenuNode[] {
  return TONES.map((t) => ({
    type: "item" as const,
    id: `${prefix}:${t}`,
    label: toneLabel[t],
    swatch: toneColor[t],
    checked: current === t,
    run: () => pick(t),
  }));
}

const SHAPE_ICON: Record<AnnotationShape, MenuItem["icon"]> = {
  rect: "shape-rect",
  rounded: "shape-rounded",
  ellipse: "shape-ellipse",
  diamond: "shape-diamond",
  cylinder: "shape-cylinder",
};
const KIND_ICON: Record<AnnotationKind, MenuItem["icon"]> = {
  text: "type",
  note: "note",
  zone: "zone",
  shape: "shape-rect",
};
const KIND_KEYWORDS: Record<AnnotationKind, string> = {
  text: "annotation label caption title words free text",
  note: "annotation sticky note comment post-it",
  zone: "annotation region area highlight band lane",
  shape: "annotation outline box",
};

/** Text, Note, Zone, Shape ▸: what "Annotate" offers on the canvas (and the palette as "Annotate › …"). */
export function annotateMenu(add: (kind: AnnotationKind, shape?: AnnotationShape) => void): MenuNode[] {
  return [
    ...(["text", "note", "zone"] as const).map((k): MenuItem => ({
      type: "item",
      id: `annotate:${k}`,
      label: kindLabel[k],
      icon: KIND_ICON[k],
      shortcut: k === "text" ? shortcutKeys("add-text") : undefined,
      keywords: KIND_KEYWORDS[k],
      run: () => add(k),
    })),
    {
      type: "item",
      id: "annotate:shape",
      label: "Shape",
      icon: "shape-rect",
      children: ANNOTATION_SHAPES.map((sh): MenuItem => ({
        type: "item",
        id: `annotate:shape:${sh}`,
        label: shapeLabel[sh],
        icon: SHAPE_ICON[sh],
        keywords: `${KIND_KEYWORDS.shape} ${sh}`,
        run: () => add("shape", sh),
      })),
    },
  ];
}

export function builtinActions(): Action[] {
  return [
    // ---------------- canvas ----------------
    {
      id: "canvas.add-node",
      section: "insert",
      targets: ["canvas"],
      label: "Add node here",
      icon: "plus",
      searchable: "Search stencils",
      children: (ctx) => stencilMenu("add-node", (s) => ({ run: () => void ctx.editor.addNode(s.id, ctx.point) })),
    },
    {
      id: "canvas.annotate",
      section: "insert",
      targets: ["canvas"],
      label: "Annotate",
      icon: "note",
      children: (ctx) => annotateMenu((kind, shape) => void ctx.editor.addAnnotation(kind, { at: ctx.point, shape })),
    },
    {
      id: "canvas.paste",
      section: "clipboard",
      targets: ["canvas"],
      label: "Paste here",
      icon: "paste",
      shortcut: shortcutKeys("paste"),
      enabled: (ctx) => ctx.editor.hasClipboard(),
      run: (ctx) => void ctx.editor.paste(ctx.point),
    },
    {
      id: "canvas.select-all",
      section: "clipboard",
      targets: ["canvas"],
      label: "Select all",
      icon: "select-all",
      shortcut: shortcutKeys("select-all"),
      run: (ctx) => ctx.editor.selectAll(),
    },
    {
      id: "canvas.auto-layout",
      section: "arrange",
      targets: ["canvas"],
      label: "Auto-layout",
      icon: "layout",
      enabled: (ctx) => ctx.editor.getDiagram().nodes.length > 1,
      run: (ctx) => ctx.editor.autoLayout(),
    },
    {
      id: "canvas.fit",
      modes: ["edit", "live"],
      // The canvas controls show it and Shift+1 does it; the right-click has no room to repeat it.
      paletteOnly: true,
      section: "view",
      targets: ["canvas"],
      label: "Fit view",
      icon: "fit",
      shortcut: shortcutKeys("fit-view"),
      run: (ctx) => ctx.editor.fitView(),
    },
    {
      id: "canvas.zoom-selection",
      modes: ["edit", "live"],
      // Shift+2 does it; the palette finds it. Menus stay within budget.
      paletteOnly: true,
      section: "view",
      targets: ["canvas"],
      label: "Zoom to selection",
      icon: "fit",
      shortcut: shortcutKeys("zoom-selection"),
      enabled: (ctx) => ctx.selection.nodeIds.length + ctx.selection.groupIds.length + ctx.selection.edgeIds.length > 0,
      hint: "Select something first",
      run: (ctx) => void ctx.editor.zoomToSelection(),
    },
    {
      id: "canvas.view-options",
      modes: ["edit", "live"],
      section: "view",
      targets: ["canvas"],
      label: "Show",
      icon: "grid",
      children: (ctx) => {
        const p = ctx.editor.prefs;
        const toggle = (
          id: string,
          label: string,
          key: keyof typeof p,
          icon: MenuItem["icon"],
          keywords?: string,
        ): MenuItem => ({
          type: "item",
          id: `view:${id}`,
          label,
          icon,
          keywords,
          checked: p[key],
          run: () => ctx.editor.setPref(key, !p[key]),
        });
        return [
          toggle("grid", "Grid", "grid", "grid"),
          // Grid and smart guides together: a drag lines up with other nodes, else the 10 px grid.
          toggle("snap", "Snapping", "snap", "magnet", "snap to grid smart guides align equal spacing"),
          toggle("minimap", "Minimap", "minimap", "minimap"),
          toggle("inspector", "Inspector", "inspector", "panel-right"),
          // The capacity heat map: the same app-wide setting as View > Show capacity and C.
          {
            type: "item",
            id: "view:capacity",
            label: "Capacity",
            icon: "sliders",
            shortcut: "C",
            keywords: "show capacity heat map bottleneck utilization",
            checked: capacityOverlay.get(),
            run: () => capacityOverlay.toggle(),
          },
          // Config, secret, identity... edges; hidden, nodes show their glyphs as pips instead.
          {
            type: "item",
            id: "view:dependencies",
            label: "Dependencies",
            icon: "rel-any",
            keywords: "show hide dependencies relationships config secret identity telemetry deploy layers",
            checked: dependencyVisibility.get(),
            run: () => dependencyVisibility.toggle(),
          },
        ];
      },
    },
    {
      id: "canvas.properties",
      modes: ["edit", "live"],
      section: "view",
      targets: ["canvas"],
      label: "Diagram properties",
      icon: "sliders",
      order: 5,
      run: (ctx) => {
        ctx.editor.clearSelection();
        ctx.editor.openInspector();
      },
    },
    {
      id: "canvas.undo",
      // Undo and Redo are canvas controls and Ctrl+Z / Ctrl+Shift+Z: the right-click doesn't repeat them.
      paletteOnly: true,
      section: "history",
      targets: ["canvas"],
      label: "Undo",
      icon: "undo",
      shortcut: shortcutKeys("undo"),
      enabled: (ctx) => ctx.editor.canUndo(),
      run: (ctx) => ctx.editor.undo(),
    },
    {
      id: "canvas.redo",
      paletteOnly: true,
      section: "history",
      targets: ["canvas"],
      label: "Redo",
      icon: "redo",
      shortcut: shortcutKeys("redo"),
      enabled: (ctx) => ctx.editor.canRedo(),
      run: (ctx) => ctx.editor.redo(),
    },
    {
      id: "canvas.export",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      label: "Export",
      icon: "download",
      children: (ctx) => [
        { type: "item", id: "export:json", label: "JSON", hint: "diagrams/v1", run: () => ctx.editor.exportJson() },
      ],
    },
    {
      id: "canvas.shortcuts",
      modes: ["edit", "live"],
      // A canvas control and ? open the sheet already.
      paletteOnly: true,
      section: "file",
      targets: ["canvas"],
      label: "Keyboard shortcuts",
      icon: "keyboard",
      shortcut: "?",
      run: (ctx) => ctx.editor.showShortcuts(),
    },

    // ---------------- node ----------------
    {
      id: "node.rename",
      modes: ["edit", "live"],
      section: "edit",
      targets: ["node"],
      label: "Rename",
      icon: "edit",
      shortcut: shortcutKeys("rename"),
      run: (ctx) => ctx.editor.startEditing({ kind: "node", id: ctx.nodeId!, field: "label" }),
    },
    {
      id: "node.edit-sublabel",
      section: "edit",
      targets: ["node"],
      label: "Edit subtitle",
      icon: "text",
      run: (ctx) => ctx.editor.startEditing({ kind: "node", id: ctx.nodeId!, field: "sublabel" }),
    },
    {
      id: "node.change-stencil",
      section: "edit",
      targets: ["node"],
      label: "Change stencil",
      icon: "shapes",
      searchable: "Search stencils",
      children: (ctx) => {
        const node = ctx.editor.getNode(ctx.nodeId!);
        const current = node ? getStencil(node.stencil) : undefined;
        return stencilMenu(
          "change-stencil",
          (s) => ({
            checked: s.id === node?.stencil,
            run: () => ctx.editor.updateNode(ctx.nodeId!, { stencil: s.id }),
          }),
          current?.category,
        );
      },
    },
    {
      id: "node.connect",
      section: "edit",
      targets: ["node"],
      label: "Connect to",
      icon: "link",
      searchable: "Search nodes",
      children: (ctx) =>
        ctx.editor
          .getDiagram()
          .nodes.filter((n) => n.id !== ctx.nodeId)
          .map((n) => ({
            type: "item" as const,
            id: `connect:${n.id}`,
            label: n.label || n.id,
            stencil: n.stencil,
            hint: n.sublabel,
            keywords: n.id,
            run: () => void ctx.editor.connect(ctx.nodeId!, n.id),
          })),
    },
    {
      id: "node.properties",
      modes: ["edit", "live"],
      section: "edit",
      targets: ["node", "edge", "group", "annotation"],
      label: "Properties",
      icon: "sliders",
      order: 200,
      run: (ctx) => ctx.editor.openInspector(),
    },
    {
      id: "item.duplicate",
      section: "clipboard",
      targets: ["node", "selection", "group", "annotation"],
      label: "Duplicate",
      icon: "duplicate",
      shortcut: shortcutKeys("duplicate"),
      when: (ctx) => nodeCount(ctx) + ctx.selection.groupIds.length > 0,
      run: (ctx) => ctx.editor.duplicate(ctx.selection),
    },
    {
      id: "item.copy",
      section: "clipboard",
      targets: ["node", "selection", "group", "annotation"],
      label: "Copy",
      icon: "copy",
      shortcut: shortcutKeys("copy"),
      when: (ctx) => nodeCount(ctx) + ctx.selection.groupIds.length > 0,
      run: (ctx) => ctx.editor.copy(ctx.selection),
    },
    {
      id: "item.cut",
      section: "clipboard",
      targets: ["node", "selection", "annotation"],
      label: "Cut",
      icon: "cut",
      shortcut: shortcutKeys("cut"),
      when: (ctx) => nodeCount(ctx) + ctx.selection.groupIds.length > 0,
      run: (ctx) => ctx.editor.cut(ctx.selection),
    },
    {
      // Layering is rare in a diagram that avoids overlaps: offered for selections, not every node.
      id: "node.front",
      section: "arrange",
      targets: ["selection"],
      label: "Bring to front",
      icon: "front",
      when: (ctx) => nodeCount(ctx) > 0,
      run: (ctx) => ctx.editor.bringToFront(ctx.selection.nodeIds),
    },
    {
      id: "node.back",
      section: "arrange",
      targets: ["selection"],
      label: "Send to back",
      icon: "back",
      when: (ctx) => nodeCount(ctx) > 0,
      run: (ctx) => ctx.editor.sendToBack(ctx.selection.nodeIds),
    },
    {
      id: "item.delete",
      section: "danger",
      targets: ["node", "edge", "selection", "annotation"],
      label: (ctx) => (ctx.target === "selection" ? `Delete ${total(ctx)} items` : "Delete"),
      icon: "trash",
      danger: true,
      shortcut: shortcutKeys("delete"),
      run: (ctx) => ctx.editor.deleteElements(ctx.selection),
    },

    // ---------------- edge ----------------
    {
      id: "edge.edit-label",
      modes: ["edit", "live"],
      section: "edit",
      targets: ["edge"],
      label: "Edit label",
      icon: "tag",
      run: (ctx) => ctx.editor.startEditing({ kind: "edge", id: ctx.edgeId! }),
    },
    relationshipAction,
    {
      id: "edge.reverse",
      section: "edge",
      targets: ["edge"],
      label: "Reverse direction",
      icon: "swap",
      run: (ctx) => ctx.editor.reverseEdge(ctx.edgeId!),
    },
    {
      id: "edge.toggle-dlq",
      section: "edge",
      targets: ["edge"],
      label: "Dead-letter path",
      icon: "inbox",
      when: isFlowEdgeTarget,
      checked: (ctx) => ctx.editor.getEdge(ctx.edgeId!)?.props?.dlq === true,
      run: (ctx) => {
        const on = ctx.editor.getEdge(ctx.edgeId!)?.props?.dlq === true;
        ctx.editor.setEdgeProps(ctx.edgeId!, { dlq: on ? undefined : true });
      },
    },
    {
      id: "edge.consumer-group",
      section: "edge",
      targets: ["edge"],
      label: "Set consumer group…",
      icon: "users",
      when: isFlowEdgeTarget,
      run: (ctx) => ctx.editor.openInspector("group"),
    },
    {
      id: "edge.from-side",
      section: "edge",
      targets: ["edge"],
      label: "Route from side",
      icon: "route",
      children: (ctx) => sideMenu(ctx, "sourceSide"),
    },
    {
      id: "edge.to-side",
      section: "edge",
      targets: ["edge"],
      label: "Route to side",
      icon: "route",
      children: (ctx) => sideMenu(ctx, "targetSide"),
    },

    // ---------------- selection ----------------
    {
      id: "selection.align",
      section: "arrange",
      targets: ["selection"],
      label: "Align",
      icon: "align-left",
      order: 10,
      enabled: (ctx) => nodeCount(ctx) > 1,
      children: (ctx) =>
        ALIGN.flatMap((a, i): MenuNode[] => [
          ...(i === 3 ? [{ type: "separator" } as const] : []),
          {
            type: "item",
            id: `align:${a.mode}`,
            label: a.label,
            icon: a.icon,
            run: () => ctx.editor.align(ctx.selection.nodeIds, a.mode),
          },
        ]),
    },
    {
      id: "selection.distribute",
      section: "arrange",
      targets: ["selection"],
      label: "Distribute",
      icon: "distribute-h",
      order: 20,
      children: (ctx) => [
        {
          type: "item",
          id: "distribute:h",
          label: "Horizontally",
          icon: "distribute-h",
          disabled: nodeCount(ctx) < 3,
          run: () => ctx.editor.distribute(ctx.selection.nodeIds, "h"),
        },
        {
          type: "item",
          id: "distribute:v",
          label: "Vertically",
          icon: "distribute-v",
          disabled: nodeCount(ctx) < 3,
          run: () => ctx.editor.distribute(ctx.selection.nodeIds, "v"),
        },
      ],
    },
    {
      id: "selection.group",
      section: "arrange",
      targets: ["selection", "node"],
      label: "Add boundary",
      icon: "boundary",
      shortcut: shortcutKeys("group"),
      order: 30,
      // Boundaries hold nodes; a selection of annotations only has nothing to put in one.
      when: (ctx) => {
        const selected = new Set(ctx.selection.nodeIds);
        return ctx.editor.getDiagram().nodes.some((n) => selected.has(n.id));
      },
      children: (ctx) => toneMenu("group-tone", undefined, (t) => void ctx.editor.groupNodes(ctx.selection.nodeIds, t)),
    },

    // ---------------- annotation ----------------
    {
      id: "annotation.edit",
      section: "edit",
      targets: ["annotation"],
      label: (ctx) => (ctx.editor.getAnnotation(ctx.nodeId!)?.kind === "zone" ? "Rename" : "Edit text"),
      icon: "edit",
      shortcut: shortcutKeys("rename"),
      run: (ctx) => ctx.editor.startEditing({ kind: "annotation", id: ctx.nodeId! }),
    },
    {
      id: "annotation.color",
      section: "edit",
      targets: ["annotation"],
      label: "Colour",
      icon: "tone",
      children: (ctx) => {
        const a = ctx.editor.getAnnotation(ctx.nodeId!);
        const current = a ? annotationColor(a) : undefined;
        return ANNOTATION_COLOR_IDS.map((c) => ({
          type: "item" as const,
          id: `annotation-color:${c}`,
          label: ANNOTATION_COLORS[c].label,
          swatch: ANNOTATION_COLORS[c].hex,
          checked: current === c,
          run: () => ctx.editor.updateAnnotation(ctx.nodeId!, { color: c }),
        }));
      },
    },
    {
      id: "annotation.shape",
      section: "edit",
      targets: ["annotation"],
      label: "Shape",
      icon: "shapes",
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind === "shape",
      children: (ctx) => {
        const current = ctx.editor.getAnnotation(ctx.nodeId!)?.shape ?? "rect";
        return ANNOTATION_SHAPES.map((sh) => ({
          type: "item" as const,
          id: `annotation-shape:${sh}`,
          label: shapeLabel[sh],
          icon: SHAPE_ICON[sh],
          checked: current === sh,
          run: () => ctx.editor.updateAnnotation(ctx.nodeId!, { shape: sh }),
        }));
      },
    },
    {
      id: "annotation.front",
      section: "arrange",
      targets: ["annotation"],
      label: "Bring to front",
      icon: "front",
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind !== "zone",
      run: (ctx) => ctx.editor.bringToFront([ctx.nodeId!]),
    },
    {
      id: "annotation.back",
      section: "arrange",
      targets: ["annotation"],
      label: "Send to back",
      icon: "back",
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind !== "zone",
      run: (ctx) => ctx.editor.sendToBack([ctx.nodeId!]),
    },

    // ---------------- group ----------------
    {
      id: "group.rename",
      modes: ["edit", "live"],
      section: "edit",
      targets: ["group"],
      label: "Rename",
      icon: "edit",
      shortcut: shortcutKeys("rename"),
      run: (ctx) => ctx.editor.startEditing({ kind: "group", id: ctx.groupId! }),
    },
    {
      id: "group.tone",
      section: "edit",
      targets: ["group"],
      label: "Colour",
      icon: "tone",
      children: (ctx) =>
        toneMenu("tone", ctx.editor.getGroup(ctx.groupId!)?.tone ?? "neutral", (t) =>
          ctx.editor.updateGroup(ctx.groupId!, { tone: t }),
        ),
    },
    {
      id: "group.fit",
      section: "arrange",
      targets: ["group"],
      label: "Fit to contents",
      icon: "fit",
      run: (ctx) => ctx.editor.fitGroupToContents(ctx.groupId!),
    },
    {
      id: "group.ungroup",
      section: "danger",
      targets: ["group"],
      label: "Remove boundary",
      icon: "ungroup",
      run: (ctx) => ctx.editor.ungroup(ctx.groupId!),
    },
    {
      id: "group.delete",
      section: "danger",
      targets: ["group"],
      label: "Delete boundary and nodes",
      icon: "trash",
      danger: true,
      run: (ctx) => ctx.editor.deleteGroupWithContents(ctx.groupId!),
    },
  ];
}
