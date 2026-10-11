import {
  Suspense,
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
  getDiagramIdentity,
  getSaveTarget,
  getOriginal,
  isOwnSlug,
  UNTITLED,
  type SaveTarget,
} from "../lib/diagramIO";
import { fromFlow, toFlow } from "../canvas/convert";
import { actionRegistry, type Action, type MenuNode } from "../editor/actions";
import { builtinActions } from "../editor/builtinActions";
import { LIMITS, preserveUnknown, serializeNative, tooLargeMessage } from "./native";
import { importText, OPEN_ACCEPT, type ImportOutcome } from "./formats";
import {
  decodeShare,
  encodeShare,
  SHARE_WARN_LENGTH,
  shareUrl,
  sharePayloadFromHash,
  sharePayloadFromInput,
} from "./share";
import { diagramToDrawio } from "./drawio/write";
import { diagramToMermaid } from "./mermaid/write";
import { downloadDataUrl, downloadText, fsAccessSupported, slugify, type FileHandle } from "./files";
import { deviceProvider } from "./storage/device";
import { CLOUD_PROVIDERS, DEVICE as DEVICE_INFO, providerInfo, type ProviderInfo } from "./storage/registry";
import { StorageError, type OpenContext, type StorageEntry, type StorageProvider } from "./storage/types";
import { toast } from "./ui/toast";
import { copyText } from "./ui/copyText";
import { EmbedDialog, ImageDialog, OpenLinkDialog, PagesDialog, PasteDialog, ShareDialog } from "./ui/dialogs";
import { DropOverlay } from "./ui/DropOverlay";

import { StorageFilesDialog } from "./ui/storageDialogLazy";

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
  | { kind: "share"; diagram: DiagramFile }
  | { kind: "embed"; diagram: DiagramFile; example?: string }
  | { kind: "image" }
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

