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
  | "segment-prev"
  | "segment-next"
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
  group: "Edit" | "Clipboard" | "Selection" | "View" | "Help";
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "undo", keys: ["Mod+Z"], group: "Edit" },
  { id: "redo", keys: ["Mod+Shift+Z", "Mod+Y"], group: "Edit" },
  { id: "rename", keys: ["Enter", "F2"], group: "Edit" },
  { id: "delete", keys: ["Delete", "Backspace"], group: "Edit" },
  { id: "duplicate", keys: ["Mod+D"], group: "Edit" },
  { id: "group", keys: ["Mod+G"], group: "Edit" },
  { id: "segment-prev", keys: ["["], group: "Edit" },
  { id: "segment-next", keys: ["]"], group: "Edit" },
  { id: "add-text", keys: ["T"], group: "Edit" },
  {
    id: "add-next",
    keys: ["Alt+ArrowRight", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowUp"],
    group: "Edit",
  },
  {
    id: "clone-next",
    keys: ["Alt+Shift+ArrowRight", "Alt+Shift+ArrowDown", "Alt+Shift+ArrowLeft", "Alt+Shift+ArrowUp"],
    group: "Edit",
  },
  { id: "copy", keys: ["Mod+C"], group: "Clipboard" },
  { id: "cut", keys: ["Mod+X"], group: "Clipboard" },
  { id: "paste", keys: ["Mod+V"], group: "Clipboard" },
  { id: "select-all", keys: ["Mod+A"], group: "Selection" },
  {
    id: "nudge",
    keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    group: "Selection",
  },
  {
    id: "nudge-far",
    keys: ["Shift+ArrowUp", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight"],
    group: "Selection",
  },
  { id: "select-next", keys: ["Tab"], group: "Selection" },
  { id: "select-prev", keys: ["Shift+Tab"], group: "Selection" },
  {
    id: "select-toward",
    keys: ["Ctrl+Alt+ArrowRight", "Ctrl+Alt+ArrowDown", "Ctrl+Alt+ArrowLeft", "Ctrl+Alt+ArrowUp"],
    group: "Selection",
  },
  { id: "select-edge-out", keys: ["Ctrl+Alt+]"], group: "Selection" },
  { id: "select-edge-in", keys: ["Ctrl+Alt+["], group: "Selection" },
  {
    id: "escape",
    keys: ["Escape"],
    group: "Selection",
  },
  { id: "fit-view", keys: ["Shift+1"], group: "View" },
  { id: "zoom-selection", keys: ["Shift+2"], group: "View" },
  { id: "zoom-100", keys: ["Shift+0"], group: "View" },
  {
    id: "command-palette",
    keys: ["Mod+K"],
    group: "Help",
  },
  { id: "shortcuts", keys: ["?"], group: "Help" },
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
