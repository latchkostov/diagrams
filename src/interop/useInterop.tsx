import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { DiagramFile } from "../model/types";
import type { CanvasHandle } from "../canvas/CanvasView";
import type { View } from "../lib/urlState";
import {
  bindSaveTarget,
  DEVICE_PROVIDER,
  DIAGRAMS_CHANGED,
  DRAFT_SLUG,
  getDiagramIdentity,
  getPrivacyFlags,
  getSaveTarget,
  getOriginal,
  isLibrarySlug,
  isOwnSlug,
  setDiagramPrivate,
  SHARED_SLUG,
  UNTITLED,
  withPrivacyField,
  type SaveTarget,
} from "../lib/diagramIO";
import {
  canSaveToCloud,
  canShareAsLink,
  isLocalOnly,
  privacyOf,
  PRIVATE_SHARE_MESSAGE,
  type CanvasPrivacyState,
  type Privacy,
} from "../lib/localOnly";
import { newDiagramsPrivate } from "../lib/privacyPrefs";
import { PRIVACY_REQUEST } from "../lib/usePrivacy";
import { loadedCanvasActions } from "../canvas/loadCanvasView";
import { actionRegistry, type Action, type MenuNode } from "../editor/actions";
import { LIMITS, preserveUnknown, serializeNative, tooLargeMessage } from "./native";
import { drawioWriter, importText, mermaidWriter, OPEN_ACCEPT, preloadFormats, type ImportOutcome } from "./formats";
import {
  clearUrlFragment,
  decodeShare,
  encodeShare,
  SHARE_WARN_LENGTH,
  shareUrl,
  sharePayloadFromHash,
  sharePayloadFromInput,
} from "./share";
import {
  BadEncryptedLinkError,
  encryptedPayloadFromHash,
  encryptedPayloadFromInput,
  parseEncrypted,
} from "./passwordLink";
import { downloadDataUrl, downloadText, fsAccessSupported, slugify, type FileHandle } from "./files";
import { deviceProvider } from "./storage/device";
import { CLOUD_PROVIDERS, DEVICE as DEVICE_INFO, providerInfo, type ProviderInfo } from "./storage/registry";
import { StorageError, type OpenContext, type StorageEntry, type StorageProvider } from "./storage/types";
import { toast } from "./ui/toast";
import { copyText } from "./ui/copyText";
import {
  EmbedDialog,
  ImageDialog,
  OpenLinkDialog,
  PagesDialog,
  PasswordLinkDialog,
  PasteDialog,
  preloadDialogs,
  PrivacyDialog,
  ShareDialog,
  StorageFilesDialog,
  UnlockDialog,
} from "./ui/lazyDialogs";
import { DropOverlay } from "./ui/DropOverlay";

// The import / export controller: every way a diagram enters or leaves the app goes through here
// (top-bar menus, the canvas context menu, keyboard shortcuts, drag-and-drop, share links).
// Files move through storage providers (./storage): This device always, cloud ones when configured.

/** Where Save writes the open diagram (shown in the File menu and the "Saved to" status). */
export interface Binding {
  providerId: string;
  /** The provider's name ("OneDrive") and its mid-sentence form ("this device"). */
  label: string;
  inSentence: string;
  /** The file's name. */
  name: string;
  /** When Save last wrote it; missing for a file that was only opened. */
  savedAt?: number;
}

interface Options {
  view: View;
  slug: string;
  canvas: RefObject<CanvasHandle | null>;
  /** Adds the diagram to Your diagrams (bound to `target` for Save) and shows it. Throws if it can't be kept. */
  openDiagram: (d: DiagramFile, target?: SaveTarget, sourceSlug?: string) => void;
  /** Shows a diagram from a share link in the shared slot, apart from the user's own. */
  openShared: (d: DiagramFile) => void;
  /** Public examples can be embedded by name. */
  isPublicExample: (slug: string) => boolean;
}

/** PNG / SVG export choices (the image dialog's Options). The title is in by default. */
export interface ImageExportOptions {
  scale?: number;
  transparent?: boolean;
  /** The diagram's title and description above it. Default true. */
  title?: boolean;
}

