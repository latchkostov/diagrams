import type { ActionContext, ActionRegistry, EditorMode, MenuItem, MenuNode, MenuTarget } from "../editor/actions";
import type { EditorApi, Selection } from "../editor/types";
import type { Stencil } from "../model/types";
import { scoreStencil } from "../lib/stencilSearch";
import { tokens } from "./fuzzy";
import type { CanvasHost, LiveHost } from "./host";
import type { Command } from "./rank";

/*
 * Where palette commands come from. Everything is derived from what the app already exposes: the
 * action registry (so the palette offers exactly what the context menus would, with their `when`,
 * `modes` and `enabled` rules), the stencil catalogue, the open diagram, and the diagram picker.
 */

export interface DiagramOption {
  slug: string;
  title: string;
  /** "examples" for the built-in ones; anything else is the user's own. */
  group: string;
}

export interface SourceInput {
  registry: Pick<ActionRegistry, "build">;
  canvas: CanvasHost | null;
  live: LiveHost | null;
  /** The app view: actions, nodes and simulations need the canvas. */
  view: "canvas" | "gallery" | "lab";
  stencils: readonly Stencil[];
  recentStencils: readonly string[];
  diagrams: readonly DiagramOption[];
  currentSlug?: string;
  openDiagram(slug: string): void;
  /** Outside the canvas (gallery): queue the stencil and open the last diagram. */
  sendStencilToCanvas(stencilId: string): void;
  /** Called after a stencil is added from the canvas (shared "recent stencils"). */
  onStencilUsed?(stencilId: string): void;
  runSimulation(id: string): void;
}

const EMPTY: Selection = { nodeIds: [], edgeIds: [], groupIds: [] };

/** Registry contexts for a selection: the canvas, plus the selected thing (most specific first). */
export function contextsFor(editor: EditorApi, mode: EditorMode): ActionContext[] {
  const sel = editor.getSelection();
  const base = { editor, mode, surface: "palette" as const };
  const canvas: ActionContext = { ...base, target: "canvas", selection: sel };
  const n = sel.nodeIds.length;
  const e = sel.edgeIds.length;
  const g = sel.groupIds.length;
  const total = n + e + g;
  if (!total) return [canvas];
  if (total > 1) return [{ ...base, target: "selection", selection: sel }, canvas];
  if (n)
    return [
      {
        ...base,
        // Texts, notes, zones and shapes share the node id space but have their own menu.
        target: editor.getAnnotation(sel.nodeIds[0]) ? "annotation" : "node",
        nodeId: sel.nodeIds[0],
        selection: { ...EMPTY, nodeIds: sel.nodeIds },
      },
      canvas,
    ];
  if (e)
    return [{ ...base, target: "edge", edgeId: sel.edgeIds[0], selection: { ...EMPTY, edgeIds: sel.edgeIds } }, canvas];
  return [
    { ...base, target: "group", groupId: sel.groupIds[0], selection: { ...EMPTY, groupIds: sel.groupIds } },
    canvas,
  ];
}

/** Covered by the "Add stencil" source, which also connects to the selection. */
const SKIP = new Set(["canvas.add-node"]);
const LABEL: Record<string, string> = { "canvas.paste": "Paste" };
const NOUN: Record<MenuTarget, string> = {
  canvas: "",
  node: "node",
  edge: "edge",
  group: "boundary",
  selection: "selection",
  annotation: "annotation",
};

/** Menu labels are read next to the thing; out of context "Rename" needs its noun. */
export function paletteLabel(item: MenuItem, target: MenuTarget): string {
  if (LABEL[item.id]) return LABEL[item.id];
  const noun = NOUN[target];
  if (!noun || /\s/.test(item.label) || item.children) return item.label;
  if (item.label === "Properties") return `${noun[0].toUpperCase()}${noun.slice(1)} properties`;
  return `${item.label} ${noun}`;
}

function leafLabel(parent: string, leaf: string): string {
  const first = parent.toLowerCase().split(/\s+/)[0];
  return leaf.toLowerCase().includes(first) ? leaf : `${parent} › ${leaf}`;
}

function leaves(items: MenuNode[], trail: string[] = []): { item: MenuItem; trail: string[] }[] {
  const out: { item: MenuItem; trail: string[] }[] = [];
  for (const n of items) {
    if (n.type !== "item" || n.disabled) continue;
    if (n.children) out.push(...leaves(n.children, [...trail, n.label]));
    else out.push({ item: n, trail });
  }
  return out;
}

