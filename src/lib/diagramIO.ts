import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { examples, getLoadedExample } from "../examples";
import { RETIRED_EXAMPLES } from "../examples/retired";
import { parseNative, preserveUnknown, validateDiagram } from "../interop/native";
import { notify } from "../interop/ui/toast";
import { safeStorage } from "./storage";
import { diagramThumb, isThumb, type Thumb } from "./thumbnail";
import { isLocalOnly, privacyOf } from "./localOnly";
import { newDiagramsPrivate } from "./privacyPrefs";
import { AI_THREAD_PREFIX } from "./aiThreadKey";
import { exampleIdentity, readConversation, withoutConversationSnapshots } from "./exampleConversations";

// Where diagrams live in the browser.
//
// - "Your diagrams" is a small local library. Each entry is one document with its own storage key,
//   its own save destination (`{ providerId, ref }`: a device file handle or a file in a storage
//   provider, bound atomically to the document's session id) and its own autosave. A tiny index (title, times, node count, thumbnail) lists them
//   without reading every document.
// - A blank "new" diagram (DRAFT_SLUG) is not stored at all until its first edit, when it becomes a
//   library entry in place: the entry takes the draft's identity, so the open canvas doesn't remount.
// - A diagram opened from a share link lives in its own slot (SHARED_SLUG) until "Save a copy".
// - Examples are built in; the canvas keeps the first edit in a new library copy.
//
// Every read and write goes through safe storage: blocked or full storage never throws into the UI.

/** A blank, unsaved diagram. It becomes a library entry on its first edit. */
export const DRAFT_SLUG = "new";
/** Diagrams opened from a share link live here, so they never overwrite the user's own work. */
export const SHARED_SLUG = "shared";
/** The single "Your diagram" slot from before the library. Kept in place as a library entry. */
export const LEGACY_SLUG = "imported";
const LIBRARY_SLUG_PREFIX = "my-";

const AUTOSAVE_PREFIX = "diagrams.autosave.v1:";
const LEGACY_KEY = "diagrams.imported.v1";
const SHARED_KEY = "diagrams.shared.v1";
export const LIBRARY_KEY = "diagrams.library.v1";
// Each diagram owns one index record. Publishing it is a single atomic storage write;
// tabs never overwrite a shared snapshot containing other diagrams' entries.
const ENTRY_PREFIX = "diagrams.library-entry.v1:";
const entryKey = (slug: string) => ENTRY_PREFIX + slug;
// A separate deletion marker wins over a metadata write already in flight in another tab.
// Only Undo clears it, after restoring the backing content and index record.
const DELETED_PREFIX = "diagrams.library-deleted.v1:";
const deletedKey = (slug: string) => DELETED_PREFIX + slug;
const isDeleted = (slug: string) => safeStorage.getItem(deletedKey(slug)) !== null;
const DOC_PREFIX = "diagrams.doc.v1:";
const LIBRARY_FORMAT = "diagrams/library/v1";
export const UNTITLED = "Untitled diagram";

/** Roughly what browsers give a site (5M UTF-16 characters in Chrome, Firefox and Safari). */
export const STORAGE_BUDGET = 5_000_000;
/** Above this share of the budget the user is warned (once per session) and the library shows a meter. */
export const NEARLY_FULL = 0.8;

export type ParseResult = { ok: true; diagram: DiagramFile; warnings?: string[] } | { ok: false; error: string };

/** Validates an imported diagrams/v1 file (see src/interop/native.ts for the rules). */
export function parseDiagram(text: string): ParseResult {
  return parseNative(text);
}

