import { t } from "../i18n";
import type { IconName } from "../components/Icon";
import type { EditorApi, Selection, XY } from "./types";

/*
 * Action registry: every context-menu entry is an Action. Menus are built per target from
 * whatever is registered, so features (and the simulation UI) add entries without touching the
 * canvas or the menu component.
 *
 * EXTENSION POINT — e.g. from the simulation UI:
 *
 *   import { actionRegistry } from "../editor/actions";
 *
 *   useEffect(() => actionRegistry.register([
 *     {
 *       id: "sim.inject-10",
 *       section: "simulation",           // shown under a "Live" header
 *       targets: ["node"],
 *       modes: ["live"],                 // default ["edit"]: say where the action makes sense
 *       label: "Inject 10 messages",
 *       icon: "bolt",
 *       when: (ctx) => engineIsLoaded && !!ctx.nodeId,
 *       run: (ctx) => engine.inject(ctx.nodeId!, 10),
 *     },
 *   ]), [engine]);                       // register() returns the unregister function
 *
 * The "simulation" section is predefined and stays hidden until it has a visible action.
 *
 * Modes: the canvas builds menus for the editor ("edit") or for live view ("live"). An action is
 * offered only in the modes it lists, so live menus lead with live verbs and keep just the editing
 * actions that still make sense mid-run, without any filtering outside the registry.
 */

/** Which canvas mode a menu is built for. */
export type EditorMode = "edit" | "live";

/** "annotation" is a text, note, zone or shape (its id is in `nodeId`). */
export type MenuTarget = "canvas" | "node" | "edge" | "selection" | "group" | "annotation";

export interface ActionContext {
  target: MenuTarget;
  /** The element the menu was opened on. */
  nodeId?: string;
  edgeId?: string;
  groupId?: string;
  /** Selection the menu applies to (for "node" it is just that node). */
  selection: Selection;
  /** Where the menu was opened, in flow coordinates ("Add node here", "Paste here"). */
  point?: XY;
  editor: EditorApi;
  /** The canvas mode the menu is for. Default "edit". */
  mode?: EditorMode;
  /** Who's asking: a context menu (default) or the command palette. */
  surface?: "menu" | "palette";
}

/** A rendered menu row. Submenu children are plain data so they can be built per open. */
export type MenuNode = MenuItem | { type: "separator" } | { type: "header"; label: string };

export interface MenuItem {
  type: "item";
  /** Becomes `data-testid="context-menu-item-<id>"`. Children conventionally use `parent:child`. */
  id: string;
  label: string;
  icon?: IconName;
  /** Render a stencil's icon instead of a glyph. */
  stencil?: string;
  /** Render a colour swatch (tones, message types). */
  swatch?: string;
  /** Combo like "Mod+D" (formatted per platform), shown right-aligned. */
  shortcut?: string;
  /** Muted right-aligned text (e.g. vendor). */
  hint?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  /** Extra words matched by submenu search. */
  keywords?: string;
  run?: () => void;
  children?: MenuNode[];
  /** Show a search box (with this placeholder) at the top of the submenu; filters all leaf items. */
  searchable?: string;
  /** The command palette's name for this leaf when "Parent › leaf" would be ambiguous (nested submenus). */
  paletteLabel?: string;
  /**
   * Its id carries the open diagram's own ids or words (Connect to ›, Reconnect ›, a node, a simulation): the palette
   * never remembers it among recent commands for a private diagram (src/palette/recent.ts).
   */
  documentScoped?: boolean;
}

export interface Action {
  /** Unique, stable id, e.g. "node.rename" or "sim.inject-10". */
  id: string;
  /** Section id; see `builtinSections`. Unknown sections sort last. */
  section: string;
  targets: readonly MenuTarget[];
  /** Modes the action is offered in. Default ["edit"]. */
  modes?: readonly EditorMode[];
  label: string | ((ctx: ActionContext) => string);
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  /** Order within the section (default 100, then registration order). */
  order?: number;
  /**
   * Offered by the command palette but left out of context menus: for actions that already have an
   * always-visible control and a shortcut (e.g. Fit view), so menus stay within budget.
   */
  paletteOnly?: boolean;
  /** Hide the action when false. */
  when?: (ctx: ActionContext) => boolean;
  /** Show the action disabled when false. */
  enabled?: (ctx: ActionContext) => boolean;
  /** Explanation shown beside an unavailable action. */
  hint?: string | ((ctx: ActionContext) => string | undefined);
  checked?: (ctx: ActionContext) => boolean;
  run?: (ctx: ActionContext) => void;
  /** Submenu contents (makes the action a submenu; `run` is then ignored). */
  children?: (ctx: ActionContext) => MenuNode[];
  /** Placeholder for a search box at the top of the submenu. */
  searchable?: string;
}

