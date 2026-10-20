import { revisionAtLeast } from "../model/revisions";
import { effectiveCallerPolicy } from "./callerPolicy";
import { routeTableCapable, trafficMixCapable } from "../model/requestRouting";
import { withRouteTable } from "../model/routingEdits";
import { routingIntent } from "./routingIntent";
import { stencilLabel, vendorLabel } from "../i18n/stencils";
import { t } from "../i18n";
import { categoryLabel, toneLabel, kindLabel, shapeLabel, colorLabel } from "../i18n/chrome";
export { fileActions } from "../interop/fileActions";
import { fileActions } from "../interop/fileActions";
import type { InteropApi } from "../interop/useInterop";
import { actionRegistry } from "./actions";

/** Registration belongs to the canvas module, alongside the actions it registers. */
export function registerCanvasActions(get: () => InteropApi): () => void {
  return actionRegistry.register([...builtinActions(), ...fileActions(get)]);
}
import { stencils, getStencil } from "../stencils/registry";
import { CATEGORY_ORDER } from "../lib/categories";
import { toneColor, isPresetGroupTone } from "../canvas/groupTones";
import type { GroupTone } from "../canvas/types";
import type { AnnotationKind, AnnotationShape, Side, Stencil } from "../model/types";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_IDS,
  DEFAULT_ANNOTATION_SHAPES,
  annotationColor,
} from "../canvas/annotations";
import { shapeMenu } from "../canvas/shapes/menu";
import type { ShapeDefinition } from "../canvas/shapes/catalog";
import type { Action, ActionContext, MenuItem, MenuNode } from "./actions";
import type { AlignMode } from "./arrange";
import { shortcutKeys } from "./shortcuts";
import { checksPanel } from "../canvas/checks/checksPanel";
import { editingRuns } from "../canvas/checks/editingRuns";
import { capacityOverlay } from "../live/capacityOverlay";
import { isFlowEdgeTarget, relationshipAction } from "./relationActions";
import { dependencyVisibility } from "../canvas/dependencyVisibility";
import type { EdgeEnd } from "./edgeEdits";

// Built-in context-menu actions. Each reads the target from ctx and mutates through ctx.editor.

const TONES = Object.keys(toneColor) as GroupTone[];
const SIDE_LABEL: Record<Side, string> = {
  get top() {
    return t("chrome.top");
  },
  get right() {
    return t("chrome.right");
  },
  get bottom() {
    return t("chrome.bottom");
  },
  get left() {
    return t("chrome.left");
  },
};

const SIDE_HINT = (side: Side | undefined) => (side ? SIDE_LABEL[side] : t("menu.auto"));

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
    get label() {
      return categoryLabel[c];
    },
    children: stencils
      .filter((s) => s.category === c)
      .map((s) => ({
        type: "item" as const,
        id: `${idPrefix}:${s.id}`,
        get label() {
          return stencilLabel(s);
        },
        stencil: s.id,
        get hint() {
          return vendorLabel(s.vendor);
        },
        keywords: `${s.vendor} ${s.id} ${s.category}`,
        ...pick(s),
      })),
  }));
}

/** Run or Stop simulations applies: editing a diagram with saved simulations, where checks run. */
const simulationsShown = (ctx: ActionContext) =>
  checksPanel.isAvailable() && !!editingRuns() && !!ctx.editor.getDiagram?.().simulations?.length;

/** How many recently used stencils quick-add lists above the categories (menus stay ≤ 12 items). */
const QUICK_ADD_RECENT = 3;

/**
 * Quick-add (double-click the canvas, or drop a connection on it): the recently used stencils first,
 * then Category ▸ stencil. Search covers everything, each stencil once.
 */
export function quickAddMenu(
  pick: (s: Stencil) => void,
  recent: readonly string[] = [],
  pickShape?: (s: ShapeDefinition) => void,
): MenuNode[] {
  const recents = recent
    .map((id) => stencils.find((s) => s.id === id))
    .filter((s): s is Stencil => !!s)
    .slice(0, QUICK_ADD_RECENT);
  const stencilsList = stencilMenu("quick-add", (s) => ({ run: () => pick(s) }));
  const shapesItem: MenuNode | null = pickShape
    ? {
        type: "item",
        id: "quick-add:shapes",
        get label() {
          return t("menu.shape");
        },
        icon: "shapes",
        children: shapeMenu("quick-add-shape", (s) => ({
          run: () => pickShape(s),
        })),
      }
    : null;
  const all = shapesItem ? [...stencilsList, shapesItem] : stencilsList;
  if (!recents.length) return all;
  return [
    {
      type: "header",
      get label() {
        return t("menu.recentlyUsed");
      },
    },
    ...recents.map((s): MenuItem => ({
      type: "item",
      id: `quick-add:recent:${s.id}`,
      get label() {
        return stencilLabel(s);
      },
      stencil: s.id,
      get hint() {
        return vendorLabel(s.vendor);
      },
      keywords: `${s.vendor} ${s.id} ${s.category}`,
      run: () => pick(s),
    })),
    { type: "separator" },
    ...all,
  ];
}