function read<T>(key: string): T | undefined {
  try {
    const raw = safeStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Stored diagrams pass the same validator as imports; anything else reads as missing. */
function readDiagram(key: string, identity?: string): DiagramFile | undefined {
  try {
    const raw = safeStorage.getItem(key);
    // Import size limits do not apply to documents already saved on this device.
    if (!raw) return undefined;
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

const STORAGE_FULL =
  "The browser's storage for this site is full or blocked, so the diagram couldn't be kept. Delete diagrams you don't need (File → Your diagrams…) or export this one to keep it.";

/** Validates, then stores. Throws (with a readable message) on invalid input or full storage, so callers never replace a slot with something that can't render. */
function storeSession(key: string, session: DocumentSession) {
  const d = session.diagram;
  const r = validateDiagram(d);
  if (!r.ok) throw new Error(r.error);
  if (!safeStorage.setItem(key, JSON.stringify({ ...session, diagram: r.diagram }))) throw new Error(STORAGE_FULL);
}

export function getShared(): DiagramFile | undefined {
  return readDiagram(SHARED_KEY);
}

export function setShared(d: DiagramFile, target?: SaveTarget) {
  replaceDocument(SHARED_SLUG, d, target);
  changed();
}

export function clearShared() {
  memoryTargets.delete(SHARED_SLUG);
  safeStorage.removeItem(AI_THREAD_PREFIX + getDiagramIdentity(SHARED_SLUG));
  safeStorage.removeItem(SHARED_KEY);
  safeStorage.removeItem(AUTOSAVE_PREFIX + SHARED_SLUG);
  changed();
}

/**
 * Where Save writes a document: a storage provider (src/interop/storage) and that provider's
 * reference to the file. A device file handle can't be serialized, so device destinations live in
 * memory only (the browser asks for the file again after a reload). Every other provider's `ref` is
 * plain JSON, stored in the same write as the document it belongs to.
 */
export interface SaveTarget {
  providerId: string;
  ref: unknown;
  /** The file's name, as the provider reported it. */
  name: string;
  /** When Save last wrote it (ms). Missing for a file that was only opened. */
  savedAt?: number;
}
/** The device provider's id. Its refs are file handles, so they never touch storage. */
export const DEVICE_PROVIDER = "device";
const inMemoryOnly = (t: SaveTarget) => t.providerId === DEVICE_PROVIDER;

const SESSION_FORMAT = "diagrams/session/v1";
interface DocumentSession {
  sessionFormat: typeof SESSION_FORMAT;
  sessionId: string;
  diagram: DiagramFile;
  target?: SaveTarget;
  /** Before storage providers: a Google Drive destination. Still read, never written. */
  drive?: { kind: "drive"; id: string; name: string };
}
const memoryTargets = new Map<string, { sessionId: string; target: SaveTarget }>();

/** A stored destination (or a legacy Google Drive one), checked field by field. */
function storedTarget(raw: unknown): SaveTarget | undefined {
  const t = raw as Partial<SaveTarget & { kind: string; id: string }> | null | undefined;
  if (!t || typeof t !== "object") return undefined;
  if (t.kind === "drive")
    return typeof t.id === "string" && typeof t.name === "string"
      ? { providerId: "gdrive", ref: { id: t.id }, name: t.name }
      : undefined;
  if (typeof t.providerId !== "string" || t.providerId === DEVICE_PROVIDER || typeof t.name !== "string")
    return undefined;
  if (t.ref === undefined || t.ref === null) return undefined;
  return {
    providerId: t.providerId,
    ref: t.ref,
    name: t.name,
    ...(typeof t.savedAt === "number" && Number.isFinite(t.savedAt) ? { savedAt: t.savedAt } : {}),
  };
}

/** A library entry's slug: the legacy slot, or `my-<id>`. */
export const isLibrarySlug = (slug: string) =>
  slug === LEGACY_SLUG || (slug.startsWith(LIBRARY_SLUG_PREFIX) && /^[a-z0-9]{6,32}$/.test(slug.slice(3)));
/** The user's own documents (named after their title on export), as opposed to examples. */
export const isOwnSlug = (slug: string) => isLibrarySlug(slug) || slug === SHARED_SLUG || slug === DRAFT_SLUG;

const slotKey = (slug: string) =>
  slug === SHARED_SLUG
    ? SHARED_KEY
    : slug === LEGACY_SLUG
      ? LEGACY_KEY
      : isLibrarySlug(slug)
        ? DOC_PREFIX + slug.slice(LIBRARY_SLUG_PREFIX.length)
        : undefined;

const randomHex = (words: number) =>
  Array.from(crypto.getRandomValues(new Uint32Array(words)), (n) => n.toString(16).padStart(8, "0")).join("");

// ---------------------------------------------------------------- the draft ("new")

let draftToken = randomHex(2);
let promoted: { token: string; slug: string } | null = null;
const draftIdentity = () => `draft:${draftToken}`;
/** The blank draft's Private switch (and on-device permission) until its first edit makes it an entry. */
let draftPrivacy: PrivacyFlags = newDiagramsPrivate.get() ? { private: true } : {};

/** A fresh blank draft (File > New diagram): the next visit to DRAFT_SLUG starts empty. */
export function newDraft(): void {
  draftToken = randomHex(2);
  draftPrivacy = newDiagramsPrivate.get() ? { private: true } : {};
}

/** The draft's first edit turned it into this library entry; links to "new" follow it until the next New diagram. */
export function resolveSlug(slug: string): string {
  return slug === DRAFT_SLUG && promoted?.token === draftToken ? promoted.slug : slug;
}

/** Turns the current draft into a (blank) library entry that keeps the draft's identity. */
function promoteDraft(identity: string): string | undefined {
  const routed = resolveSlug(DRAFT_SLUG);
  if (routed !== DRAFT_SLUG) return identity === draftIdentity() ? routed : undefined;
  if (identity !== draftIdentity()) return undefined;
  const slug = createLibraryDiagram(emptyDiagram(), undefined, identity, draftPrivacy);
  promoted = { token: draftToken, slug };
  return slug;
}

// ---------------------------------------------------------------- identity and save destinations

// Only pending Save operations follow a promotion, once. There is no shared identity redirect.
const exampleCopyListeners = new Set<(source: string, copy: string) => void>();
const exampleSaveSessions = new Map<string, number>();

/** A pending save follows its initiating document into its first copy, even after navigation. */
export function trackDocumentSession(source: string) {
  let slug = source;
  let identity = getDiagramIdentity(source);
  const generation = exampleSaveSessions.get(source);
  const onCopy = (from: string, copy: string) => {
    if (from !== source || exampleSaveSessions.get(source) !== generation) return;
    slug = copy;
    identity = getDiagramIdentity(copy);
    dispose();
  };
  const dispose = () => {
    exampleCopyListeners.delete(onCopy);
  };
  if (examples.some((e) => e.slug === source)) exampleCopyListeners.add(onCopy);
  return {
    resolve: () => {
      if (slug === source && exampleSaveSessions.get(source) !== generation) return undefined;
      const owner = resolveDocumentSession(slug, identity);
      return owner ? { slug: owner, identity } : undefined;
    },
    dispose,
  };
}

/** Identity changes only when this document is replaced, never when another slot changes. */
export function getDiagramIdentity(slug: string): string {
  if (slug === DRAFT_SLUG) return draftIdentity();
  const key = slotKey(slug);
  if (!key) return exampleIdentity(slug);
  const stored = read<Partial<DocumentSession>>(key);
  // Legacy slots have no binding: old separately stored destinations cannot be trusted.
  return stored?.sessionFormat === SESSION_FORMAT && typeof stored.sessionId === "string"
    ? stored.sessionId
    : `legacy:${key}`;
}

/**
 * One storage write publishes a diagram and its destination together. Handles are identity-bound. The document it
 * replaces goes with its AI conversation (keyed by its session id), which nothing could show again.
 */
function replaceDocument(slug: string, diagram: DiagramFile, target?: SaveTarget, sessionId = randomHex(4)) {
  const replaced = getDiagramIdentity(slug);
  storeSession(slotKey(slug)!, {
    sessionFormat: SESSION_FORMAT,
    sessionId,
    diagram,
    ...(target && !inMemoryOnly(target) ? { target } : {}),
  });
  memoryTargets.delete(slug);
  if (target && inMemoryOnly(target)) memoryTargets.set(slug, { sessionId, target });
  // If this removal fails, the stale autosave still can't show: it carries the old session id.
  safeStorage.removeItem(AUTOSAVE_PREFIX + slug);
  if (replaced !== sessionId) safeStorage.removeItem(AI_THREAD_PREFIX + replaced);
}

/** Destinations for examples live only for their initiating mounted canvas. */
export function releaseExampleSaveTarget(slug: string): void {
  if (examples.some((example) => example.slug === slug)) {
    memoryTargets.delete(slug);
    exampleSaveSessions.set(slug, (exampleSaveSessions.get(slug) ?? 0) + 1);
  }
}

export function getSaveTarget(slug: string): SaveTarget | undefined {
  const sessionId = getDiagramIdentity(slug);
  const memory = memoryTargets.get(slug);
  if (memory?.sessionId === sessionId) return memory.target;
  const key = slotKey(slug);
  if (key) {
    const stored = read<DocumentSession>(key);
    return stored?.sessionFormat === SESSION_FORMAT && stored.sessionId === sessionId
      ? storedTarget(stored.target ?? stored.drive)
      : undefined;
  }
  return undefined;
}

/** Resolve an initiating session once for both asynchronous privacy checks and destination binding. */
export function resolveDocumentSession(slug: string, identity: string): string | undefined {
  const resolved = resolveSlug(slug);
  return getDiagramIdentity(resolved) === identity ? resolved : undefined;
}

/** A completed asynchronous save may bind only the document that initiated it. */
export function bindSaveTarget(slug: string, target: SaveTarget, expectedIdentity: string): boolean {
  const resolved = resolveDocumentSession(slug, expectedIdentity);
  if (!resolved) return false;
  slug = resolved;
  if (slug === DRAFT_SLUG) {
    // Saving a blank draft keeps it: it becomes a library entry, and the destination binds to that.
    let entry: string | undefined;
    try {
      entry = promoteDraft(expectedIdentity);
    } catch {
      return false;
    }
    return entry ? bindSaveTarget(entry, target, expectedIdentity) : false;
  }
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
    delete rest.target;
    storeSession(key, { ...rest, ...(inMemoryOnly(target) ? {} : { target }) });
  }
  memoryTargets.delete(slug);
  // Example bindings also belong to this mounted session: another tab may bind its own destination.
  if (inMemoryOnly(target) || !slotKey(slug)) memoryTargets.set(slug, { sessionId: expectedIdentity, target });
  return true;
}

// ---------------------------------------------------------------- reading documents

/** The pristine diagram for a slug. Public examples must be loaded before this synchronous read. */
export function getOriginal(slug: string): DiagramFile | undefined {
  if (slug === DRAFT_SLUG) return emptyDiagram();
  const key = slotKey(slug);
  if (key) return readDiagram(key);
  return getLoadedExample(slug);
}

export function getAutosave(slug: string): DiagramFile | undefined {
  if (slug === DRAFT_SLUG) return undefined;
  // Example autosaves are legacy input, read as-is without re-keying or deleting them.
  if (!slotKey(slug)) return readDiagram(AUTOSAVE_PREFIX + slug);
  const raw = read<Partial<DocumentSession>>(AUTOSAVE_PREFIX + slug);
  // Existing example autosaves predate sessions and remain valid.
  return readDiagram(
    AUTOSAVE_PREFIX + slug,
    raw?.sessionId === undefined && (!slotKey(slug) || getDiagramIdentity(slug).startsWith("legacy:"))
      ? undefined
      : getDiagramIdentity(slug),
  );
}

/** What the user last saw: the autosaved edits (with the original's extension fields), else the original. */
export function getCurrent(slug: string): DiagramFile | undefined {
  const original = getOriginal(slug);
  const edits = getAutosave(slug);
  return edits ? preserveUnknown(edits, original) : original;
}

let autosaveWarned = false;

/**
 * Never throws: if storage is full or blocked, edits stay in memory and the user is told once.
 * `identity` (the document the caller loaded) guards late writes: a canvas flushing on unmount
 * can't write its edits over a document that replaced it.
 */
export function writeAutosave(
  slug: string,
  d: DiagramFile | null,
  identity?: string,
  /** The caller reports a failure itself (a room's "Your copy couldn't be saved"): no storage toast. */
  opts: { quiet?: boolean } = {},
): boolean {
  if (slug === DRAFT_SLUG) {
    // Nothing to keep until the first edit; then the draft becomes a library entry in place.
    if (!d) return true;
    let entry: string | undefined;
    try {
      entry = promoteDraft(identity ?? draftIdentity());
    } catch {
      warnAutosave();
      return false;
    }
    if (!entry) return false;
    slug = entry;
  }
  if (identity !== undefined && getDiagramIdentity(slug) !== identity) return false;
  if (isLibrarySlug(slug) && isDeleted(slug)) return false;
  const key = AUTOSAVE_PREFIX + slug;
  const ok = d
    ? safeStorage.setItem(
        key,
        JSON.stringify(
          slotKey(slug) ? { sessionFormat: SESSION_FORMAT, sessionId: getDiagramIdentity(slug), diagram: d } : d,
        ),
      )
    : safeStorage.removeItem(key);
  if (!ok) {
    if (!opts.quiet) warnAutosave();
    return false;
  }
  if (isLibrarySlug(slug)) touchEntry(slug, d ?? getOriginal(slug));
  return true;
}

function warnAutosave() {
  if (autosaveWarned) return;
  autosaveWarned = true;
  notify(
    "This browser can't save your edits (storage is full or blocked). They're kept until you leave: use File → Save or Export to keep them, or delete diagrams you don't need (File → Your diagrams…).",
    { kind: "error", duration: 12_000 },
  );
}

// ---------------------------------------------------------------- the library index

interface StoredEntry {
  slug: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodes: number;
  thumb?: Thumb;
  /** Sticky provenance, kept in the library index and never in exported diagram JSON. */
  localOnly?: boolean;
  /** The Private switch. Exports carry it as the file's `"private": true`; copies and pastes inherit it. */
  private?: boolean;
  /** This private diagram may use the on-device model. */
  onDevice?: boolean;
}

/** A diagram's privacy provenance, as kept in its library entry (see src/lib/localOnly.ts). */
export type PrivacyFlags = Pick<StoredEntry, "localOnly" | "private" | "onDevice">;

export interface LibraryEntry extends StoredEntry {
  thumb: Thumb;
}

/** Fired on window when the library or a stored slot changes (the App re-reads its picker). */
export const DIAGRAMS_CHANGED = "diagrams:changed";
/** Fired on window to open the "Your diagrams" dialog (e.g. from the storage warning toast). */
export const OPEN_LIBRARY = "diagrams:open-library";

function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DIAGRAMS_CHANGED));
}

