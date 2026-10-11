import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { examples } from "../examples";
import { parseNative, serializeNative, validateDiagram } from "../interop/native";
import { notify } from "../interop/ui/toast";

export const IMPORTED_SLUG = "imported";
/** Diagrams opened from a share link live here, so they never overwrite the user's own work. */
export const SHARED_SLUG = "shared";
const AUTOSAVE_PREFIX = "diagrams.autosave.v1:";
const IMPORTED_KEY = "diagrams.imported.v1";
const SHARED_KEY = "diagrams.shared.v1";
const BINDINGS_KEY = "diagrams.bindings.v1";

export type ParseResult = { ok: true; diagram: DiagramFile; warnings?: string[] } | { ok: false; error: string };

/** Validates an imported diagrams/v1 file (see src/interop/native.ts for the rules). */
export function parseDiagram(text: string): ParseResult {
  return parseNative(text);
}

export function downloadDiagram(diagram: DiagramFile, slug: string) {
  const blob = new Blob([serializeNative(diagram)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug || "diagram"}.diagram.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Stored diagrams pass the same validator as imports; anything else reads as missing. */
function readDiagram(key: string): DiagramFile | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const r = parseNative(raw);
    return r.ok ? r.diagram : undefined;
  } catch {
    return undefined;
  }
}

/** Validates, then stores. Throws (with a readable message) on invalid input or full storage, so callers never replace a slot with something that can't render. */
function storeDiagram(key: string, d: DiagramFile) {
  const r = validateDiagram(d);
  if (!r.ok) throw new Error(r.error);
  try {
    localStorage.setItem(key, JSON.stringify(r.diagram));
  } catch {
    throw new Error(
      "The browser's storage for this site is full or blocked, so the diagram couldn't be kept. Export it to keep your work.",
    );
  }
}

export function getImported(): DiagramFile | undefined {
  return readDiagram(IMPORTED_KEY);
}

export function setImported(d: DiagramFile) {
  storeDiagram(IMPORTED_KEY, d);
  writeAutosave(IMPORTED_SLUG, null);
}

export function getShared(): DiagramFile | undefined {
  return readDiagram(SHARED_KEY);
}

export function setShared(d: DiagramFile) {
  storeDiagram(SHARED_KEY, d);
  writeAutosave(SHARED_SLUG, null);
}

export function clearShared() {
  try {
    localStorage.removeItem(SHARED_KEY);
    localStorage.removeItem(AUTOSAVE_PREFIX + SHARED_SLUG);
  } catch {
    // storage blocked: nothing stored to clear
  }
}

/** Where a slot's diagram was last opened from / saved to, so "Save" goes back there. */
export type StoredBinding = { kind: "drive"; id: string; name: string };

export function getBindings(): Record<string, StoredBinding> {
  return read<Record<string, StoredBinding>>(BINDINGS_KEY) ?? {};
}

export function setBinding(slug: string, b: StoredBinding | null) {
  const all = Object.fromEntries(Object.entries(getBindings()).filter(([k]) => k !== slug));
  if (b) all[slug] = b;
  try {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(all));
  } catch {
    // storage full or disabled: bindings are a convenience
  }
}

/** The pristine diagram for a slug (example, the imported file or the shared one). */
export function getOriginal(slug: string): DiagramFile | undefined {
  if (slug === IMPORTED_SLUG) return getImported();
  if (slug === SHARED_SLUG) return getShared();
  return examples.find((e) => e.slug === slug)?.diagram;
}

export function getAutosave(slug: string): DiagramFile | undefined {
  return readDiagram(AUTOSAVE_PREFIX + slug);
}

let autosaveWarned = false;

/** Never throws: if storage is full or blocked, edits stay in memory and the user is told once. */
export function writeAutosave(slug: string, d: DiagramFile | null): boolean {
  try {
    if (d) localStorage.setItem(AUTOSAVE_PREFIX + slug, JSON.stringify(d));
    else localStorage.removeItem(AUTOSAVE_PREFIX + slug);
    return true;
  } catch {
    if (!autosaveWarned) {
      autosaveWarned = true;
      notify(
        "This browser can't save your edits (storage is full or blocked). They're kept until you leave: use File → Save or Export to keep them.",
        {
          kind: "error",
          duration: 12_000,
        },
      );
    }
    return false;
  }
}

/** Fired on window when a stored diagram slot changes outside the App (App re-reads its picker). */
export const DIAGRAMS_CHANGED = "diagrams:changed";

/**
 * Starts a new diagram from a partial seed (title, nodes, ...) in the user's diagram slot and
 * returns the slug to open. No reload needed: the App listens for DIAGRAMS_CHANGED. Pair with a
 * client-side navigation, e.g. `openCanvas(createDiagram(seed))` in canvasBridge.
 */
export function createDiagram(seed: Partial<DiagramFile> = {}): string {
  const d: DiagramFile = { ...emptyDiagram(), ...seed, format: DIAGRAM_FORMAT };
  setImported(d);
  window.dispatchEvent(new Event(DIAGRAMS_CHANGED));
  return IMPORTED_SLUG;
}

export const emptyDiagram = (): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "Untitled diagram",
  nodes: [],
  edges: [],
});