const nodeCount = (ctx: ActionContext) => ctx.selection.nodeIds.length;
/** Tidy up lays out nodes (not annotations): it needs three of them. */
const tidyCount = (ctx: ActionContext) => {
  const ids = new Set(ctx.selection.nodeIds);
  return ctx.editor.getDiagram().nodes.filter((n) => ids.has(n.id)).length;
};
const total = (ctx: ActionContext) =>
  ctx.selection.nodeIds.length + ctx.selection.groupIds.length + ctx.selection.edgeIds.length;

const ALIGN: { mode: AlignMode; label: string; icon: MenuItem["icon"] }[] = [
  {
    mode: "left",
    get label() {
      return t("menu.leftEdges");
    },
    icon: "align-left",
  },
  {
    mode: "center",
    get label() {
      return t("menu.horizontalCentres");
    },
    icon: "align-center",
  },
  {
    mode: "right",
    get label() {
      return t("menu.rightEdges");
    },
    icon: "align-right",
  },
  {
    mode: "top",
    get label() {
      return t("menu.topEdges");
    },
    icon: "align-top",
  },
  {
    mode: "middle",
    get label() {
      return t("menu.verticalMiddles");
    },
    icon: "align-middle",
  },
  {
    mode: "bottom",
    get label() {
      return t("menu.bottomEdges");
    },
    icon: "align-bottom",
  },
];

function sideMenu(ctx: ActionContext, end: "sourceSide" | "targetSide"): MenuNode[] {
  const id = ctx.edgeId!;
  const current = ctx.editor.getEdge(id)?.[end];
  const prefix = end === "sourceSide" ? "edge.from-side" : "edge.to-side";
  const name = end === "sourceSide" ? t("chrome.routeFromSide") : t("chrome.routeToSide");
  return [
    {
      type: "item",
      id: `${prefix}:auto`,
      get label() {
        return t("menu.auto");
      },
      paletteLabel: t("chrome.valueAuto", { name }),
      get hint() {
        return t("menu.followsLayout");
      },
      checked: !current,
      run: () => ctx.editor.updateEdge(id, { [end]: undefined }),
    },
    { type: "separator" },
    ...(["top", "right", "bottom", "left"] as Side[]).map((side): MenuItem => ({
      type: "item",
      id: `${prefix}:${side}`,
      label: SIDE_LABEL[side],
      paletteLabel: t("chrome.valueValue", { parent: name, leaf: SIDE_LABEL[side] }),
      checked: current === side,
      run: () => ctx.editor.updateEdge(id, { [end]: side }),
    })),
  ];
}

