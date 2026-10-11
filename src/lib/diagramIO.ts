import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { examples } from "../examples";
import { LIMITS, parseNative, serializeNative, validateDiagram } from "../interop/native";
import { notify } from "../interop/ui/toast";
import type { FileHandle } from "../interop/files";

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
function readDiagram(key: string, identity?: string): DiagramFile | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > LIMITS.maxTextChars) return undefined;
    const stored: unknown = JSON.parse(raw);
    const envelope = stored as Partial<DocumentSession>;
    const session = envelope?.sessionFormat === SESSION_FORMAT ? envelope : undefined;
    if (identity !== undefined && session?.sessionId !== identity) return undefined;
    const r = validateDiagram(session ? session.diagram : stored);
    return r.ok ? r.diagram : undefined;
  } catch {
    return undefined;
  }
}

/** Validates, then stores. Throws (with a readable message) on invalid input or full storage, so callers never replace a slot with something that can't render. */
function storeSession(key: string, session: DocumentSession) {
  const d = session.diagram;
  const r = validateDiagram(d);
  if (!r.ok) throw new Error(r.error);
  try {
    localStorage.setItem(key, JSON.stringify({ ...session, diagram: r.diagram }));
  } catch {
    throw new Error(
      "The browser's storage for this site is full or blocked, so the diagram couldn't be kept. Export it to keep your work.",
    );
  }
}

export function getImported(): DiagramFile | undefined {
  return readDiagram(IMPORTED_KEY);
}

export function setImported(d: DiagramFile, target?: SaveTarget) {
  replaceDocument(IMPORTED_SLUG, d, target);
}

export function getShared(): DiagramFile | undefined {
  return readDiagram(SHARED_KEY);
}

export function setShared(d: DiagramFile, target?: SaveTarget) {
  replaceDocument(SHARED_SLUG, d, target);
}

export function clearShared() {
  deviceTargets.delete(SHARED_SLUG);
  try {
    localStorage.removeItem(SHARED_KEY);
    localStorage.removeItem(AUTOSAVE_PREFIX + SHARED_SLUG);
  } catch {
    // storage blocked: nothing stored to clear
  }
}

export type SaveTarget = { kind: "device"; handle: FileHandle } | { kind: "drive"; id: string; name: string };
const SESSION_FORMAT = "diagrams/session/v1";
interface DocumentSession {
  sessionFormat: typeof SESSION_FORMAT;
  sessionId: string;
  diagram: DiagramFile;
  drive?: Extract<SaveTarget, { kind: "drive" }>;
}
const deviceTargets = new Map<string, { sessionId: string; target: SaveTarget }>();
const slotKey = (slug: string) =>
  slug === IMPORTED_SLUG ? IMPORTED_KEY : slug === SHARED_SLUG ? SHARED_KEY : undefined;

/** Identity changes only when this document is replaced, never when another slot changes. */
export function getDiagramIdentity(slug: string): string {
  const key = slotKey(slug);
  if (!key) return `example:${slug}`;
  const stored = read<Partial<DocumentSession>>(key);
  // Legacy slots have no binding: old separately stored destinations cannot be trusted.
  return stored?.sessionFormat === SESSION_FORMAT && typeof stored.sessionId === "string"
    ? stored.sessionId
    : `legacy:${key}`;
}

/** One storage write publishes a diagram and its destination together. Handles are identity-bound. */
function replaceDocument(slug: string, diagram: DiagramFile, target?: SaveTarget) {
  const sessionId = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, "0")).join(
    "",
  );
  storeSession(slotKey(slug)!, {
    sessionFormat: SESSION_FORMAT,
    sessionId,
    diagram,
    ...(target?.kind === "drive" ? { drive: target } : {}),
  });
  deviceTargets.delete(slug);
  if (target?.kind === "device") deviceTargets.set(slug, { sessionId, target });
  writeAutosave(slug, null);
}

export function getSaveTarget(slug: string): SaveTarget | undefined {
  const sessionId = getDiagramIdentity(slug);
  const device = deviceTargets.get(slug);
  if (device?.sessionId === sessionId) return device.target;
  const key = slotKey(slug);
  if (key) {
    const stored = read<DocumentSession>(key);
    const target =
      stored?.sessionFormat === SESSION_FORMAT && stored.sessionId === sessionId ? stored.drive : undefined;
    return target?.kind === "drive" && typeof target.id === "string" && typeof target.name === "string"
      ? target
      : undefined;
  }
  const stored = read<Record<string, { sessionId: string; target: SaveTarget }>>(BINDINGS_KEY)?.[slug];
  return stored?.sessionId === sessionId ? stored.target : undefined;
}

/** A completed asynchronous save may bind only the document that initiated it. */
export function bindSaveTarget(slug: string, target: SaveTarget, expectedIdentity: string): boolean {
  if (getDiagramIdentity(slug) !== expectedIdentity) return false;
  const key = slotKey(slug);
  if (key) {
    const stored = read<DocumentSession>(key);
    const diagram = stored?.sessionFormat === SESSION_FORMAT ? stored.diagram : getOriginal(slug);
    if (!diagram) return false;
    const session: DocumentSession =
      stored?.sessionFormat === SESSION_FORMAT
        ? stored
        : { sessionFormat: SESSION_FORMAT, sessionId: expectedIdentity, diagram };
    const rest = { ...session };
    delete rest.drive;
    storeSession(key, { ...rest, ...(target.kind === "drive" ? { drive: target } : {}) });
  } else {
    const all = Object.fromEntries(
      Object.entries(read<Record<string, { sessionId: string; target: SaveTarget }>>(BINDINGS_KEY) ?? {}).filter(
        ([key]) => key !== slug,
      ),
    );
    if (target.kind === "drive") all[slug] = { sessionId: expectedIdentity, target };
    try {
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(all));
    } catch {
      /* optional for examples */
    }
  }
  deviceTargets.delete(slug);
  if (target.kind === "device") deviceTargets.set(slug, { sessionId: expectedIdentity, target });
  return true;
}

/** The pristine diagram for a slug (example, the imported file or the shared one). */
export function getOriginal(slug: string): DiagramFile | undefined {
  if (slug === IMPORTED_SLUG) return getImported();
  if (slug === SHARED_SLUG) return getShared();
  return examples.find((e) => e.slug === slug)?.diagram;
}

export function getAutosave(slug: string): DiagramFile | undefined {
  const raw = read<Partial<DocumentSession>>(AUTOSAVE_PREFIX + slug);
  // Existing example autosaves predate sessions and remain valid.
  return readDiagram(
    AUTOSAVE_PREFIX + slug,
    raw?.sessionId === undefined && (!slotKey(slug) || getDiagramIdentity(slug).startsWith("legacy:"))
      ? undefined
      : getDiagramIdentity(slug),
  );
}

let autosaveWarned = false;

/** Never throws: if storage is full or blocked, edits stay in memory and the user is told once. */
export function writeAutosave(slug: string, d: DiagramFile | null): boolean {
  try {
    if (d)
      localStorage.setItem(
        AUTOSAVE_PREFIX + slug,
        JSON.stringify(
          slotKey(slug) ? { sessionFormat: SESSION_FORMAT, sessionId: getDiagramIdentity(slug), diagram: d } : d,
        ),
      );
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