type DialogState =
  /** `source`: the document the link is for; the dialog closes if it becomes private. */
  | { kind: "share"; diagram: DiagramFile; source: string }
  | { kind: "password-link"; diagram: DiagramFile; source: string }
  /** A password link (#e=…) waiting for its password. */
  | { kind: "unlock"; token: string; session: number }
  | { kind: "embed"; diagram: DiagramFile; source: string; example?: string }
  | { kind: "image" }
  /** Turning Private off for `source`, the document it was opened for (it closes if another one opens). */
  | { kind: "privacy"; source: string }
  | { kind: "paste" }
  | { kind: "link" }
  | {
      kind: "pages";
      fileName: string;
      pages: { name: string; index: number }[];
      pick: (i: number) => ImportOutcome;
      source: Source;
    }
  | {
      kind: "storage";
      info: ProviderInfo;
      provider: StorageProvider;
      load: () => Promise<StorageEntry[]>;
      resolve: (entry: StorageEntry | undefined) => void;
    };

/** Where an import came from, so "Save" can go back there (native files only). */
interface Source {
  name: string;
  target?: SaveTarget;
}

/** The canvas's canonical form of a file (same as CanvasView's "edited" check). Loads with the canvas. */
const normalized = async (d: DiagramFile) => {
  const { fromFlow, toFlow } = await import("../canvas/convert");
  const f = toFlow(d);
  return JSON.stringify(fromFlow(f.meta, f.nodes, f.edges));
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const deviceTarget = (handle: FileHandle, savedAt?: number): SaveTarget => ({
  providerId: DEVICE_PROVIDER,
  ref: handle,
  name: handle.name,
  ...(savedAt ? { savedAt } : {}),
});

export function useInterop({ view, slug, canvas: canvasRef, openDiagram, openShared, isPublicExample }: Options) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // The diagram open right now (a save that finishes later compares against it).
  const openSlug = useRef(slug);
  useLayoutEffect(() => {
    openSlug.current = slug;
  }, [slug]);
  const [, setBindingVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fsSupported = useMemo(() => fsAccessSupported(), []);

  // A destination whose provider this build doesn't offer (e.g. OneDrive, then unconfigured) is ignored.
  const target = getSaveTarget(slug);
  const targetInfo = providerInfo(target?.providerId);
  const binding: Binding | undefined =
    target && targetInfo
      ? {
          providerId: targetInfo.id,
          label: targetInfo.label,
          inSentence: targetInfo.inSentence,
          name: target.name,
          savedAt: target.savedAt,
        }
      : undefined;

  const bind = useCallback((target: string, destination: SaveTarget, identity: string) => {
    const bound = bindSaveTarget(target, destination, identity);
    if (bound) setBindingVersion((v) => v + 1);
    return bound;
  }, []);

  // ---------------------------------------------------------------- privacy

  /**
   * A document's privacy inputs, read now: its provenance flags (one storage read), plus its content in
   * development only (privacyOf never reads content in production, so the canvas isn't converted for it).
   * `source` is the document an action started from: a share or a save that's still running asks about
   * that document, whatever is open by the time it acts.
   */
  const privacyState = useCallback(
    (source: string = slug): CanvasPrivacyState => ({
      ...getPrivacyFlags(source),
      ...(import.meta.env.DEV && source === openSlug.current ? { diagram: canvasRef.current?.getDiagram() } : {}),
    }),
    [canvasRef, slug],
  );
  /** Local-only (built in), Private (the switch) or null. Read when asked, never cached. */
  const privacy = (): Privacy => privacyOf(privacyState());

  // A private diagram never keeps a fragment in the address bar, however it became private (the switch,
  // a paste from a private diagram, another tab). Not on mount: a share link being opened is read first.
  useEffect(() => {
    if (view !== "canvas") return;
    const check = () => {
      if (isLocalOnly(getPrivacyFlags(slug))) clearUrlFragment();
    };
    window.addEventListener(DIAGRAMS_CHANGED, check);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, check);
  }, [view, slug]);

  // ---------------------------------------------------------------- export

  /** The open diagram as a file. A private one says so (`"private": true`), so it stays private when reopened. */
  const current = useCallback((): DiagramFile => {
    const d = canvasRef.current?.getDiagram();
    if (!d) throw new Error("Open a diagram on the canvas first.");
    return withPrivacyField(preserveUnknown(d, getOriginal(slug)), isLocalOnly(privacyState()));
  }, [canvasRef, slug, privacyState]);

  const baseName = useCallback((d: DiagramFile) => (isOwnSlug(slug) ? slugify(d.title) : slug), [slug]);

  /** Runs an action, turning any failure into a friendly toast. Called from handlers, never during render. */
  const attempt = async (what: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof StorageError && err.standalone ? err.message : `Couldn't ${what}. ${message(err)}`);
    }
  };

  const exportNative = () =>
    attempt("export the diagram", () => {
      const d = current();
      downloadText(serializeNative(d), `${baseName(d)}.diagram.json`, "application/json");
      toast.success(`Exported ${d.nodes.length} nodes and ${d.edges.length} edges.`);
    });

  const exportImage = (kind: "png" | "svg", opts: ImageExportOptions = {}) =>
    attempt(`export the ${kind.toUpperCase()}`, async () => {
      const d = current();
      const busy = toast.busy(`Rendering ${kind.toUpperCase()}…`);
      const { renderDiagramImage } = await import("./image");
      // The picture carries its title, as presentation does (an untitled diagram has none to show).
      const title = d.title.trim();
      const header =
        opts.title !== false && title && title !== UNTITLED
          ? { title, description: d.description?.trim() || undefined }
          : undefined;
      const url = await renderDiagramImage(kind, { scale: opts.scale, transparent: opts.transparent, header });
      const suffix = kind === "png" ? `${opts.scale === 1 ? "" : "@2x"}${opts.transparent ? "-transparent" : ""}` : "";
      await downloadDataUrl(url, `${baseName(d)}${suffix}.${kind}`);
      toast.dismiss(busy);
      toast.success(`Exported ${kind.toUpperCase()}.`);
    });

  const exportDrawio = () =>
    attempt("export to draw.io", async () => {
      const d = current();
      const [{ diagramToDrawio }, { inlineIcons }] = await Promise.all([drawioWriter(), import("./icons")]);
      const xml = diagramToDrawio(d, { iconSvg: await inlineIcons(d) });
      downloadText(xml, `${baseName(d)}.drawio`, "application/vnd.jgraph.mxfile");
      toast.success("Exported a .drawio file. Open it at app.diagrams.net or in draw.io Desktop.");
    });

  const copyMermaid = () =>
    attempt("copy Mermaid", async () => {
      const d = current();
      const text = (await mermaidWriter()).diagramToMermaid(d);
      if (await copyText(text))
        toast.success("Mermaid flowchart copied. Paste it into GitHub, Notion, Obsidian or mermaid.live.");
      else throw new Error("The browser blocked clipboard access. Use Download .mmd instead.");
    });

  const downloadMermaid = () =>
    attempt("export Mermaid", async () => {
      const d = current();
      const { diagramToMermaid } = await mermaidWriter();
      downloadText(diagramToMermaid(d), `${baseName(d)}.mmd`, "text/plain");
      toast.success("Exported a Mermaid .mmd file.");
    });

  /**
   * Share links and embeds: the one gate, asked every time a link is about to be made, copied, shown or
   * shared (never only when the command started). A private diagram gets no link, and says why.
   */
  const linkAllowed = (source: string = slug) => {
    if (canShareAsLink(privacyState(source))) return true;
    toast.info(PRIVATE_SHARE_MESSAGE, {
      action: { label: "Export file", run: () => void exportNative(), testId: "toast-private-export" },
    });
    return false;
  };
  const linkStillAllowed = (source: string) => canShareAsLink(privacyState(source));

  /** The share dialog for `d`, from `source`: only while that document may still be shared. */
  const showShare = (d: DiagramFile, source: string) => {
    if (linkAllowed(source)) setDialog({ kind: "share", diagram: d, source });
  };

  const openShare = () => attempt("create a share link", () => showShare(current(), slug));

  /** Copy link with password… for `d`, from `source`: only while that document may still be shared. */
  const showPasswordLink = (d: DiagramFile, source: string) => {
    if (linkAllowed(source)) setDialog({ kind: "password-link", diagram: d, source });
  };

  /** Copy link with password…: the dialog picks the password, encrypts and copies (rechecking the gate). */
  const copyPasswordLink = () => attempt("create a link with password", () => showPasswordLink(current(), slug));

  /** One click: copy the link. The dialog (details, warnings, native share) is one step away. */
  const copyShareLink = () =>
    attempt("create a share link", async () => {
      const source = slug;
      if (!linkAllowed(source)) return;
      const d = current();
      const url = shareUrl(await encodeShare(d));
      // Encoding takes a moment: the diagram may have become private since (here or in another tab).
      if (!linkAllowed(source)) return;
      const details = {
        label: "Details",
        run: () => showShare(d, source),
        testId: "toast-share-details",
      };
      if (!(await copyText(url))) return showShare(d, source);
      if (url.length > SHARE_WARN_LENGTH) {
        toast.info(
          `Share link copied, but it's long (${Math.round(url.length / 1000)}k characters). Some apps cut long links off.`,
          { action: details, duration: 9000 },
        );
      } else {
        toast.success("Share link copied. The diagram travels inside the link.", { action: details });
      }
    });
  const openEmbed = () =>
    attempt("create embed code", async () => {
      const source = slug;
      if (!linkAllowed(source)) return;
      const d = current();
      // Embed by name only when the example is public and unedited (the viewer shows the original).
      const original = getOriginal(source);
      const shown = JSON.stringify(canvasRef.current?.getDiagram());
      const pristine = !!original && (await normalized(original)) === shown;
      // The check above can wait for code: the diagram may have become private since.
      if (!linkAllowed(source)) return;
      setDialog({
        kind: "embed",
        diagram: d,
        source,
        example: isPublicExample(source) && pristine ? source : undefined,
      });
    });

  // ---------------------------------------------------------------- save

  const saveToDevice = (as = false) =>
    attempt("save the file", async () => {
      const d = current();
      const text = serializeNative(d);
      const name = `${baseName(d)}.diagram.json`;
      if (!fsSupported) {
        downloadText(text, name, "application/json");
        toast.success(`Downloaded ${name}. (This browser can't save over a file, so each save is a new download.)`);
        return;
      }
      const identity = getDiagramIdentity(slug);
      const target = getSaveTarget(slug);
      const existing = target?.providerId === DEVICE_PROVIDER ? (target.ref as FileHandle) : undefined;
      if (existing && !as) {
        const file = await deviceProvider.save(existing, text);
        bind(slug, deviceTarget(file.ref, Date.now()), identity);
        toast.success(`Saved to ${file.name}.`);
        return;
      }
      const file = await deviceProvider.saveAs(name, text);
      if (!file) return;
      // The destination binds to the diagram that started the save, even if another one is open now.
      const bound = bind(slug, deviceTarget(file.ref, Date.now()), identity);
      const stillOpen = openSlug.current === slug;
      toast.success(
        bound && stillOpen
          ? `Saved to ${file.name}. Ctrl+S saves here again.`
          : bound
            ? `Saved “${d.title}” to ${file.name}. Ctrl+S saves it there again when it's open.`
            : `Saved “${d.title}” to ${file.name}. The open diagram has changed; save it separately.`,
      );
    });

  /** Save to a cloud provider: over the file this diagram is bound to there, or (`asNew`) a new file. */
  const saveToCloud = (info: ProviderInfo, asNew = false) =>
    attempt(`save to ${info.label}`, async () => {
      const source = slug;
      if (!canSaveToCloud(privacyState(source))) {
        toast.error(`Private diagrams aren't saved to ${info.label}. Save to this device instead.`, {
          action: {
            label: "Save to this device",
            run: () => void saveToDevice(true),
            testId: "toast-private-save-device",
          },
        });
        return;
      }
      const d = current();
      const identity = getDiagramIdentity(source);
      const stored = getSaveTarget(source);
      // Loading the provider and signing in take time. If this document becomes private meanwhile (the
      // switch, a paste, another tab), the write is cancelled: the provider checks the signal after every
      // token request and the upload carries it, so the captured public copy never lands.
      const cancel = new AbortController();
      const blocked = new StorageError(
        `Not saved to ${info.label}: “${d.title}” became private. Save it to this device instead.`,
        undefined,
        true,
      );
      const watch = () => {
        if (!canSaveToCloud(privacyState(source))) cancel.abort(blocked);
      };
      window.addEventListener(DIAGRAMS_CHANGED, watch);
      let busy: number | undefined;
      let file: Awaited<ReturnType<StorageProvider["saveAs"]>>;
      try {
        const provider = await info.load();
        watch();
        cancel.signal.throwIfAborted();
        busy = toast.busy(`Saving to ${info.label}…`);
        const content = serializeNative(d);
        file =
          stored?.providerId === info.id && !asNew
            ? await provider.save(stored.ref, content, { signal: cancel.signal })
            : await provider.saveAs(`${baseName(d)}.diagram.json`, content, { signal: cancel.signal });
      } finally {
        window.removeEventListener(DIAGRAMS_CHANGED, watch);
        if (busy !== undefined) toast.dismiss(busy);
      }
      if (!file) return;
      const bound = bind(
        source,
        { providerId: info.id, ref: file.ref, name: file.name, savedAt: Date.now() },
        identity,
      );
      const url = file.url;
      toast.success(
        bound
          ? `Saved to ${info.label} as ${file.name}.`
          : `Saved “${d.title}” to ${info.label} as ${file.name}. The open diagram has changed; save it separately.`,
        url && /^https:\/\//.test(url)
          ? {
              action: {
                label: `Open in ${info.label}`,
                run: () => window.open(url, "_blank", "noopener"),
                testId: `toast-open-${info.id}`,
              },
            }
          : undefined,
      );
    });

  /** Ctrl+S: back to wherever this diagram came from / was last saved, else ask. */
  const save = () => {
    const t = getSaveTarget(slug);
    const cloud = t && t.providerId !== DEVICE_PROVIDER ? providerInfo(t.providerId) : undefined;
    return cloud ? saveToCloud(cloud) : saveToDevice();
  };

  /** File > Save to ▸: This device asks where (Save as); a cloud provider always makes a new file. */
  const saveTo = (id: string) => {
    if (id === DEVICE_PROVIDER) return saveToDevice(true);
    const info = providerInfo(id);
    return info ? saveToCloud(info, true) : Promise.resolve();
  };

  // ---------------------------------------------------------------- import

  const handleOutcome = useCallback(
    (outcome: ImportOutcome, source: Source) => {
      if (outcome.ok === false) {
        toast.error(`Couldn't import ${source.name}. ${outcome.error}`);
        return;
      }
      if (outcome.ok === "pages") {
        setDialog({ kind: "pages", fileName: source.name, pages: outcome.pages, pick: outcome.pick, source });
        return;
      }
      try {
        // Only our own format saves back to where it came from (a .drawio file is converted).
        openDiagram(outcome.diagram, outcome.format === "native" ? source.target : undefined);
      } catch (err) {
        toast.error(`Couldn't import ${source.name}. ${message(err)}`);
        return;
      }
      setDialog(null);
      const note = outcome.warnings.length
        ? ` ${outcome.warnings[0]}${outcome.warnings.length > 1 ? ` (+${outcome.warnings.length - 1} more)` : ""}`
        : "";
      const from = outcome.format === "native" ? "" : ` from ${outcome.format === "drawio" ? "draw.io" : "Mermaid"}`;
      toast.info(`Imported “${outcome.diagram.title}”${from}.${note}`, { duration: note ? 7000 : undefined });
    },
    [openDiagram],
  );

  const importFile = useCallback(
    async (file: File) => {
      // Check the size before reading anything into memory.
      if (file.size > LIMITS.maxTextChars) {
        toast.error(`Couldn't import ${file.name}. ${tooLargeMessage(file.size)}`);
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        toast.error(`Couldn't read ${file.name}.`);
        return;
      }
      handleOutcome(await importText(text, file.name), { name: file.name });
    },
    [handleOutcome],
  );

  /** What a provider borrows while opening: the in-app file list and progress toasts. */
  const openContext = (info: ProviderInfo, provider: StorageProvider): OpenContext => ({
    choose: ({ load }) => new Promise((resolve) => setDialog({ kind: "storage", info, provider, load, resolve })),
    progress: (text) => {
      const id = toast.busy(text);
      return () => toast.dismiss(id);
    },
  });

  /** Opens a file from a provider; Save goes back to it (native files). */
  const openFromProvider = async (info: ProviderInfo, provider: StorageProvider) => {
    const file = await provider.open(openContext(info, provider));
    if (!file) return;
    const target: SaveTarget =
      info.id === DEVICE_PROVIDER
        ? deviceTarget(file.ref as FileHandle)
        : { providerId: info.id, ref: file.ref, name: file.name };
    handleOutcome(await importText(file.text, file.name), { name: file.name, target });
  };

  /** Open… (Ctrl+O): this device's file picker, or the file input where the browser has none. */
  const openFile = () =>
    attempt("open the file", async () => {
      if (!fsSupported) {
        fileInput.current?.click();
        return;
      }
      await openFromProvider(DEVICE_INFO, deviceProvider);
    });

  /** File > Open from ▸ <provider>. */
  const openFrom = (id: string) => {
    if (id === DEVICE_PROVIDER) return openFile();
    const info = providerInfo(id);
    if (!info) return Promise.resolve();
    return attempt(`open from ${info.label}`, async () => openFromProvider(info, await info.load()));
  };

  const importPasted = useCallback(
    async (text: string) => handleOutcome(await importText(text), { name: "the pasted text" }),
    [handleOutcome],
  );

  const openSharePayload = useCallback(
    async (payload: string) => {
      const busy = toast.busy("Opening the shared diagram…");
      try {
        const d = await decodeShare(payload);
        setDialog(null);
        openShared(d);
        toast.info(`Opened the shared diagram “${d.title}”. It's kept apart from your own diagrams.`);
      } catch (err) {
        toast.dismiss(busy);
        toast.error(message(err));
      }
    },
    [openShared],
  );

  /**
   * The password prompt's session: one number per prompt. Cancel or Esc, a newer link, another dialog,
   * success and unmounting all end it, and a decryption that finishes after its session ended is dropped
   * (it never opens the diagram, clears the link or closes a newer prompt).
   */
  const unlockSession = useRef(0);
  useEffect(() => {
    if (dialog?.kind !== "unlock") unlockSession.current++;
  }, [dialog]);
  useEffect(
    () => () => {
      unlockSession.current++;
    },
    [],
  );

  /** A password link: check its format and version first, then ask for the password. */
  const askForPassword = useCallback((token: string): boolean => {
    try {
      parseEncrypted(token);
    } catch (err) {
      toast.error(err instanceof BadEncryptedLinkError ? err.message : message(err));
      return false;
    }
    setDialog({ kind: "unlock", token, session: ++unlockSession.current });
    return true;
  }, []);

  const unlockShared = useCallback(
    async (session: number, token: string, password: string) => {
      const from = openSlug.current;
      // The WebCrypto part loads on use (./passwordLink.ts is all the app carries up front).
      const { decodeEncryptedShare } = await import("./shareCrypto");
      const d = await decodeEncryptedShare(token, password);
      if (session !== unlockSession.current) return;
      if (openSlug.current !== from)
        throw new Error("Another diagram opened while this one was unlocking. Enter the password again to open it.");
      // Stored first: if that fails (storage full or blocked), the prompt shows why and the link stays.
      openShared(d);
      unlockSession.current++;
      // Opened: take the ciphertext out of the address bar and this tab's history entry.
      if (encryptedPayloadFromHash(window.location.hash) === token) clearUrlFragment();
      setDialog(null);
      toast.info(`Opened the shared diagram “${d.title}”. It's kept apart from your own diagrams.`);
    },
    [openShared],
  );

  const openShareLinkInput = useCallback(
    (input: string) => {
      const token = encryptedPayloadFromInput(input);
      if (token) return void askForPassword(token);
      const payload = sharePayloadFromInput(input);
      if (!payload)
        return void toast.error("That doesn't look like a Live Diagrams share link (it should contain #d=… or #e=…).");
      void openSharePayload(payload);
    },
    [openSharePayload, askForPassword],
  );

  // Share links: on load and when only the hash changes (a link pasted into this tab).
  useEffect(() => {
    const check = () => {
      // A password link keeps its fragment until it's unlocked: cancel, reload, and it asks again.
      const token = encryptedPayloadFromHash(window.location.hash);
      if (token) {
        if (!askForPassword(token)) clearUrlFragment();
        return;
      }
      const payload = sharePayloadFromHash(window.location.hash);
      if (!payload) return;
      // Drop the fragment first so a reload doesn't re-import over edits made since. The diagram stays in
      // the Shared slot, so a reload still shows it.
      clearUrlFragment();
      void openSharePayload(payload);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openSharePayload, askForPassword]);

  /** Shared banner: keep a copy of the shared diagram in Your diagrams. */
  const keepSharedCopy = () =>
    attempt("keep a copy", () => {
      const d = current();
      openDiagram(d, undefined, slug);
      toast.success(`Saved a copy of “${d.title}” to Your diagrams.`);
    });

  // ---------------------------------------------------------------- the Private switch

  /**
   * On: your own diagram (or the blank draft) changes in place; an example or a shared diagram becomes a
   * private copy in Your diagrams. Off: one confirmation first (the privacy dialog).
   */
  const setPrivate = (on: boolean) =>
    attempt(on ? "make it private" : "change its privacy", () => {
      const kind = privacy();
      if (!on) {
        if (kind === "private") setDialog({ kind: "privacy", source: slug });
        return;
      }
      if (kind) return;
      if (isLibrarySlug(slug) || slug === DRAFT_SLUG) {
        setDiagramPrivate(slug, true);
        clearUrlFragment();
        toast.success("Private: no share links, cloud saves or AI for this diagram.");
        return;
      }
      const d = current();
      openDiagram(withPrivacyField(d, true), undefined, slug === SHARED_SLUG ? slug : undefined);
      clearUrlFragment();
      toast.success(`Saved a private copy of “${d.title}” to Your diagrams.`);
    });

  /** Turns Private off for `source` only: the document the confirmation was asked for. */
  const confirmNotPrivate = (source: string) =>
    attempt("change its privacy", () => {
      setDialog(null);
      if (source !== openSlug.current) return;
      if (setDiagramPrivate(source, false)) toast.success("This diagram is no longer private.");
      // The badge that opened the dialog is gone with it: keep the keyboard on the canvas, not the page.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
      });
    });

  // The privacy confirmation is about one document: another one opening (Back, a link, another tab's
  // navigation, even while the dialog's code is still downloading) closes it.
  if (dialog?.kind === "privacy" && dialog.source !== slug) setDialog(null);

  // A share or embed dialog left open closes when its document becomes private (here or in another tab).
  const linkDialogSource =
    dialog?.kind === "share" || dialog?.kind === "embed" || dialog?.kind === "password-link"
      ? dialog.source
      : undefined;
  useEffect(() => {
    if (linkDialogSource === undefined) return;
    const check = () => {
      if (canShareAsLink(privacyState(linkDialogSource))) return;
      setDialog(null);
      toast.info(PRIVATE_SHARE_MESSAGE);
    };
    window.addEventListener(DIAGRAMS_CHANGED, check);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, check);
  }, [linkDialogSource, privacyState]);

  // The badge beside the title asks for the dialog: it explains, and turns Private off on confirmation.
  useEffect(() => {
    const onRequest = () => {
      if (privacyOf(getPrivacyFlags(slug)) === "private") setDialog({ kind: "privacy", source: slug });
    };
    window.addEventListener(PRIVACY_REQUEST, onRequest);
    return () => window.removeEventListener(PRIVACY_REQUEST, onRequest);
  }, [slug]);

  // ---------------------------------------------------------------- keyboard

  const api = {
    exportNative,
    exportPng: (opts: ImageExportOptions = {}) => exportImage("png", opts),
    exportSvg: () => exportImage("svg"),
    exportImage: (kind: "png" | "svg", opts: ImageExportOptions = {}) => exportImage(kind, opts),
    openImageOptions: () => setDialog({ kind: "image" }),
    copyShareLink,
    copyPasswordLink,
    exportDrawio,
    copyMermaid,
    downloadMermaid,
    openShare,
    openEmbed,
    save,
    saveAs: () => saveToDevice(true),
    saveTo,
    openFile,
    openFrom,
    openPaste: () => setDialog({ kind: "paste" }),
    openShareLink: () => setDialog({ kind: "link" }),
    keepSharedCopy,
    /** The open diagram's privacy: "local-only" (built in, always), "private" (the switch) or null. */
    privacy,
    setPrivate,
    setNewDiagramsPrivate: (on: boolean) => newDiagramsPrivate.set(on),
    /**
     * What the File menu's commands need, loaded as it opens: the dialogs, the draw.io and Mermaid converters,
     * and the configured providers' code and scripts (nothing configured: no provider loads).
     */
    preload: () => {
      // After the menu's first frame: running new code first would delay it.
      requestAnimationFrame(() =>
        setTimeout(() => {
          preloadDialogs();
          preloadFormats();
        }),
      );
      for (const info of CLOUD_PROVIDERS)
        void info.load().then(
          (p) => p.preload?.(),
          () => {},
        );
    },
    binding,
    fsSupported,
    /** The configured cloud providers (none by default: then every cloud entry is hidden). */
    cloudProviders: CLOUD_PROVIDERS,
  };
  const apiRef = useRef(api);
  useLayoutEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "s" && view === "canvas") {
        e.preventDefault();
        if (e.shiftKey) void apiRef.current.saveAs();
        else void apiRef.current.save();
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        void apiRef.current.openFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  // ---------------------------------------------------------------- rendering

  const layer: ReactNode = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={OPEN_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
        name="import-file"
        data-testid="import-input"
      />
      <DropOverlay onFile={(f) => void importFile(f)} />
      {dialog?.kind === "storage" && (
        <StorageFilesDialog
          label={dialog.info.label}
          icon={dialog.info.icon}
          folder={dialog.provider.folder}
          load={dialog.load}
          onPick={(entry) => {
            setDialog(null);
            dialog.resolve(entry);
          }}
          onSignOut={() => {
            setDialog(null);
            dialog.resolve(undefined);
            void dialog.provider.signOut();
            toast.info(`Signed out of ${dialog.info.label}.`);
          }}
          onClose={() => {
            setDialog(null);
            dialog.resolve(undefined);
          }}
        />
      )}
      {dialog?.kind === "image" && (
        <ImageDialog
          onExport={(kind, opts) => {
            setDialog(null);
            void exportImage(kind, opts);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog
          diagram={dialog.diagram}
          allowed={() => linkStillAllowed(dialog.source)}
          onPasswordLink={() => showPasswordLink(dialog.diagram, dialog.source)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "privacy" && (
        <PrivacyDialog onTurnOff={() => void confirmNotPrivate(dialog.source)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "password-link" && (
        <PasswordLinkDialog
          diagram={dialog.diagram}
          allowed={() => linkStillAllowed(dialog.source)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "unlock" && (
        <UnlockDialog
          key={dialog.session}
          unlock={(password) => unlockShared(dialog.session, dialog.token, password)}
          onClose={() => {
            unlockSession.current++;
            setDialog(null);
            toast.info("The password-protected diagram wasn't opened. Reload the page to enter the password.");
          }}
        />
      )}
      {dialog?.kind === "embed" && (
        <EmbedDialog
          diagram={dialog.diagram}
          example={dialog.example}
          allowed={() => linkStillAllowed(dialog.source)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "paste" && (
        <PasteDialog onImport={(t) => void importPasted(t)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "link" && <OpenLinkDialog onOpen={openShareLinkInput} onClose={() => setDialog(null)} />}
      {dialog?.kind === "pages" && (
        <PagesDialog
          fileName={dialog.fileName}
          pages={dialog.pages}
          onPick={(i) => handleOutcome(dialog.pick(i), dialog.source)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );

  return { ...api, layer };
}

export type Interop = ReturnType<typeof useInterop>;
type InteropApi = Omit<Interop, "layer">;

/** Registers built-ins before extensions when an editable canvas attaches, without importing its rendering module. */
export function useInteropCanvasActions(canvasRef: RefObject<CanvasHandle | null>, api: InteropApi) {
  const apiRef = useRef(api);
  useLayoutEffect(() => {
    apiRef.current = api;
  });
  const unregister = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (handle: CanvasHandle | null) => {
      canvasRef.current = handle;
      unregister.current?.();
      // A mounted canvas means its code has loaded, built-in actions included.
      const builtins = handle ? loadedCanvasActions()?.builtinActions() : undefined;
      unregister.current = handle
        ? actionRegistry.register([...(builtins ?? []), ...canvasActions(() => apiRef.current)])
        : undefined;
    },
    [canvasRef],
  );
}

/**
 * The canvas right-click "Export" submenu. Saving and opening stay in the File menu (and Ctrl+S /
 * Ctrl+O); the right-click keeps only what acts on the picture in front of you. Item names match
 * the File menu exactly.
 */
function canvasActions(get: () => InteropApi): Action[] {
  const item = (id: string, label: string, run: () => unknown, hint?: string, disabled = false): MenuNode => ({
    type: "item",
    id,
    label,
    hint,
    disabled,
    run: () => void run(),
  });
  return [
    {
      // Ctrl+K only: the File menu's Privacy ▸ and the badge beside the title are the visible controls.
      id: "file.private",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      paletteOnly: true,
      label: () => (get().privacy() ? "Make this diagram not private…" : "Make this diagram private"),
      icon: "lock",
      enabled: () => get().privacy() !== "local-only",
      hint: () => (get().privacy() === "local-only" ? "Always private" : undefined),
      run: () => void get().setPrivate(!get().privacy()),
    },
    {
      // Replaces the editor's built-in JSON-only Export submenu.
      id: "canvas.export",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      order: 20,
      label: "Export",
      icon: "download",
      children: () => {
        const privateNow = !!get().privacy();
        const hint = privateNow ? "Private" : undefined;
        return [
          item("export:png", "Export PNG", () => get().exportPng({ scale: 2 }), "2×"),
          item("export:share", "Copy share link", () => get().copyShareLink(), hint, privateNow),
          item("export:share-password", "Copy link with password…", () => get().copyPasswordLink(), hint, privateNow),
          item("export:embed", "Embed code…", () => get().openEmbed(), hint, privateNow),
          { type: "separator" },
          item("export:json", "Diagram file", () => get().exportNative(), ".diagram.json"),
          item("export:image", "Image…", () => get().openImageOptions(), "PNG or SVG"),
          item("export:drawio", "draw.io", () => get().exportDrawio(), ".drawio"),
          item("export:mermaid-download", "Mermaid file", () => get().downloadMermaid(), ".mmd"),
          item("export:mermaid", "Copy as Mermaid", () => get().copyMermaid()),
        ];
      },
    },
  ];
}