// useLibrary subscribes to DIAGRAMS_CHANGED. Bridge per-entry storage events in other tabs.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith(ENTRY_PREFIX) || event.key?.startsWith(DELETED_PREFIX)) changed();
  });
}

const isBlank = (d: DiagramFile) =>
  !d.nodes.length &&
  !d.edges.length &&
  !d.groups?.length &&
  !d.simulations?.length &&
  !d.description &&
  (d.title || UNTITLED) === UNTITLED;

const summarize = (
  slug: string,
  d: DiagramFile,
  at: number,
  createdAt = at,
  flags: PrivacyFlags = {},
): StoredEntry => ({
  slug,
  title: d.title.trim() || UNTITLED,
  createdAt,
  updatedAt: at,
  nodes: d.nodes.length,
  thumb: diagramThumb(d),
  ...(privacyOf({ localOnly: flags.localOnly, diagram: d }) === "local-only" ? { localOnly: true } : {}),
  ...(flags.private ? { private: true } : {}),
  ...(flags.private && flags.onDevice ? { onDevice: true } : {}),
});
const flagsOf = (e: StoredEntry | undefined): PrivacyFlags =>
  e ? { localOnly: e.localOnly, private: e.private, onDevice: e.onDevice } : {};

function validEntry(v: unknown): v is StoredEntry {
  const e = v as Partial<StoredEntry> | null;
  return (
    !!e &&
    typeof e.slug === "string" &&
    isLibrarySlug(e.slug) &&
    typeof e.title === "string" &&
    typeof e.createdAt === "number" &&
    typeof e.updatedAt === "number" &&
    typeof e.nodes === "number"
  );
}

