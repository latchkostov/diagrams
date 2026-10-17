import { msg } from "../i18n";
// Keyboard shortcut table + matching. Combos are written "Mod+Shift+Z": Mod = Cmd on macOS,
// Ctrl elsewhere. The table drives both the key handler and the cheat-sheet dialog.

export type ShortcutId =
  | "undo"
  | "redo"
  | "delete"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "select-all"
  | "group"
  | "nudge"
  | "nudge-far"
  | "rename"
  | "add-text"
  | "add-next"
  | "clone-next"
  | "escape"
  | "fit-view"
  | "zoom-100"
  | "zoom-selection"
  | "select-next"
  | "select-prev"
  | "select-toward"
  | "select-edge-out"
  | "select-edge-in"
  | "command-palette"
  | "shortcuts";

export interface Shortcut {
  id: ShortcutId;
  /**
   * Any of these combos triggers it. The first is shown in menus. `Mod` is Ctrl or ⌘; `Ctrl` is the Control key
   * on every platform (⌃ on a Mac, where ⌘⌥ + arrows already switch the browser's tabs).
   */
  keys: string[];
  label: string;
  group: "Edit" | "Clipboard" | "Selection" | "View" | "Help";
}

/* eslint-disable local/no-literal-ui-text -- Internal diagnostic labels. The sheet renders its translated LABELS table. */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: "undo", keys: ["Mod+Z"], label: "Undo", group: "Edit" },
  { id: "redo", keys: ["Mod+Shift+Z", "Mod+Y"], label: "Redo", group: "Edit" },
  { id: "rename", keys: ["Enter", "F2"], label: "Rename the selection, or edit its text", group: "Edit" },
  { id: "delete", keys: ["Delete", "Backspace"], label: "Delete selection", group: "Edit" },
  { id: "duplicate", keys: ["Mod+D"], label: "Duplicate selection", group: "Edit" },
  { id: "group", keys: ["Mod+G"], label: "Add a boundary around the selection", group: "Edit" },
  { id: "add-text", keys: ["T"], label: "Add text at the pointer", group: "Edit" },
  {
    id: "add-next",
    keys: ["Alt+ArrowRight", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowUp"],
    label: "Next node that way, connected",
    group: "Edit",
  },
  {
    id: "clone-next",
    keys: ["Alt+Shift+ArrowRight", "Alt+Shift+ArrowDown", "Alt+Shift+ArrowLeft", "Alt+Shift+ArrowUp"],
    label: "A copy that way, connected",
    group: "Edit",
  },
  { id: "copy", keys: ["Mod+C"], label: "Copy", group: "Clipboard" },
  { id: "cut", keys: ["Mod+X"], label: "Cut", group: "Clipboard" },
  { id: "paste", keys: ["Mod+V"], label: "Paste", group: "Clipboard" },
  { id: "select-all", keys: ["Mod+A"], label: "Select all", group: "Selection" },
  {
    id: "nudge",
    keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    label: "Nudge to the next grid line (Snapping off: 1 px)",
    group: "Selection",
  },
  {
    id: "nudge-far",
    keys: ["Shift+ArrowUp", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight"],
    label: "Nudge 50 px (Snapping off: 10 px)",
    group: "Selection",
  },
  { id: "select-next", keys: ["Tab"], label: "Next node, in reading order", group: "Selection" },
  { id: "select-prev", keys: ["Shift+Tab"], label: "Previous node", group: "Selection" },
  {
    id: "select-toward",
    keys: ["Ctrl+Alt+ArrowRight", "Ctrl+Alt+ArrowDown", "Ctrl+Alt+ArrowLeft", "Ctrl+Alt+ArrowUp"],
    label: "Nearest node that way",
    group: "Selection",
  },
  { id: "select-edge-out", keys: ["Ctrl+Alt+]"], label: "The node's next outgoing edge", group: "Selection" },
  { id: "select-edge-in", keys: ["Ctrl+Alt+["], label: "The node's next incoming edge", group: "Selection" },
  {
    id: "escape",
    keys: ["Escape"],
    label: "Close menus, clear selection, close Checks, then leave live view",
    group: "Selection",
  },
  { id: "fit-view", keys: ["Shift+1"], label: "Fit diagram to view", group: "View" },
  { id: "zoom-selection", keys: ["Shift+2"], label: "Zoom to selection", group: "View" },
  { id: "zoom-100", keys: ["Shift+0"], label: "Zoom to 100%", group: "View" },
  {
    id: "command-palette",
    keys: ["Mod+K"],
    label: "Command palette: run an action, find a node, add a stencil",
    group: "Help",
  },
  { id: "shortcuts", keys: ["?"], label: "Show keyboard shortcuts", group: "Help" },
];
/* eslint-enable local/no-literal-ui-text */

export const shortcutKeys = (id: ShortcutId): string => SHORTCUTS.find((s) => s.id === id)?.keys[0] ?? "";

export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"> & { code?: string };

/** Keys whose printed character already implies Shift ("?" is Shift+/ on most layouts). */
const SHIFTED_PUNCTUATION = new Set([
  "?",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "{",
  "}",
  "|",
  ":",
  '"',
  "<",
  ">",
  "~",
]);

export function matches(e: KeyLike, combo: string): boolean {
  const parts = combo.split("+");
  // "Mod++" style isn't used; a bare "+" key would be written "Plus".
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  // `Ctrl` is the Control key itself (⌃ on a Mac); `Mod` is Ctrl or ⌘.
  const ctrl = mods.has("Ctrl");
  if (ctrl && (!e.ctrlKey || e.metaKey)) return false;
  const mod = ctrl ? e.metaKey : e.ctrlKey || e.metaKey;
  if (mods.has("Mod") !== mod) return false;
  if (mods.has("Alt") !== e.altKey) return false;
  if (!SHIFTED_PUNCTUATION.has(key) && mods.has("Shift") !== e.shiftKey) return false;
  if (key.length === 1 && /[0-9]/.test(key) && e.code) {
    // Shift+1 prints "!" — compare the physical digit instead.
    return e.code === `Digit${key}` || e.key === key;
  }
  // Brackets by physical key too: with Ctrl+Alt (AltGr on some layouts) the printed character can differ.
  if ((key === "[" || key === "]") && e.code)
    return e.code === (key === "[" ? "BracketLeft" : "BracketRight") || e.key === key;
  return e.key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** Which shortcut (if any) an event triggers. */
export function shortcutFor(e: KeyLike): ShortcutId | null {
  for (const s of SHORTCUTS) if (s.keys.some((k) => matches(e, k))) return s.id;
  return null;
}

export const isMac = (platform = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent) =>
  /Mac|iPhone|iPad/.test(platform);

const KEY_NAMES: Record<string, [mac: string | (() => string), other: string | (() => string)]> = {
  Mod: ["⌘", msg("keys.ctrl")],
  Ctrl: ["⌃", msg("keys.ctrl")],
  Shift: ["⇧", msg("keys.shift")],
  Alt: ["⌥", msg("keys.alt")],
  Delete: ["⌦", msg("keys.delete")],
  Backspace: ["⌫", msg("keys.backspace")],
  Escape: [msg("keys.escape"), msg("keys.escape")],
  Enter: [msg("keys.enter"), msg("keys.enter")],
  Tab: [msg("keys.tab"), msg("keys.tab")],
  Space: [msg("keys.space"), msg("keys.space")],
  Drag: [msg("keys.drag"), msg("keys.drag")],
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
};

/** "Mod+Shift+Z" → "⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatCombo(combo: string, mac = isMac()): string {
  const parts = combo.split("+").map((p) => {
    const name = KEY_NAMES[p === "Esc" ? "Escape" : p]?.[mac ? 0 : 1];
    return typeof name === "function" ? name() : (name ?? (p.length === 1 ? p.toUpperCase() : p));
  });
  return parts.join(mac ? "" : "+");
}

/** True when keyboard input belongs to a text field rather than the canvas. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof Element)) return false;
  if (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  return false;
}