/** The nodes (and shapes) an edge's `end` could move to: anything that takes edges, except its two ends. */
function reconnectMenu(ctx: ActionContext, end: EdgeEnd): MenuNode[] {
  const e = ctx.editor.getEdge(ctx.edgeId!);
  if (!e) return [];
  const d = ctx.editor.getDiagram();
  const ends = new Set([e.from, e.to]);
  const run = (id: string) => () => void ctx.editor.reconnectEdge(e.id, end, id);
  return [
    ...d.nodes
      .filter((n) => !ends.has(n.id))
      .map((n): MenuItem => ({
        type: "item",
        id: `reconnect-${end}:${n.id}`,
        documentScoped: true,
        label: n.label || n.id,
        paletteLabel:
          end === "source"
            ? t("chrome.reconnectFromValue", { name: n.label || n.id })
            : t("chrome.reconnectToValue", { name: n.label || n.id }),
        stencil: n.stencil,
        hint: n.sublabel,
        keywords: n.id,
        run: run(n.id),
      })),
    ...(d.annotations ?? [])
      .filter((a) => a.kind === "shape" && !ends.has(a.id))
      .map((a): MenuItem => ({
        type: "item",
        id: `reconnect-${end}:${a.id}`,
        documentScoped: true,
        label: a.text || a.id,
        paletteLabel:
          end === "source"
            ? t("chrome.reconnectFromValue", { name: a.text || a.id })
            : t("chrome.reconnectToValue", { name: a.text || a.id }),
        icon: "shape-rect",
        keywords: `${a.id} shape`,
        run: run(a.id),
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

const KIND_ICON: Record<AnnotationKind, MenuItem["icon"]> = {
  // eslint-disable-next-line local/no-literal-ui-text -- icon identifier
  text: "type",
  note: "note",
  zone: "zone",
  shape: "shape-rect",
};
const KIND_KEYWORDS: Record<AnnotationKind, string> = {
  // eslint-disable-next-line local/no-literal-ui-text -- English search aliases; visible labels are translated separately
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
      paletteSearchOnly: true,
      get label() {
        return t("menu.shape");
      },
      icon: "shape-rect",
      get searchable() {
        return t("shape.searchShapes");
      },
      children: [
        ...DEFAULT_ANNOTATION_SHAPES.map((sh): MenuItem => ({
          type: "item",
          id: `annotate:shape:${sh}`,
          label: shapeLabel[sh],
          icon: `shape-${sh}` as MenuItem["icon"],
          keywords: `${KIND_KEYWORDS.shape} ${sh}`,
          run: () => add("shape", sh),
        })),
        { type: "separator" },
        ...shapeMenu("annotate-shape", (s) => ({ run: () => add("shape", s.id) })),
      ],
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
      get label() {
        return t("menu.addNodeHere");
      },
      icon: "plus",
      get searchable() {
        return t("importReport.searchStencils");
      },
      children: (ctx) => stencilMenu("add-node", (s) => ({ run: () => void ctx.editor.addNode(s.id, ctx.point) })),
    },
    {
      id: "canvas.annotate",
      section: "insert",
      targets: ["canvas"],
      get label() {
        return t("menu.annotate");
      },
      icon: "note",
      children: (ctx) => annotateMenu((kind, shape) => void ctx.editor.addAnnotation(kind, { at: ctx.point, shape })),
    },
    {
      id: "canvas.paste",
      paletteLabel: () => t("shortcuts.paste"),
      section: "clipboard",
      targets: ["canvas"],
      get label() {
        return t("menu.pasteHere");
      },
      icon: "paste",
      shortcut: shortcutKeys("paste"),
      enabled: (ctx) => ctx.editor.hasClipboard(),
      run: (ctx) => void ctx.editor.paste(ctx.point),
    },
    {
      id: "canvas.select-all",
      section: "clipboard",
      targets: ["canvas"],
      get label() {
        return t("shortcuts.selectAll");
      },
      icon: "select-all",
      shortcut: shortcutKeys("select-all"),
      run: (ctx) => ctx.editor.selectAll(),
    },
    {
      id: "canvas.auto-layout",
      section: "arrange",
      targets: ["canvas"],
      get label() {
        return t("menu.autoLayout");
      },
      icon: "layout",
      enabled: (ctx) => ctx.editor.getDiagram().nodes.length > 1,
      run: (ctx) => ctx.editor.autoLayout(),
    },
    {
      // The Checks card (likely design problems, with fixes): here, Ctrl+K, View and the count under the title.
      id: "canvas.check-diagram",
      section: "arrange",
      targets: ["canvas"],
      // eslint-disable-next-line local/no-literal-ui-text -- Checks wording is excluded from this batch
      label: "Check diagram",
      icon: "checklist",
      enabled: (ctx) => !!ctx.editor.getDiagram?.().nodes.length,
      hint: (ctx) => (ctx.editor.getDiagram?.().nodes.length ? undefined : "Add something to check first"),
      run: () => checksPanel.open(),
    },
    // The Checks card's Run simulations, while editing a diagram with saved ones: Run opens the card and plays them
    // there; while they play, Stop takes its place. Two actions, each keeping the intent it was shown with: a menu or
    // the palette left open past the run's end never turns a Stop into a new run (nor a Run into a restart).
    {
      id: "canvas.run-simulations",
      section: "arrange",
      targets: ["canvas"],
      // eslint-disable-next-line local/no-literal-ui-text -- Checks wording is excluded from this batch
      label: "Run simulations",
      icon: "bolt",
      when: (ctx) => simulationsShown(ctx) && !editingRuns()!.isRunning(),
      run: () => {
        const runs = editingRuns();
        if (!runs || runs.isRunning()) return;
        checksPanel.open();
        runs.start();
      },
    },
    {
      id: "canvas.stop-simulations",
      section: "arrange",
      targets: ["canvas"],
      // eslint-disable-next-line local/no-literal-ui-text -- Checks wording is excluded from this batch
      label: "Stop simulations",
      icon: "bolt",
      when: (ctx) => simulationsShown(ctx) && editingRuns()!.isRunning(),
      run: () => void editingRuns()?.stop(),
    },
    {
      id: "canvas.fit",
      modes: ["edit", "live"],
      // The canvas controls show it and Shift+1 does it; the right-click has no room to repeat it.
      paletteOnly: true,
      section: "view",
      targets: ["canvas"],
      get label() {
        return t("menu.fitView");
      },
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
      get label() {
        return t("shortcuts.zoomSelection");
      },
      icon: "fit",
      shortcut: shortcutKeys("zoom-selection"),
      enabled: (ctx) => ctx.selection.nodeIds.length + ctx.selection.groupIds.length + ctx.selection.edgeIds.length > 0,
      get hint() {
        return t("menu.selectSomethingFirst");
      },
      run: (ctx) => void ctx.editor.zoomToSelection(),
    },
    {
      id: "canvas.view-options",
      modes: ["edit", "live"],
      section: "view",
      targets: ["canvas"],
      get label() {
        return t("password.show");
      },
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
          toggle("grid", t("chrome.grid"), "grid", "grid"),
          // Grid and smart guides together: a drag lines up with other nodes, else the 10 px grid.
          toggle("snap", t("chrome.snapping"), "snap", "magnet", "snap to grid smart guides align equal spacing"),
          toggle("minimap", t("chrome.minimap"), "minimap", "minimap"),
          toggle("inspector", t("chrome.inspector"), "inspector", "panel-right"),
          // The capacity heat map: the same app-wide setting as View > Show capacity and C.
          {
            type: "item",
            id: "view:capacity",
            get label() {
              return t("menu.capacity");
            },
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
            get label() {
              return t("menu.dependencies");
            },
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
      get label() {
        return t("menu.diagramProperties");
      },
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
      get label() {
        return t("ai.undo");
      },
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
      get label() {
        return t("shortcuts.redo");
      },
      icon: "redo",
      shortcut: shortcutKeys("redo"),
      enabled: (ctx) => ctx.editor.canRedo(),
      run: (ctx) => ctx.editor.redo(),
    },
    {
      id: "canvas.shortcuts",
      modes: ["edit", "live"],
      // A canvas control and ? open the sheet already.
      paletteOnly: true,
      section: "file",
      targets: ["canvas"],
      get label() {
        return t("shortcuts.title");
      },
      icon: "keyboard",
      shortcut: "?",
      run: (ctx) => ctx.editor.showShortcuts(),
    },

    // ---------------- node ----------------
    {
      id: "node.rename",
      paletteLabel: () => t("chrome.renameNode"),
      modes: ["edit", "live"],
      section: "edit",
      targets: ["node"],
      get label() {
        return t("library.rename");
      },
      icon: "edit",
      shortcut: shortcutKeys("rename"),
      run: (ctx) => ctx.editor.startEditing({ kind: "node", id: ctx.nodeId!, field: "label" }),
    },
    {
      id: "node.edit-sublabel",
      section: "edit",
      targets: ["node"],
      get label() {
        return t("menu.editSubtitle");
      },
      icon: "text",
      run: (ctx) => ctx.editor.startEditing({ kind: "node", id: ctx.nodeId!, field: "sublabel" }),
    },
    {
      id: "node.change-stencil",
      section: "edit",
      targets: ["node"],
      get label() {
        return t("menu.changeStencil");
      },
      icon: "shapes",
      get searchable() {
        return t("importReport.searchStencils");
      },
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
      get label() {
        return t("menu.connectTo");
      },
      icon: "link",
      get searchable() {
        return t("menu.searchNodes");
      },
      children: (ctx) =>
        ctx.editor
          .getDiagram()
          .nodes.filter((n) => n.id !== ctx.nodeId)
          .map((n) => ({
            type: "item" as const,
            id: `connect:${n.id}`,
            documentScoped: true,
            label: n.label || n.id,
            stencil: n.stencil,
            hint: n.sublabel,
            keywords: n.id,
            run: () => void ctx.editor.connect(ctx.nodeId!, n.id),
          })),
    },
    {
      id: "node.properties",
      paletteLabel: (ctx) =>
        ctx.target === "edge"
          ? t("chrome.edgeProperties")
          : ctx.target === "annotation"
            ? t("chrome.annotationProperties")
            : ctx.target === "group"
              ? t("chrome.boundaryProperties")
              : t("chrome.nodeProperties"),
      modes: ["edit", "live"],
      section: "edit",
      targets: ["node", "edge", "group", "annotation"],
      get label() {
        return t("menu.properties");
      },
      icon: "sliders",
      order: 200,
      run: (ctx) => ctx.editor.openInspector(),
    },
    {
      // Request routing: a router's first table (its Default keeps today's connections) and a source's mix. Offered
      // only where they apply, and only until there is one; the inspector edits them after that.
      id: "node.add-routes",
      section: "edit",
      targets: ["node"],
      get label() {
        return t("routing.addRoutes");
      },
      icon: "route",
      order: 210,
      when: (ctx) => {
        const node = ctx.nodeId ? ctx.editor.getNode(ctx.nodeId) : undefined;
        const d = node && ctx.editor.getDiagram();
        return (
          !!node &&
          revisionAtLeast(d?.planning?.revision, "p3-a1") &&
          node.props?.routeTable === undefined &&
          routeTableCapable(node.stencil, getStencil(node.stencil).simRole)
        );
      },
      run: (ctx) => {
        // The same first table as the inspector's button; the inspector opens on its Default row.
        routingIntent.set(ctx.nodeId!, "default");
        ctx.editor.applyDiagram(withRouteTable(ctx.editor.getDiagram(), ctx.nodeId!));
        ctx.editor.select({ nodeIds: [ctx.nodeId!] });
        ctx.editor.openInspector();
      },
    },
    {
      id: "node.add-mix",
      section: "edit",
      targets: ["node"],
      get label() {
        return t("routing.addMix");
      },
      icon: "traffic",
      order: 210,
      when: (ctx) => {
        const node = ctx.nodeId ? ctx.editor.getNode(ctx.nodeId) : undefined;
        const d = node && ctx.editor.getDiagram();
        return (
          !!node &&
          revisionAtLeast(d?.planning?.revision, "p3-a1") &&
          node.props?.trafficMix === undefined &&
          trafficMixCapable(getStencil(node.stencil).simRole)
        );
      },
      run: (ctx) => {
        // As the inspector's button: the new route's form, its Path focused; nothing changes until Add.
        routingIntent.set(ctx.nodeId!, "new-route");
        ctx.editor.select({ nodeIds: [ctx.nodeId!] });
        ctx.editor.openInspector();
      },
    },
    {
      // "Select all like this": every node of this stencil, every edge of this relationship (D11).
      id: "item.select-similar",
      section: "edit",
      targets: ["node", "edge"],
      get label() {
        return t("menu.selectSimilar");
      },
      icon: "select-all",
      order: 150,
      when: (ctx) => (ctx.nodeId ? !!ctx.editor.getNode(ctx.nodeId) : !!ctx.edgeId),
      run: (ctx) => void ctx.editor.selectSimilar({ nodeId: ctx.nodeId, edgeId: ctx.edgeId }),
    },
    {
      id: "item.duplicate",
      paletteLabel: (ctx) =>
        ctx.target === "node"
          ? t("chrome.duplicateNode")
          : ctx.target === "group"
            ? t("chrome.duplicateBoundary")
            : ctx.target === "annotation"
              ? t("chrome.duplicateAnnotation")
              : t("shortcuts.duplicate"),
      section: "clipboard",
      targets: ["node", "selection", "group", "annotation"],
      get label() {
        return t("shortcuts.mouse.altDrag.does");
      },
      icon: "duplicate",
      shortcut: shortcutKeys("duplicate"),
      when: (ctx) => nodeCount(ctx) + ctx.selection.groupIds.length > 0,
      run: (ctx) => ctx.editor.duplicate(ctx.selection),
    },
    {
      id: "item.copy",
      paletteLabel: (ctx) =>
        ctx.target === "node"
          ? t("chrome.copyNode")
          : ctx.target === "group"
            ? t("chrome.copyBoundary")
            : ctx.target === "annotation"
              ? t("chrome.copyAnnotation")
              : t("chrome.copySelection"),
      section: "clipboard",
      targets: ["node", "selection", "group", "annotation"],
      get label() {
        return t("shortcuts.copy");
      },
      icon: "copy",
      shortcut: shortcutKeys("copy"),
      when: (ctx) => nodeCount(ctx) + ctx.selection.groupIds.length > 0,
      run: (ctx) => ctx.editor.copy(ctx.selection),
    },
    {
      id: "item.cut",
      paletteLabel: (ctx) =>
        ctx.target === "node"
          ? t("chrome.cutNode")
          : ctx.target === "annotation"
            ? t("chrome.cutAnnotation")
            : t("chrome.cutSelection"),
      section: "clipboard",
      targets: ["node", "selection", "annotation"],
      get label() {
        return t("shortcuts.cut");
      },
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
      get label() {
        return t("menu.bringToFront");
      },
      icon: "front",
      when: (ctx) => nodeCount(ctx) > 0,
      run: (ctx) => ctx.editor.bringToFront(ctx.selection.nodeIds),
    },
    {
      id: "node.back",
      section: "arrange",
      targets: ["selection"],
      get label() {
        return t("menu.sendToBack");
      },
      icon: "back",
      when: (ctx) => nodeCount(ctx) > 0,
      run: (ctx) => ctx.editor.sendToBack(ctx.selection.nodeIds),
    },
    {
      id: "item.delete",
      paletteLabel: (ctx) =>
        ctx.target === "group"
          ? t("command.deleteBoundary")
          : ctx.target === "node"
            ? t("chrome.deleteNode")
            : ctx.target === "edge"
              ? t("chrome.deleteEdge")
              : ctx.target === "annotation"
                ? t("chrome.deleteAnnotation")
                : t("chrome.deleteValueItemsOtherValueItems", { count: total(ctx) }),
      section: "danger",
      targets: ["node", "edge", "selection", "annotation"],
      label: (ctx) =>
        ctx.target === "selection"
          ? t("chrome.deleteValueItemsOtherValueItems", { count: total(ctx) })
          : t("chrome.delete"),
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
      get label() {
        return t("menu.editLabel");
      },
      icon: "tag",
      run: (ctx) => ctx.editor.startEditing({ kind: "edge", id: ctx.edgeId! }),
    },
    relationshipAction,
    {
      id: "edge.simulation",
      section: "edge",
      targets: ["edge"],
      modes: ["edit", "live"],
      label: () => t("threads.simulation"),
      when: (ctx) =>
        isFlowEdgeTarget(ctx) &&
        ctx.editor.getEdge(ctx.edgeId!)?.kind === "sync" &&
        revisionAtLeast(ctx.editor.getDiagram().planning?.revision, "p3-w1") &&
        !!effectiveCallerPolicy(ctx.editor, ctx.edgeId!)?.editable,
      children: (ctx) => {
        const effective = effectiveCallerPolicy(ctx.editor, ctx.edgeId!)!;
        const blocking = effective.policy.blocking;
        return [
          {
            type: "item",
            id: "edge.wait",
            label: blocking ? t("threads.freeAction") : t("threads.holdAction"),
            run: () => effective.set({ wait: blocking ? "non-blocking" : "blocking" }),
          },
        ];
      },
    },
    {
      // Rewire one end from the keyboard (dragging a selected edge's end is the pointer's way): From ▸ and To ▸,
      // each a searchable list of the nodes that end could move to. Keeps the label, relationship and settings.
      id: "edge.reconnect",
      paletteLabel: () => t("chrome.reconnectEdge"),
      section: "edge",
      targets: ["edge"],
      get label() {
        return t("menu.reconnect");
      },
      icon: "link",
      children: (ctx) => {
        const e = ctx.editor.getEdge(ctx.edgeId!);
        const name = (id?: string) =>
          (id && (ctx.editor.getNode(id)?.label || ctx.editor.getAnnotation(id)?.text)) || id;
        return [
          {
            type: "item",
            id: "edge.reconnect:from",
            get label() {
              return t("menu.from");
            },
            hint: name(e?.from),
            get searchable() {
              return t("menu.searchNodes");
            },
            children: reconnectMenu(ctx, "source"),
          },
          {
            type: "item",
            id: "edge.reconnect:to",
            get label() {
              return t("menu.to");
            },
            hint: name(e?.to),
            get searchable() {
              return t("menu.searchNodes");
            },
            children: reconnectMenu(ctx, "target"),
          },
        ];
      },
    },
    {
      // A new node in the middle of the edge (holding a node over it is the pointer's way): A→B becomes A→N→B,
      // both halves keeping the edge's meaning; the new node's name opens, as quick-add's does.
      id: "edge.insert-node",
      section: "edge",
      targets: ["edge"],
      get label() {
        return t("menu.insertNode");
      },
      icon: "plus",
      get searchable() {
        return t("importReport.searchStencils");
      },
      children: (ctx) =>
        stencilMenu("insert-node", (s) => ({
          run: () => ctx.editor.nameNew(() => ctx.editor.insertNode(ctx.edgeId!, s.id), s.label),
        })),
    },
    {
      id: "edge.reverse",
      section: "edge",
      targets: ["edge"],
      get label() {
        return t("menu.reverseDirection");
      },
      icon: "swap",
      run: (ctx) => ctx.editor.reverseEdge(ctx.edgeId!),
    },
    {
      id: "edge.toggle-dlq",
      section: "edge",
      targets: ["edge"],
      get label() {
        return t("menu.deadLetterPath");
      },
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
      get label() {
        return t("menu.setConsumerGroup");
      },
      icon: "users",
      when: isFlowEdgeTarget,
      run: (ctx) => ctx.editor.openInspector("group"),
    },
    {
      // Pinning a side is rare (the router picks them): one row, From side ▸ and To side ▸ under it.
      id: "edge.route",
      section: "edge",
      targets: ["edge"],
      get label() {
        return t("menu.route");
      },
      icon: "route",
      children: (ctx) => [
        {
          type: "item",
          id: "edge.from-side",
          get label() {
            return t("menu.fromSide");
          },
          icon: "route",
          hint: SIDE_HINT(ctx.editor.getEdge(ctx.edgeId!)?.sourceSide),
          children: sideMenu(ctx, "sourceSide"),
        },
        {
          type: "item",
          id: "edge.to-side",
          get label() {
            return t("menu.toSide");
          },
          icon: "route",
          hint: SIDE_HINT(ctx.editor.getEdge(ctx.edgeId!)?.targetSide),
          children: sideMenu(ctx, "targetSide"),
        },
      ],
    },

    // ---------------- selection ----------------
    {
      id: "selection.align",
      section: "arrange",
      targets: ["selection"],
      get label() {
        return t("menu.align");
      },
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
      get label() {
        return t("menu.distribute");
      },
      icon: "distribute-h",
      order: 20,
      children: (ctx) => [
        {
          type: "item",
          id: "distribute:h",
          get label() {
            return t("menu.horizontally");
          },
          icon: "distribute-h",
          disabled: nodeCount(ctx) < 3,
          run: () => ctx.editor.distribute(ctx.selection.nodeIds, "h"),
        },
        {
          type: "item",
          id: "distribute:v",
          get label() {
            return t("menu.vertically");
          },
          icon: "distribute-v",
          disabled: nodeCount(ctx) < 3,
          run: () => ctx.editor.distribute(ctx.selection.nodeIds, "v"),
        },
      ],
    },
    {
      // The layered layout on just the selection (D15): nothing else moves, and it lands clear of the rest.
      id: "selection.tidy",
      section: "arrange",
      targets: ["selection"],
      get label() {
        return t("menu.tidyUp");
      },
      icon: "layout",
      order: 25,
      when: (ctx) => tidyCount(ctx) >= 3,
      run: (ctx) => ctx.editor.tidy(ctx.selection.nodeIds),
    },
    {
      id: "selection.group",
      section: "arrange",
      targets: ["selection", "node"],
      get label() {
        return t("menu.addBoundary");
      },
      icon: "boundary",
      shortcut: shortcutKeys("group"),
      order: 30,
      when: (ctx) => {
        const sel = ctx.selection;
        const nodeCount = sel.nodeIds?.length ?? 0;
        const groupCount = sel.groupIds?.length ?? 0;
        if (nodeCount + groupCount === 0) return false;
        const d = ctx.editor.getDiagram();
        const selected = new Set(sel.nodeIds);
        const hasNodes = d.nodes.some((n) => selected.has(n.id));
        const hasAnnotations = (d.annotations ?? []).some((a) => selected.has(a.id));
        const hasGroups = groupCount > 0;
        return hasNodes || hasAnnotations || hasGroups;
      },
      children: (ctx) =>
        toneMenu(
          "group-tone",
          undefined,
          (t) => void ctx.editor.groupNodes([...(ctx.selection.nodeIds ?? []), ...(ctx.selection.groupIds ?? [])], t),
        ),
    },

    // ---------------- annotation ----------------
    {
      id: "annotation.edit",
      paletteLabel: (ctx) =>
        ctx.editor.getAnnotation(ctx.nodeId!)?.kind === "zone" ? t("chrome.renameAnnotation") : t("chrome.editText"),
      section: "edit",
      targets: ["annotation"],
      label: (ctx) =>
        ctx.editor.getAnnotation(ctx.nodeId!)?.kind === "zone" ? t("library.rename") : t("chrome.editText"),
      icon: "edit",
      shortcut: shortcutKeys("rename"),
      run: (ctx) => ctx.editor.startEditing({ kind: "annotation", id: ctx.nodeId! }),
    },
    {
      id: "annotation.color",
      section: "edit",
      targets: ["annotation"],
      get label() {
        return t("menu.colour");
      },
      icon: "tone",
      children: (ctx) => {
        const a = ctx.editor.getAnnotation(ctx.nodeId!);
        const current = a ? annotationColor(a) : undefined;
        return ANNOTATION_COLOR_IDS.map((c) => ({
          type: "item" as const,
          id: `annotation-color:${c}`,
          label: colorLabel[c],
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
      get label() {
        return t("menu.shape");
      },
      icon: "shapes",
      get searchable() {
        return t("shape.searchShapes");
      },
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind === "shape",
      children: (ctx) => {
        const current = ctx.editor.getAnnotation(ctx.nodeId!)?.shape ?? "rect";
        return [
          ...DEFAULT_ANNOTATION_SHAPES.map((sh) => ({
            type: "item" as const,
            id: `annotation-shape:quick:${sh}`,
            label: shapeLabel[sh],
            icon: `shape-${sh}` as MenuItem["icon"],
            checked: current === sh,
            run: () => ctx.editor.updateAnnotation(ctx.nodeId!, { shape: sh }),
          })),
          { type: "separator" as const },
          ...shapeMenu("annotation-shape", (s) => ({
            checked: current === s.id,
            run: () => ctx.editor.updateAnnotation(ctx.nodeId!, { shape: s.id }),
          })),
        ];
      },
    },
    {
      id: "annotation.front",
      section: "arrange",
      targets: ["annotation"],
      get label() {
        return t("menu.bringToFront");
      },
      icon: "front",
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind !== "zone",
      run: (ctx) => ctx.editor.bringToFront([ctx.nodeId!]),
    },
    {
      id: "annotation.back",
      section: "arrange",
      targets: ["annotation"],
      get label() {
        return t("menu.sendToBack");
      },
      icon: "back",
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind !== "zone",
      run: (ctx) => ctx.editor.sendToBack([ctx.nodeId!]),
    },
    {
      id: "annotation.convertToBoundary",
      section: "arrange",
      targets: ["annotation"],
      get label() {
        return t("menu.convertToBoundary");
      },
      icon: "boundary",
      when: (ctx) => ctx.editor.getAnnotation(ctx.nodeId!)?.kind === "zone",
      run: (ctx) => ctx.editor.convertZoneToBoundary(ctx.nodeId!),
    },

    // ---------------- group ----------------
    {
      id: "group.rename",
      paletteLabel: () => t("chrome.renameBoundary"),
      modes: ["edit", "live"],
      section: "edit",
      targets: ["group"],
      get label() {
        return t("library.rename");
      },
      icon: "edit",
      shortcut: shortcutKeys("rename"),
      run: (ctx) => ctx.editor.startEditing({ kind: "group", id: ctx.groupId! }),
    },
    {
      id: "group.tone",
      section: "edit",
      targets: ["group"],
      get label() {
        return t("menu.colour");
      },
      icon: "tone",
      children: (ctx) => {
        const tone = ctx.editor.getGroup(ctx.groupId!)?.tone;
        return toneMenu("tone", isPresetGroupTone(tone) ? tone : undefined, (t) =>
          ctx.editor.updateGroup(ctx.groupId!, { tone: t }),
        );
      },
    },
    {
      id: "group.fit",
      section: "arrange",
      targets: ["group"],
      get label() {
        return t("menu.fitToContents");
      },
      icon: "fit",
      run: (ctx) => ctx.editor.fitGroupToContents(ctx.groupId!),
    },
    {
      id: "group.convertToZone",
      section: "arrange",
      targets: ["group"],
      get label() {
        return t("menu.convertToZone");
      },
      icon: "zone",
      run: (ctx) => ctx.editor.convertGroupToZone(ctx.groupId!),
    },
    {
      id: "group.ungroup",
      section: "danger",
      targets: ["group"],
      get label() {
        return t("menu.removeBoundary");
      },
      icon: "ungroup",
      run: (ctx) => ctx.editor.ungroup(ctx.groupId!),
    },
    {
      id: "group.delete",
      section: "danger",
      targets: ["group"],
      get label() {
        return t("menu.deleteBoundaryAndNodes");
      },
      icon: "trash",
      danger: true,
      run: (ctx) => ctx.editor.deleteGroupWithContents(ctx.groupId!),
    },
  ];
}