/** The single slot from before the library, as an entry (unless it's an untouched blank). */
function legacyEntry(): StoredEntry | undefined {
  const original = readDiagram(LEGACY_KEY);
  const current = getAutosave(LEGACY_SLUG) ?? original;
  if (!current || isBlank(current)) return undefined;
  return summarize(LEGACY_SLUG, current, Date.now());
}

function readLegacyIndex(): StoredEntry[] {
  const raw = safeStorage.getItem(LIBRARY_KEY);
  // No index yet: the library is whatever the single legacy slot held (persisted by migrateLegacySlot).
  if (raw === null) return [legacyEntry()].filter((e): e is StoredEntry => !!e);
  try {
    const parsed = JSON.parse(raw) as { format?: string; entries?: unknown };
    if (parsed?.format !== LIBRARY_FORMAT || !Array.isArray(parsed.entries)) return [];
    const seen = new Set<string>();
    return parsed.entries.filter((e): e is StoredEntry => validEntry(e) && !seen.has(e.slug) && !!seen.add(e.slug));
  } catch {
    return [];
  }
}

function readIndex(): StoredEntry[] {
  const entries = new Map(readLegacyIndex().map((e) => [e.slug, e]));
  for (const key of safeStorage.keys()) {
    if (!key.startsWith(ENTRY_PREFIX)) continue;
    const slug = key.slice(ENTRY_PREFIX.length);
    const record = read<unknown>(key);
    if (validEntry(record) && record.slug === slug) entries.set(slug, record);
    else if ((record as { deleted?: unknown } | null)?.deleted === true) entries.delete(slug);
  }
  return [...entries.values()].filter((entry) => !isDeleted(entry.slug));
}

