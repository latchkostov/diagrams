import { stencilLabel, vendorLabel } from "../i18n/stencils";
import type { ActionContext, ActionRegistry, EditorMode, MenuItem, MenuNode } from "../editor/actions";
import type { EditorApi, Selection } from "../editor/types";
import type { Stencil } from "../model/types";
import { scoreStencil } from "../lib/stencilDisplaySearch";
import { tokens } from "./fuzzy";
import type { CanvasHost, LiveHost, SessionHost } from "./host";
import type { Command } from "./rank";
import { t } from "../i18n";

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
  /** An example's theme, e.g. { label: "Data & AI" }. */
  theme?: { label: string };
}

export interface SourceInput {
  /** Makes a language change invalidate memoized command presentation. */
  locale?: string;
  registry: Pick<ActionRegistry, "build">;
  canvas: CanvasHost | null;
  live: LiveHost | null;
  session?: SessionHost | null;
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
  /** The top bar's Present, so Ctrl+K finds it too (absent while presenting). */
  present?(): void;
  /** Share's "Edit together…", so Ctrl+K finds it too (absent where rooms are off). */
  editTogether?(): void;
  /** View ▸ Language…, so Ctrl+K finds it too (absent in a copy built for one language). */
  language?(): void;
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
/** Action definitions supply complete command names; generic flattening never infers English nouns. */
export function paletteLabel(item: MenuItem): string {
  return item.paletteLabel ?? item.label;
}

function leafLabel(parent: string, leaf: string): string {
  const first = parent.toLowerCase().split(/\s+/)[0];
  return leaf.toLowerCase().includes(first) ? leaf : t("chrome.valueValue", { parent, leaf });
}

function leaves(items: MenuNode[], trail: string[] = []): { item: MenuItem; trail: string[] }[] {
  const out: { item: MenuItem; trail: string[] }[] = [];
  for (const n of items) {
    if (n.type !== "item" || (n.disabled && !n.hint)) continue;
    if (n.children) out.push(...leaves(n.children, [...trail, n.label]));
    else out.push({ item: n, trail });
  }
  return out;
}

/** Registry actions, flattened. Unavailable actions with an explanation stay discoverable. */
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
      if (node.type !== "item" || (node.disabled && !node.hint) || SKIP.has(node.id)) continue;
      const label = paletteLabel(node);
      if (!node.children) {
        add({
          id: `action:${node.id}`,
          group: "actions",
          label,
          icon: node.icon,
          shortcut: node.shortcut,
          hint: node.hint,
          disabled: node.disabled,
          checked: node.checked,
          danger: node.danger,
          keywords: node.keywords,
          run: node.run,
          documentScoped: node.documentScoped,
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
        disabled: node.disabled,
        hint: node.hint,
        documentScoped: node.documentScoped,
      });
      for (const { item, trail } of kids) {
        add({
          id: `action:${item.id}`,
          group: "actions",
          label: item.paletteLabel ?? leafLabel(label, item.label),
          parent: `action:${node.id}`,
          icon: item.icon ?? (item.stencil || item.swatch ? undefined : node.icon),
          stencil: item.stencil,
          swatch: item.swatch,
          shortcut: item.shortcut,
          hint: node.disabled ? node.hint : item.hint,
          disabled: node.disabled || item.disabled,
          checked: item.checked,
          danger: item.danger,
          keywords: [label, ...trail.slice(1), item.keywords ?? "", item.hint ?? ""].join(" ").trim(),
          idle: false,
          run: item.run,
          documentScoped: node.documentScoped || item.documentScoped,
        });
      }
    }
  }
  return out;
}

/** Stencil score on the palette's per-token scale; a leading "add" is the verb, not a search word. */
export function stencilScore(s: Stencil, query: string): number {
  const ts = tokens(query);
  // A language can place the verb after the stencil, or attach it without spaces. Match the complete
  // command's framing around a placeholder, keeping the existing English "add" alias in every language.
  const marker = "\uFFFC";
  const [before, after] = t("chrome.addValue", { name: marker }).split(marker);
  const raw = query.trim();
  const framed = raw.toLowerCase().startsWith(before.toLowerCase()) && raw.toLowerCase().endsWith(after.toLowerCase());
  const rest =
    ts[0] === "add"
      ? ts.slice(1)
      : framed
        ? tokens(raw.slice(before.length, after.length ? -after.length : undefined))
        : ts;
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
      label: canvas.live ? t("chrome.backToEditing") : t("chrome.goLive"),
      icon: "bolt",
      shortcut: "L",
      keywords: canvas.live ? "toggle live stop exit edit" : "toggle live start play simulate",
      run: live.toggle,
    });
  }
  if (onCanvas && input.present)
    out.push({
      id: "view:present",
      group: "actions",
      label: t("topbar.present"),
      icon: "present",
      keywords: "presentation presenter meeting slideshow full screen",
      run: input.present,
    });
  if (onCanvas) out.push(...actionCommands(input.registry, contextsFor(editor!, canvas.live ? "live" : "edit")));
  if (onCanvas && !canvas.live && input.editTogether)
    out.push({
      id: "file:edit-together",
      group: "actions",
      label: t("collab.palette"),
      icon: "users",
      // The English words always, as the Language command does. A Private diagram gets the start dialog's
      // explanation, never a disabled row.
      keywords: `${t("collab.paletteKeywords")} collaborate room edit together share`,
      run: input.editTogether,
    });
  if (input.language)
    out.push({
      id: "view:language",
      group: "actions",
      label: t("language.palette"),
      icon: "sliders",
      // The English words always, so it's found from a language the person can't read.
      keywords: `${t("language.paletteKeywords")} language locale translation`,
      run: input.language,
    });

  if (onCanvas) {
    for (const n of diagram!.nodes) {
      out.push({
        id: `node:${n.id}`,
        documentScoped: true,
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
        documentScoped: true,
        group: "simulations",
        label: t("chrome.runValue", { name: s.title }),
        icon: "bolt",
        keywords: "simulation replay play",
        hint: canvas.live ? undefined : t("chrome.goesLive"),
        disabled: !!input.session?.disabledHint,
        ...(input.session?.disabledHint ? { hint: input.session.disabledHint } : {}),
        run: () => {
          if (!input.session?.disabledHint) input.runSimulation(s.id);
        },
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
        label: t("chrome.addValue", { name: stencilLabel(s) }),
        hint: from ? t("chrome.afterValue", { name: from.label || from.id }) : vendorLabel(s.vendor),
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
      hint:
        d.group === "examples"
          ? d.theme
            ? t("chrome.exampleValue", { theme: d.theme.label })
            : t("chrome.example")
          : t("chrome.yourDiagram"),
      keywords:
        d.group === "examples" ? `open example ${d.theme?.label.toLowerCase() ?? ""}`.trim() : "open your diagram mine",
      run: () => input.openDiagram(d.slug),
    });
  }
  return out;
}