/** The canvas's canonical form of a file (same as CanvasView's "edited" check). */
const normalized = (d: DiagramFile) => {
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

  // ---------------------------------------------------------------- export

  const current = useCallback((): DiagramFile => {
    const d = canvasRef.current?.getDiagram();
    if (!d) throw new Error("Open a diagram on the canvas first.");
    return preserveUnknown(d, getOriginal(slug));
  }, [canvasRef, slug]);

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
      const { inlineIcons } = await import("./icons");
      const xml = diagramToDrawio(d, { iconSvg: await inlineIcons(d) });
      downloadText(xml, `${baseName(d)}.drawio`, "application/vnd.jgraph.mxfile");
      toast.success("Exported a .drawio file. Open it at app.diagrams.net or in draw.io Desktop.");
    });

  const copyMermaid = () =>
    attempt("copy Mermaid", async () => {
      const text = diagramToMermaid(current());
      if (await copyText(text))
        toast.success("Mermaid flowchart copied. Paste it into GitHub, Notion, Obsidian or mermaid.live.");
      else throw new Error("The browser blocked clipboard access. Use Download .mmd instead.");
    });

  const downloadMermaid = () =>
    attempt("export Mermaid", () => {
      const d = current();
      downloadText(diagramToMermaid(d), `${baseName(d)}.mmd`, "text/plain");
      toast.success("Exported a Mermaid .mmd file.");
    });

  const openShare = () => attempt("create a share link", () => setDialog({ kind: "share", diagram: current() }));

  /** One click: copy the link. The dialog (details, warnings, native share) is one step away. */
  const copyShareLink = () =>
    attempt("create a share link", async () => {
      const d = current();
      const url = shareUrl(await encodeShare(d));
      const details = {
        label: "Details",
        run: () => setDialog({ kind: "share", diagram: d }),
        testId: "toast-share-details",
      };
      if (!(await copyText(url))) return setDialog({ kind: "share", diagram: d });
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
    attempt("create embed code", () => {
      const d = current();
      // Embed by name only when the example is public and unedited (the viewer shows the original).
      const original = getOriginal(slug);
      const pristine = !!original && normalized(original) === JSON.stringify(canvasRef.current?.getDiagram());
      setDialog({ kind: "embed", diagram: d, example: isPublicExample(slug) && pristine ? slug : undefined });
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
      const d = current();
      const identity = getDiagramIdentity(slug);
      const stored = getSaveTarget(slug);
      const provider = await info.load();
      const busy = toast.busy(`Saving to ${info.label}…`);
      const content = serializeNative(d);
      const file =
        stored?.providerId === info.id && !asNew
          ? await provider.save(stored.ref, content)
          : await provider.saveAs(`${baseName(d)}.diagram.json`, content);
      toast.dismiss(busy);
      if (!file) return;
      const bound = bind(slug, { providerId: info.id, ref: file.ref, name: file.name, savedAt: Date.now() }, identity);
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

  const openShareLinkInput = useCallback(
    (input: string) => {
      const payload = sharePayloadFromInput(input);
      if (!payload) return void toast.error("That doesn't look like a Diagrams share link (it should contain #d=…).");
      void openSharePayload(payload);
    },
    [openSharePayload],
  );

  // Share links: on load and when only the hash changes (a link pasted into this tab).
  useEffect(() => {
    const check = () => {
      const payload = sharePayloadFromHash(window.location.hash);
      if (!payload) return;
      // Drop the fragment first so a reload doesn't re-import over edits made since.
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      void openSharePayload(payload);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [openSharePayload]);

  /** Shared banner: keep a copy of the shared diagram in Your diagrams. */
  const keepSharedCopy = () =>
    attempt("keep a copy", () => {
      const d = current();
      openDiagram(d, undefined, slug);
      toast.success(`Saved a copy of “${d.title}” to Your diagrams.`);
    });

  // ---------------------------------------------------------------- keyboard

  const api = {
    exportNative,
    exportPng: (opts: ImageExportOptions = {}) => exportImage("png", opts),
    exportSvg: () => exportImage("svg"),
    exportImage: (kind: "png" | "svg", opts: ImageExportOptions = {}) => exportImage(kind, opts),
    openImageOptions: () => setDialog({ kind: "image" }),
    copyShareLink,
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
    /** Loads the configured providers' code and scripts (the File menu calls it as it opens). Nothing configured: nothing loads. */
    preloadStorage: () => {
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
        <Suspense fallback={null}>
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
        </Suspense>
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
      {dialog?.kind === "share" && <ShareDialog diagram={dialog.diagram} onClose={() => setDialog(null)} />}
      {dialog?.kind === "embed" && (
        <EmbedDialog diagram={dialog.diagram} example={dialog.example} onClose={() => setDialog(null)} />
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
      unregister.current = handle
        ? actionRegistry.register([...builtinActions(), ...canvasActions(() => apiRef.current)])
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
  const item = (id: string, label: string, run: () => unknown, hint?: string): MenuNode => ({
    type: "item",
    id,
    label,
    hint,
    run: () => void run(),
  });
  return [
    {
      // Replaces the editor's built-in JSON-only Export submenu.
      id: "canvas.export",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      order: 20,
      label: "Export",
      icon: "download",
      children: () => [
        item("export:png", "Export PNG", () => get().exportPng({ scale: 2 }), "2×"),
        item("export:share", "Copy share link", () => get().copyShareLink()),
        item("export:embed", "Embed code…", () => get().openEmbed()),
        { type: "separator" },
        item("export:json", "Diagram file", () => get().exportNative(), ".diagram.json"),
        item("export:image", "Image…", () => get().openImageOptions(), "PNG or SVG"),
        item("export:drawio", "draw.io", () => get().exportDrawio(), ".drawio"),
        item("export:mermaid-download", "Mermaid file", () => get().downloadMermaid(), ".mmd"),
        item("export:mermaid", "Copy as Mermaid", () => get().copyMermaid()),
      ],
    },
  ];
}
