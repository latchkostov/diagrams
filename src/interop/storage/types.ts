import type { GlyphName } from "../ui/glyphs";

// Storage providers: where a diagram file can be opened from and saved to. "This device" (the File
// System Access API with download / file-input fallbacks) is always there; Google Drive, OneDrive and
// Dropbox exist only when the build is configured for them (see registry.ts and docs/INTEROP.md).
//
// A provider knows nothing about diagrams: it moves text in and out of files. `ref` is the provider's
// own reference to a file. For the device it's a file handle (kept in memory); for every other
// provider it's plain JSON, stored with the document so Save goes back to the same file.

export type ProviderId = "device" | "gdrive" | "onedrive" | "dropbox" | "test";

/** A file read from a provider. */
export interface StorageFile<Ref = unknown> {
  name: string;
  text: string;
  ref: Ref;
}

/** A file written to a provider. */
export interface SavedFile<Ref = unknown> {
  name: string;
  ref: Ref;
  /** Where the user can see it in the provider's own app, if it has one. */
  url?: string;
}

/** A row in a provider's in-app file list. */
export interface StorageEntry<Ref = unknown> {
  name: string;
  ref: Ref;
  /** ISO time of the last change, when the provider reports it. */
  modified?: string;
  size?: number;
}

/** What the app lends a provider while it opens a file (its in-app list, progress toasts). */
export interface OpenContext {
  /** Shows the in-app file list and resolves with the pick, or undefined if the user closed it. */
  choose(list: { load: () => Promise<StorageEntry[]> }): Promise<StorageEntry | undefined>;
  /** Shows a progress toast; call the result to dismiss it. */
  progress(text: string): () => void;
}

export interface StorageProvider<Ref = unknown> {
  id: ProviderId;
  /** The provider's name, the same everywhere: "This device", "Google Drive", "OneDrive", "Dropbox". */
  label: string;
  icon: GlyphName;
  /** True when the build has what this provider needs (env-gated); otherwise it's hidden everywhere. */
  isConfigured(): boolean;
  /**
   * Gets a usable access token, prompting the user (a popup) when needed. Call it from a click or key
   * handler: the popup opens before the first `await`, so browsers don't block it.
   */
  signIn(): Promise<void>;
  signOut(): Promise<void> | void;
  isSignedIn(): boolean;
  /** A picker or the in-app list. Undefined when the user cancels. */
  open(ctx: OpenContext): Promise<StorageFile<Ref> | undefined>;
  /** Writes over the file that `ref` points at. */
  save(ref: Ref, text: string): Promise<SavedFile<Ref>>;
  /** Creates a new file (never overwriting another one). Undefined when the user cancels. */
  saveAs(name: string, text: string): Promise<SavedFile<Ref> | undefined>;
  /** Files this app can open (providers with an in-app list). */
  list?(): Promise<StorageEntry<Ref>[]>;
  /** Where saved files go, for the in-app list's subtitle (e.g. "Apps/Diagrams"). */
  folder?: string;
  /** Warms up scripts or modules (called when the File menu opens). */
  preload?(): void;
}

/** A failure with a message written for the user (what happened and what to do). */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The message is a whole sentence for the toast, not a reason after "Couldn't …". */
    readonly standalone = false,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Files Open accepts, by extension (the same set as the device picker). */
export const OPENABLE = /\.(json|drawio|xml|svg|mmd|mermaid)$/i;