/** Every visible, enabled registry action for the contexts, submenus flattened. Disabled ones are hidden. */
export function actionCommands(registry: Pick<ActionRegistry, "build">, contexts: readonly ActionContext[]): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  const add = (c: Command) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  for (const ctx of contexts) {
    for (const node of registry.build(ctx)) {
      if (node.type !== "item" || node.disabled || SKIP.has(node.id)) continue;
      const label = paletteLabel(node, ctx.target);
      if (!node.children) {
        add({
          id: `action:${node.id}`,
          group: "actions",
          label,
          icon: node.icon,
          shortcut: node.shortcut,
          hint: node.hint,
          checked: node.checked,
          danger: node.danger,
          keywords: node.keywords,
          run: node.run,
        });
        continue;
      }
      const kids = leaves(node.children);
      if (!kids.length) continue;
      add({
        id: `action:${node.id}`,
        group: "actions",
        label,
        icon: node.icon,
        shortcut: node.shortcut,
        drill: label,
      });
      for (const { item, trail } of kids) {
        add({
          id: `action:${item.id}`,
          group: "actions",
          label: leafLabel(label, item.label),
          parent: `action:${node.id}`,
          icon: item.icon ?? (item.stencil || item.swatch ? undefined : node.icon),
          stencil: item.stencil,
          swatch: item.swatch,
          shortcut: item.shortcut,
          hint: item.hint,
          checked: item.checked,
          danger: item.danger,
          keywords: [label, ...trail.slice(1), item.keywords ?? "", item.hint ?? ""].join(" ").trim(),
          idle: false,
          run: item.run,
        });
      }
    }
  }
  return out;
}

/** Stencil score on the palette's per-token scale; a leading "add" is the verb, not a search word. */
export function stencilScore(s: Stencil, query: string): number {
  const ts = tokens(query);
  const rest = ts[0] === "add" ? ts.slice(1) : ts;
  if (!rest.length) return ts.length ? 60 : 1;
  const score = scoreStencil(s, rest.join(" "));
  return score ? score / rest.length : 0;
}

export function collectCommands(input: SourceInput): Command[] {
  const { canvas, live, view } = input;
  const out: Command[] = [];
  const onCanvas = view === "canvas" && !!canvas;
  const editor = canvas?.editor;
  const diagram = onCanvas ? editor!.getDiagram() : undefined;

  // Live first: it's the canvas's headline verb.
  if (onCanvas && live) {
    out.push({
      id: "live:toggle",
      group: "actions",
      // The Live toggle's own words: "Go live", and "Back to editing" (its tooltip) while live.
      label: canvas.live ? "Back to editing" : "Go live",
      icon: "bolt",
      shortcut: "L",
      keywords: canvas.live ? "toggle live stop exit edit" : "toggle live start play simulate",
      run: live.toggle,
    });
  }
  if (onCanvas) out.push(...actionCommands(input.registry, contextsFor(editor!, canvas.live ? "live" : "edit")));

  if (onCanvas) {
    for (const n of diagram!.nodes) {
      out.push({
        id: `node:${n.id}`,
        group: "nodes",
        label: n.label || n.id,
        hint: n.sublabel,
        stencil: n.stencil,
        keywords: `${n.id} ${n.sublabel ?? ""}`,
        run: () => canvas.focusNode(n.id),
      });
    }
  }

  if (onCanvas && live) {
    for (const s of diagram!.simulations ?? []) {
      out.push({
        id: `sim:${s.id}`,
        group: "simulations",
        label: `Run “${s.title}”`,
        icon: "bolt",
        keywords: "simulation replay play",
        hint: canvas.live ? undefined : "goes live",
        run: () => input.runSimulation(s.id),
      });
    }
  }

  // Stencils: on the editable canvas (not mid-run), or from the gallery into the last diagram.
  if ((onCanvas && !canvas.live) || view === "gallery") {
    const sel = onCanvas ? editor!.getSelection() : EMPTY;
    const from = sel.nodeIds.length === 1 && !sel.edgeIds.length ? editor!.getNode(sel.nodeIds[0]) : undefined;
    const recent = new Set(input.recentStencils);
    const ordered = [
      ...input.recentStencils.map((id) => input.stencils.find((s) => s.id === id)).filter((s): s is Stencil => !!s),
      ...input.stencils.filter((s) => !recent.has(s.id)),
    ];
    for (const s of ordered) {
      out.push({
        id: `stencil:${s.id}`,
        group: "stencils",
        label: `Add ${s.label}`,
        hint: from ? `after ${from.label || from.id}` : s.vendor,
        stencil: s.id,
        idle: recent.has(s.id),
        score: (q) => stencilScore(s, q),
        run: () => {
          if (onCanvas) {
            canvas.addStencil(s.id);
            input.onStencilUsed?.(s.id);
          } else input.sendStencilToCanvas(s.id);
        },
      });
    }
  }

  for (const d of input.diagrams) {
    if (view === "canvas" && d.slug === input.currentSlug) continue;
    out.push({
      id: `diagram:${d.slug}`,
      group: "diagrams",
      label: d.title,
      icon: "canvas",
      hint: d.group === "examples" ? "Example" : "Your diagram",
      keywords: d.group === "examples" ? "open example" : "open your diagram mine",
      run: () => input.openDiagram(d.slug),
    });
  }
  return out;
}