export interface MenuSection {
  id: string;
  order: number;
  /** Optional header rendered above the section. */
  title?: string;
}

export const builtinSections: readonly MenuSection[] = [
  { id: "insert", order: 10 },
  { id: "edit", order: 20 },
  { id: "edge", order: 25 },
  { id: "clipboard", order: 30 },
  { id: "arrange", order: 40 },
  {
    id: "simulation",
    order: 50,
    get title() {
      return t("fileDialog.live");
    },
  },
  { id: "view", order: 60 },
  { id: "history", order: 70 },
  { id: "file", order: 80 },
  { id: "danger", order: 90 },
];

const EDIT_ONLY: readonly EditorMode[] = ["edit"];

export class ActionRegistry {
  private actions = new Map<string, { action: Action; seq: number }>();
  private sections = new Map<string, MenuSection>();
  private seq = 0;

  constructor(sections: readonly MenuSection[] = []) {
    for (const s of sections) this.sections.set(s.id, s);
  }

  /** Adds (or replaces, by id) actions. Returns a function that removes exactly these. */
  register(actions: readonly Action[]): () => void {
    const added = actions.map((action) => {
      const entry = { action, seq: this.seq++ };
      this.actions.set(action.id, entry);
      return entry;
    });
    return () => {
      for (const e of added) if (this.actions.get(e.action.id) === e) this.actions.delete(e.action.id);
    };
  }

  registerSection(section: MenuSection): () => void {
    this.sections.set(section.id, section);
    return () => {
      if (this.sections.get(section.id) === section) this.sections.delete(section.id);
    };
  }

  list(): Action[] {
    return [...this.actions.values()].map((e) => e.action);
  }

  /** Menu rows for a context: visible actions grouped by section, separators between sections. */
  build(ctx: ActionContext): MenuNode[] {
    const bySection = new Map<string, { action: Action; seq: number }[]>();
    for (const e of this.actions.values()) {
      const a = e.action;
      if (!a.targets.includes(ctx.target)) continue;
      if (!(a.modes ?? EDIT_ONLY).includes(ctx.mode ?? "edit")) continue;
      if (a.paletteOnly && ctx.surface !== "palette") continue;
      if (a.when && !safe(() => a.when!(ctx), false)) continue;
      if (!bySection.has(a.section)) bySection.set(a.section, []);
      bySection.get(a.section)!.push(e);
    }
    const order = (id: string) => this.sections.get(id)?.order ?? 1000;
    const out: MenuNode[] = [];
    for (const id of [...bySection.keys()].sort((a, b) => order(a) - order(b))) {
      const items = bySection
        .get(id)!
        .sort((a, b) => (a.action.order ?? 100) - (b.action.order ?? 100) || a.seq - b.seq)
        .map(({ action }) => toItem(action, ctx))
        .filter((i): i is MenuItem => i !== null);
      if (!items.length) continue;
      if (out.length) out.push({ type: "separator" });
      const title = this.sections.get(id)?.title;
      if (title) out.push({ type: "header", label: title });
      out.push(...items);
    }
    return out;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.error("[actions]", err);
    return fallback;
  }
}

function toItem(a: Action, ctx: ActionContext): MenuItem | null {
  const children = a.children ? safe(() => a.children!(ctx), []) : undefined;
  if (children && !children.some((c) => c.type === "item")) return null;
  return {
    type: "item",
    id: a.id,
    label: typeof a.label === "function" ? a.label(ctx) : a.label,
    icon: a.icon,
    shortcut: a.shortcut,
    danger: a.danger,
    disabled: a.enabled ? !safe(() => a.enabled!(ctx), false) : false,
    hint: typeof a.hint === "function" ? a.hint(ctx) : a.hint,
    checked: a.checked ? safe(() => a.checked!(ctx), false) : undefined,
    children,
    searchable: a.searchable,
    run: children ? undefined : () => a.run?.(ctx),
  };
}

/** The app-wide registry. Built-in editor actions are registered by the canvas on mount. */
export const actionRegistry = new ActionRegistry(builtinSections);