/**
 * The all-in-one index from before per-entry records (written once, by migrateLegacySlot) holds every diagram's title
 * and thumbnail as they were then. A delete retires it: each row listed only there gets its own record (never a deleted
 * diagram's), then the index is written empty. Every tab writes the same empty index, so two tabs retiring it at once
 * can't bring a row back (rewriting a filtered copy could: the later write restores what the earlier one removed).
 */
function retireLegacyIndex(): void {
  if (!safeStorage.getItem(LIBRARY_KEY)) return;
  const rows = readLegacyIndex();
  if (!rows.length) return;
  for (const e of rows) {
    if (isDeleted(e.slug) || safeStorage.getItem(entryKey(e.slug)) !== null) continue;
    writeEntry(e);
    // Deleted in another tab meanwhile (its marker is written first): take the record back out.
    if (isDeleted(e.slug)) safeStorage.removeItem(entryKey(e.slug));
  }
  writeIndex([]);
}

/** Publish only this diagram's entry, without a cross-tab read/modify/write race. */
function writeEntry(entry: StoredEntry): boolean {
  return safeStorage.setItem(entryKey(entry.slug), JSON.stringify(entry));
}

/** Required writes publish together to subscribers; restore completed writes on failure. */
function commitWrites(writes: [string, string | null, string?][]): void {
  const completed: [string, string | null][] = [];
  for (const [key, value, fallback] of writes) {
    const previous = safeStorage.getItem(key);
    const ok = value === null ? safeStorage.removeItem(key) : safeStorage.setItem(key, value);
    if (!ok && !(fallback !== undefined && safeStorage.setItem(key, fallback))) {
      for (const [written, old] of completed.reverse()) {
        if (old === null) safeStorage.removeItem(written);
        else safeStorage.setItem(written, old);
      }
      throw new Error(STORAGE_FULL);
    }
    completed.push([key, previous]);
  }
}

function writeIndex(entries: StoredEntry[]): boolean {
  return safeStorage.setItem(LIBRARY_KEY, JSON.stringify({ format: LIBRARY_FORMAT, entries }));
}

/** Upgrades the single "Your diagram" slot into the library (in place, no copying). Idempotent; best effort. */
export function migrateLegacySlot(): void {
  if (safeStorage.getItem(LIBRARY_KEY) !== null) return;
  // First-run canvases in the old app wrote only an autosave. Keep its legacy identity.
  const legacy = getAutosave(LEGACY_SLUG);
  if (!getOriginal(LEGACY_SLUG) && legacy && !isBlank(legacy)) {
    if (!safeStorage.setItem(LEGACY_KEY, JSON.stringify(legacy))) return;
  }
  writeIndex(readIndex());
}

