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
  | "escape"
  | "fit-view"
  | "zoom-100"
  | "command-palette"
  | "shortcuts";

export interface Shortcut {
  id: ShortcutId;
  /** Any of these combos triggers it. The first is shown in menus. */
  keys: string[];
  label: string;
  group: "Edit" | "Clipboard" | "Selection" | "View" | "Help";
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "undo", keys: ["Mod+Z"], label: "Undo", group: "Edit" },
  { id: "redo", keys: ["Mod+Shift+Z", "Mod+Y"], label: "Redo", group: "Edit" },
  { id: "rename", keys: ["F2"], label: "Rename selected node, edge or boundary", group: "Edit" },
  { id: "delete", keys: ["Delete", "Backspace"], label: "Delete selection", group: "Edit" },
  { id: "duplicate", keys: ["Mod+D"], label: "Duplicate selection", group: "Edit" },
  { id: "group", keys: ["Mod+G"], label: "Add a boundary around the selection", group: "Edit" },
  { id: "copy", keys: ["Mod+C"], label: "Copy", group: "Clipboard" },
  { id: "cut", keys: ["Mod+X"], label: "Cut", group: "Clipboard" },
  { id: "paste", keys: ["Mod+V"], label: "Paste", group: "Clipboard" },
  { id: "select-all", keys: ["Mod+A"], label: "Select all", group: "Selection" },
  {
    id: "nudge",
    keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    label: "Nudge selection 1px",
    group: "Selection",
  },
  {
    id: "nudge-far",
    keys: ["Shift+ArrowUp", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight"],
    label: "Nudge selection 10px",
    group: "Selection",
  },
  { id: "escape", keys: ["Escape"], label: "Close menus, clear selection, then leave live view", group: "Selection" },
  { id: "fit-view", keys: ["Shift+1"], label: "Fit diagram to view", group: "View" },
  { id: "zoom-100", keys: ["Shift+0"], label: "Zoom to 100%", group: "View" },
  {
    id: "command-palette",
    keys: ["Mod+K"],
    label: "Command palette: run an action, find a node, add a stencil",
    group: "Help",
  },
  { id: "shortcuts", keys: ["?"], label: "Show keyboard shortcuts", group: "Help" },
];

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
  const mod = e.ctrlKey || e.metaKey;
  if (mods.has("Mod") !== mod) return false;
  if (mods.has("Alt") !== e.altKey) return false;
  if (!SHIFTED_PUNCTUATION.has(key) && mods.has("Shift") !== e.shiftKey) return false;
  if (key.length === 1 && /[0-9]/.test(key) && e.code) {
    // Shift+1 prints "!" — compare the physical digit instead.
    return e.code === `Digit${key}` || e.key === key;
  }
  return e.key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** Which shortcut (if any) an event triggers. */
export function shortcutFor(e: KeyLike): ShortcutId | null {
  for (const s of SHORTCUTS) if (s.keys.some((k) => matches(e, k))) return s.id;
  return null;
}

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_NAMES: Record<string, [mac: string, other: string]> = {
  Mod: ["⌘", "Ctrl"],
  Shift: ["⇧", "Shift"],
  Alt: ["⌥", "Alt"],
  Delete: ["⌦", "Del"],
  Backspace: ["⌫", "Backspace"],
  Escape: ["Esc", "Esc"],
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
};

/** "Mod+Shift+Z" → "⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatCombo(combo: string, mac = isMac()): string {
  const parts = combo.split("+").map((p) => KEY_NAMES[p]?.[mac ? 0 : 1] ?? (p.length === 1 ? p.toUpperCase() : p));
  return parts.join(mac ? "" : "+");
}

/** True when keyboard input belongs to a text field rather than the canvas. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof Element)) return false;
  if (t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  return false;
}