/** Your diagrams, most recently edited first. */
export function listLibrary(): LibraryEntry[] {
  return readIndex()
    .map((e) => ({ ...e, thumb: isThumb(e.thumb) ? e.thumb : diagramThumb({ nodes: [], edges: [] }) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function hasLibraryEntry(slug: string): boolean {
  return readIndex().some((e) => e.slug === slug);
}

/**
 * A document's privacy provenance: a local-only example, its library entry's flags, the blank draft's
 * switch, or a shared diagram whose file says `"private": true`. Content is checked by privacyOf.
 */
export function getPrivacyFlags(slug: string): PrivacyFlags {
  const resolved = resolveSlug(slug);
  if (resolved === DRAFT_SLUG) return { ...draftPrivacy };
  if (examples.some((e) => e.slug === resolved && e.localOnly)) return { localOnly: true };
  if (resolved === SHARED_SLUG) return getShared()?.private === true ? { private: true } : {};
  if (!isLibrarySlug(resolved) || isDeleted(resolved)) return {};
  // Cheap: the entry's own record (asked by every menu, gate and render), the whole index only for an
  // entry that predates per-entry records.
  const own = read<unknown>(entryKey(resolved));
  if (validEntry(own) && own.slug === resolved) return flagsOf(own);
  return flagsOf(readIndex().find((e) => e.slug === resolved));
}

/** Resolve draft promotion as well as example/library provenance. Content is checked by isLocalOnly. */
export function isLocalOnlySource(slug: string, diagram?: DiagramFile): boolean {
  return isLocalOnly({ ...getPrivacyFlags(slug), diagram });
}

/**
 * The Private switch for one of your diagrams (or the blank draft). Turning it off also withdraws the
 * on-device permission. Returns false where there's no switch: examples and shared diagrams (make a
 * private copy instead). Local-only provenance stays whatever the switch says.
 */
export function setDiagramPrivate(slug: string, on: boolean): boolean {
  const resolved = resolveSlug(slug);
  if (resolved === DRAFT_SLUG) {
    draftPrivacy = on ? { ...draftPrivacy, private: true } : { localOnly: draftPrivacy.localOnly };
    changed();
    return true;
  }
  return updateFlags(resolved, (f) => (on ? { ...f, private: true } : { localOnly: f.localOnly }));
}

/** "Allow the on-device model" for a private diagram. */
export function setOnDeviceAllowed(slug: string, on: boolean): boolean {
  const resolved = resolveSlug(slug);
  if (resolved === DRAFT_SLUG) {
    if (!draftPrivacy.private) return false;
    draftPrivacy = { ...draftPrivacy, onDevice: on };
    changed();
    return true;
  }
  return updateFlags(resolved, (f) => (f.private ? { ...f, onDevice: on } : f));
}

function updateFlags(slug: string, next: (f: PrivacyFlags) => PrivacyFlags): boolean {
  if (!isLibrarySlug(slug) || isDeleted(slug)) return false;
  const entry = readIndex().find((e) => e.slug === slug);
  const current = getCurrent(slug);
  if (!entry || !current) return false;
  const updated = summarize(slug, current, entry.updatedAt, entry.createdAt, next(flagsOf(entry)));
  if (!writeEntry(updated)) throw new Error(STORAGE_FULL);
  changed();
  return true;
}

/** A file leaving this device says whether it's private (`"private": true`), so a re-import stays private. */
export function withPrivacyField(d: DiagramFile, isPrivate: boolean): DiagramFile {
  const rest = { ...d };
  delete rest.private;
  return isPrivate ? { ...rest, private: true } : rest;
}

/** Keeps an entry's title, node count, thumbnail and time in step with its latest content. Best effort. */
function touchEntry(slug: string, d: DiagramFile | undefined) {
  if (!d || isDeleted(slug)) return;
  const entries = readIndex();
  const i = entries.findIndex((e) => e.slug === slug);
  const now = Date.now();
  const next = summarize(slug, d, now, i >= 0 ? entries[i].createdAt : now, flagsOf(entries[i]));
  // A missing entry is re-listed only while its document exists (never a deleted one).
  if (i < 0 && safeStorage.getItem(slotKey(slug)!) === null) return;
  if (writeEntry(next)) changed();
}

/**
 * Adds a diagram to Your diagrams and returns its slug. Throws a readable error when the diagram is
 * invalid or storage is full (nothing is left half-written). `target` binds where Save writes.
 */
export function createLibraryDiagram(
  input: DiagramFile,
  target?: SaveTarget,
  sessionId?: string,
  provenance: PrivacyFlags & { sourceSlug?: string } = {},
): string {
  return createLibraryEntry(input, target, sessionId, provenance);
}

/**
 * The library entry's privacy for a new document: a file's `"private": true` becomes the entry's switch, and copies
 * inherit their source's privacy (a local-only example's provenance, or the Private switch). Shared by creation and by
 * the retired-edits repair, which republishes an entry for an already stored document.
 */
function entryFlags(input: DiagramFile, provenance: PrivacyFlags & { sourceSlug?: string } = {}): PrivacyFlags {
  const d = withPrivacyField(input, false);
  const source = provenance.sourceSlug !== undefined ? getPrivacyFlags(provenance.sourceSlug) : {};
  return {
    localOnly:
      provenance.localOnly ||
      (provenance.sourceSlug !== undefined && privacyOf({ localOnly: source.localOnly, diagram: d }) === "local-only"),
    private: provenance.private || source.private || input.private === true,
    onDevice: provenance.onDevice || source.onDevice,
  };
}

function createLibraryEntry(
  input: DiagramFile,
  target: SaveTarget | undefined,
  sessionId: string = randomHex(4),
  provenance: PrivacyFlags & { sourceSlug?: string } = {},
  promotion?: { conversation: string | null; beforePublish: (slug: string) => void },
  fixedSlug?: string,
): string {
  const entries = readIndex();
  let slug = fixedSlug ?? "";
  if (!fixedSlug)
    do slug = LIBRARY_SLUG_PREFIX + randomHex(2).slice(0, 12);
    while (entries.some((e) => e.slug === slug));
  // A file's `"private": true` becomes the entry's switch; the stored document never carries it.
  const d = withPrivacyField(input, false);
  const flags = entryFlags(input, provenance);
  const r = validateDiagram(d);
  if (!r.ok) throw new Error(r.error);
  const session: DocumentSession = {
    sessionFormat: SESSION_FORMAT,
    sessionId,
    diagram: r.diagram,
    ...(target && !inMemoryOnly(target) ? { target } : {}),
  };
  commitWrites([
    [slotKey(slug)!, JSON.stringify(session)],
    ...(promotion?.conversation
      ? [
          [
            AI_THREAD_PREFIX + sessionId,
            promotion.conversation,
            withoutConversationSnapshots(promotion.conversation),
          ] as [string, string, string],
        ]
      : []),
    [entryKey(slug), JSON.stringify(summarize(slug, r.diagram, Date.now(), undefined, flags))],
  ]);
  if (target && inMemoryOnly(target)) memoryTargets.set(slug, { sessionId, target });
  promotion?.beforePublish(slug);
  changed();
  warnIfNearlyFull();
  return slug;
}

/** "Copy of" naming that doesn't pile up: "Orders (copy)", then "Orders (copy 2)". */
export function copyTitle(title: string, taken: string[] = []): string {
  const base = title.replace(/ \(copy(?: \d+)?\)$/, "") || UNTITLED;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Keep the edited canvas and its undo history; reopening the example gets a fresh canvas. */
export function copyEditedExample(
  slug: string,
  edited: DiagramFile,
  identity: string,
): { slug: string; title: string } | undefined {
  if (!examples.some((e) => e.slug === slug) || getDiagramIdentity(slug) !== identity) return undefined;
  const source = getOriginal(slug);
  // An explicit name belongs to the person; don't append text beneath their typing cursor.
  const title =
    edited.title !== source?.title
      ? edited.title.trim()
        ? edited.title
        : UNTITLED
      : copyTitle(
          edited.title,
          readIndex().map((e) => e.title),
        );
  const copy = createLibraryEntry(
    { ...preserveUnknown(edited, source), title },
    getSaveTarget(slug),
    undefined,
    { sourceSlug: slug, private: newDiagramsPrivate.get() },
    {
      conversation: readConversation(identity),
      beforePublish: (copy) => {
        for (const listener of exampleCopyListeners) listener(slug, copy);
      },
    },
  );
  releaseExampleSaveTarget(slug);
  return { slug: copy, title };
}

/** Duplicates an entry (its latest content, extension fields included) and returns the copy's slug. */
export function duplicateLibraryDiagram(slug: string): string {
  const current = getCurrent(slug);
  if (!current) throw new Error("That diagram couldn't be read.");
  const taken = readIndex().map((e) => e.title);
  return createLibraryDiagram({ ...current, title: copyTitle(current.title, taken) }, undefined, undefined, {
    sourceSlug: slug,
  });
}

/** Renames an entry that isn't open (an open diagram is renamed through its canvas, as an undoable edit). */
export function renameLibraryDiagram(slug: string, title: string): void {
  const key = slotKey(slug);
  const next = title.trim() || UNTITLED;
  const stored = key ? read<Partial<DocumentSession>>(key) : undefined;
  const original = getOriginal(slug);
  if (!key || !original) throw new Error("That diagram couldn't be read.");
  const edits = getAutosave(slug);
  const renamed = { ...original, title: next };
  const current = { ...(edits ?? original), title: next };
  const entry = readIndex().find((e) => e.slug === slug);
  const writes: [string, string][] = [
    [key, JSON.stringify(stored?.sessionFormat === SESSION_FORMAT ? { ...stored, diagram: renamed } : renamed)],
  ];
  if (edits)
    writes.push([
      AUTOSAVE_PREFIX + slug,
      JSON.stringify(
        getDiagramIdentity(slug).startsWith("legacy:")
          ? current
          : {
              sessionFormat: SESSION_FORMAT,
              sessionId: getDiagramIdentity(slug),
              diagram: current,
            },
      ),
    ]);
  writes.push([entryKey(slug), JSON.stringify(summarize(slug, current, Date.now(), entry?.createdAt, flagsOf(entry)))]);
  commitWrites(writes);
  changed();
}

/** Deletes an entry and returns an Undo that puts it back exactly (document, edits, destination). */
export function deleteLibraryDiagram(slug: string): () => boolean {
  const key = slotKey(slug);
  if (!key) throw new Error("Only your own diagrams can be deleted.");
  const doc = safeStorage.getItem(key);
  const autosave = safeStorage.getItem(AUTOSAVE_PREFIX + slug);
  const entries = readIndex();
  const indexed = entries.find((e) => e.slug === slug);
  const current = getCurrent(slug);
  const entry =
    indexed && current ? summarize(slug, current, Date.now(), indexed.createdAt, flagsOf(indexed)) : indexed;
  const memory = memoryTargets.get(slug);
  // Its AI conversation goes with it (it holds the diagram's words and copies of it); Undo puts it back.
  const threadKey = AI_THREAD_PREFIX + getDiagramIdentity(slug);
  const thread = safeStorage.getItem(threadKey);
  // The index goes first: if it can't be written, nothing is deleted.
  if (!safeStorage.setItem(deletedKey(slug), JSON.stringify({ slug, deleted: true }))) throw new Error(STORAGE_FULL);
  safeStorage.removeItem(key);
  safeStorage.removeItem(AUTOSAVE_PREFIX + slug);
  safeStorage.removeItem(entryKey(slug));
  safeStorage.removeItem(threadKey);
  retireLegacyIndex();
  memoryTargets.delete(slug);
  changed();
  return () => {
    try {
      const writes: [string, string | null][] = [];
      if (doc !== null) writes.push([key, doc]);
      if (autosave !== null) writes.push([AUTOSAVE_PREFIX + slug, autosave]);
      if (thread !== null) writes.push([threadKey, thread]);
      if (entry) writes.push([entryKey(slug), JSON.stringify(entry)]);
      writes.push([deletedKey(slug), null]);
      commitWrites(writes);
      if (memory) memoryTargets.set(slug, memory);
      changed();
      return true;
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------- the storage budget

export function storageUsage(): { used: number; budget: number; ratio: number } {
  let used = 0;
  for (const k of safeStorage.keys()) used += k.length + (safeStorage.getItem(k)?.length ?? 0);
  return { used, budget: STORAGE_BUDGET, ratio: used / STORAGE_BUDGET };
}

let fullWarned = false;

/** Tells the user (once per session) when the library is close to the browser's storage limit. */
export function warnIfNearlyFull(): boolean {
  if (fullWarned) return false;
  const { ratio } = storageUsage();
  if (ratio < NEARLY_FULL) return false;
  fullWarned = true;
  notify(
    `Your diagrams use ${Math.min(100, Math.round(ratio * 100))}% of this browser's storage. Delete or export ones you don't need, so new edits can be saved.`,
    {
      kind: "error",
      duration: 12_000,
      action: {
        label: "Your diagrams",
        run: () => window.dispatchEvent(new Event(OPEN_LIBRARY)),
        testId: "storage-warning-open",
      },
    },
  );
  return true;
}

// ---------------------------------------------------------------- creating

/**
 * Starts a new diagram from a partial seed (title, nodes, ...) in Your diagrams and returns the
 * slug to open. No reload needed: the App listens for DIAGRAMS_CHANGED. Pair with a client-side
 * navigation, e.g. `openCanvas(createDiagram(seed))` in canvasBridge.
 */
export function createDiagram(seed: Partial<DiagramFile> = {}): string {
  const diagram = { ...emptyDiagram(), ...seed };
  if (diagram.format === DIAGRAM_FORMAT) delete diagram.planning;
  return createLibraryDiagram(diagram, undefined, undefined, {
    private: newDiagramsPrivate.get(),
  });
}

export const emptyDiagram = (): DiagramFile => ({
  format: "diagrams/v2",
  planning: { revision: "p3-w2" },
  title: UNTITLED,
  nodes: [],
  edges: [],
});

/** A library slug derived from a retired slug and its stored edits: tabs adopting the same edits write one entry. */
function retiredCopySlug(slug: string, raw: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of `${slug}:${raw}`) {
    const c = ch.codePointAt(0)!;
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return LIBRARY_SLUG_PREFIX + (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}

/** When Your diagrams can't take them, the edits stay where they are and one notice offers them all as downloads. */
function offerRetiredEdits(failed: readonly DiagramFile[]): void {
  const titles = failed.map((d) => d.title.trim() || UNTITLED);
  notify(
    `${failed.length === 1 ? `Your edits to "${titles[0]}", an example that has been replaced,` : `Your edits to ${failed.length} examples that have been replaced`} couldn't be moved to Your diagrams: this browser's storage is full. Download them now, or free up space (File → Your diagrams…) and reload.`,
    {
      kind: "error",
      duration: 60_000,
      action: {
        label: "Download edits",
        testId: "retired-edits-download",
        run: () =>
          void import("../interop/files").then(({ downloadText }) =>
            failed.forEach((d, i) =>
              downloadText(JSON.stringify(d, null, 2), `${titles[i]}.diagram.json`, "application/json"),
            ),
          ),
      },
    },
  );
}

/** The adopted copy holds exactly these edits, at least as private, and Your diagrams lists it: only then may the source go. */
function adoptionVerified(copy: string, edited: DiagramFile): boolean {
  if (!hasLibraryEntry(copy)) return false;
  if (edited.private === true && getPrivacyFlags(copy).private !== true) return false;
  const stored = getCurrent(copy);
  return !!stored && JSON.stringify(stored) === JSON.stringify(withPrivacyField(edited, false));
}

/**
 * Makes sure the copy exists and is listed. A document whose library entry was never published (an interrupted start)
 * gets its entry; a copy that's already complete is left as it is. Only a document this run creates can be rolled
 * back, so a peer's committed copy is never removed. False when storage refuses.
 */
function ensureAdopted(copy: string, edited: DiagramFile): boolean {
  const document = getOriginal(copy);
  if (document && hasLibraryEntry(copy)) return true;
  try {
    // The stored document no longer carries `private`: the entry's switch comes from the edits themselves.
    if (document)
      commitWrites([
        [entryKey(copy), JSON.stringify(summarize(copy, document, Date.now(), undefined, entryFlags(edited)))],
      ]);
    else createLibraryEntry(edited, undefined, undefined, {}, undefined, copy);
    return true;
  } catch {
    return false;
  }
}

function adoptRetired(exclusive: boolean): string[] {
  const adopted: string[] = [];
  const failed: DiagramFile[] = [];
  for (const slug of Object.keys(RETIRED_EXAMPLES)) {
    const key = AUTOSAVE_PREFIX + slug;
    const raw = safeStorage.getItem(key);
    const edited = raw === null ? undefined : readDiagram(key);
    if (raw === null || !edited) continue;
    const copy = retiredCopySlug(slug, raw);
    // You deleted this copy: it isn't recreated, and the edits stay where they were.
    if (isDeleted(copy)) continue;
    if (!ensureAdopted(copy, edited)) {
      failed.push(edited);
      continue;
    }
    adopted.push(copy);
    // Without the cross-tab lock another tab may still be writing: keep the source, the copy is found again next time.
    if (exclusive && adoptionVerified(copy, edited)) safeStorage.removeItem(key);
  }
  if (failed.length) offerRetiredEdits(failed);
  if (adopted.length) changed();
  return adopted;
}

/** One tab at a time adopts (Web Locks); see adoptRetiredExampleEdits. */
export const ADOPT_RETIRED_LOCK = "livediagrams-adopt-retired";

/**
 * Edits saved under a retired example's slug (an example autosave from before copies existed) become one of your
 * diagrams, so retiring an example never loses them. The copy's slug is derived from the edits, so a retry finds the
 * same entry instead of adding another. Tabs adopt one at a time under a Web Lock, and the old key is removed only
 * once Your diagrams lists the copy and it reads back the same edits; where Web Locks are missing, the old key is
 * always kept. When storage is full, the edits stay put and a notice offers them as downloads. Resolves to the copies'
 * slugs. Runs at startup, after the storage lifecycle (src/main.tsx).
 */
export async function adoptRetiredExampleEdits(): Promise<string[]> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) return adoptRetired(false);
  return locks.request(ADOPT_RETIRED_LOCK, () => adoptRetired(true));
}
