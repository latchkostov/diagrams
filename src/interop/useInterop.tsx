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
import { getBindings, getImported, getOriginal, IMPORTED_SLUG, setBinding, SHARED_SLUG } from "../lib/diagramIO";
import { fromFlow, toFlow } from "../canvas/convert";
import { actionRegistry, type Action, type MenuNode } from "../editor/actions";
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
import {
  downloadDataUrl,
  downloadText,
  fsAccessSupported,
  openWithPicker,
  saveWithPicker,
  slugify,
  writeHandle,
  type FileHandle,
} from "./files";
import { driveEnabled, NATIVE_MIME } from "./gdrive/config";
import { toast } from "./ui/toast";
import { copyText } from "./ui/Dialog";
import { EmbedDialog, ImageDialog, OpenLinkDialog, PagesDialog, PasteDialog, ShareDialog } from "./ui/dialogs";
import { DropOverlay } from "./ui/DropOverlay";

// The import / export controller: every way a diagram enters or leaves the app goes through here
// (top-bar menus, the canvas context menu, keyboard shortcuts, drag-and-drop, share links).

export type Slot = typeof IMPORTED_SLUG | typeof SHARED_SLUG;

export interface Binding {
  kind: "device" | "drive";
  name: string;
}

interface Options {
  view: View;
  slug: string;
  canvas: RefObject<CanvasHandle | null>;
  /** Stores the diagram in a slot and shows it on the canvas. */
  openSlot: (slot: Slot, d: DiagramFile) => void;
  /** Public examples can be embedded by name. */
  isPublicExample: (slug: string) => boolean;
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
    };

/** Where an import came from, so "Save" can go back there (native files only). */
interface Source {
  name: string;
  handle?: FileHandle;
  drive?: { id: string; name: string };
}

/** The canvas's canonical form of a file (same as CanvasView's "edited" check). */
const normalized = (d: DiagramFile) => {
  const f = toFlow(d);
  return JSON.stringify(fromFlow(f.meta, f.nodes, f.edges));
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const loadDrive = () => import("./gdrive/google");

export function useInterop({ view, slug, canvas, openSlot, isPublicExample }: Options) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Device file handles per slot (in memory: handles can't go to localStorage). A stable Map held in state.
  const [handles] = useState(() => new Map<string, FileHandle>());
  const [bindingVersion, setBindingVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fsSupported = useMemo(() => fsAccessSupported(), []);

  const binding: Binding | undefined = useMemo(() => {
    void bindingVersion;
    const h = handles.get(slug);
    if (h) return { kind: "device", name: h.name };
    const d = getBindings()[slug];
    return d && driveEnabled ? { kind: "drive", name: d.name } : undefined;
  }, [slug, bindingVersion, handles]);

  const bind = useCallback(
    (target: string, b: { handle?: FileHandle; drive?: { id: string; name: string } } | null) => {
      handles.delete(target);
      setBinding(target, null);
      if (b?.handle) handles.set(target, b.handle);
      if (b?.drive) setBinding(target, { kind: "drive", ...b.drive });
      setBindingVersion((v) => v + 1);
    },
    [handles],
  );

  // ---------------------------------------------------------------- export

  const current = useCallback((): DiagramFile => {
    const d = canvas.current?.getDiagram();
    if (!d) throw new Error("Open a diagram on the canvas first.");
    return preserveUnknown(d, getOriginal(slug));
  }, [canvas, slug]);

  const baseName = useCallback(
    (d: DiagramFile) => (slug === IMPORTED_SLUG || slug === SHARED_SLUG ? slugify(d.title) : slug),
    [slug],
  );

  /** Runs an action, turning any failure into a friendly toast. Called from handlers, never during render. */
  const attempt = async (what: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (err) {
      toast.error(`Couldn't ${what}. ${message(err)}`);
    }
  };

  const exportNative = () =>
    attempt("export the diagram", () => {
      const d = current();
      downloadText(serializeNative(d), `${baseName(d)}.diagram.json`, "application/json");
      toast.success(`Exported ${d.nodes.length} nodes and ${d.edges.length} edges.`);
    });

  const exportImage = (kind: "png" | "svg", opts: { scale?: number; transparent?: boolean } = {}) =>
    attempt(`export the ${kind.toUpperCase()}`, async () => {
      const d = current();
      const busy = toast.busy(`Rendering ${kind.toUpperCase()}…`);
      const { renderDiagramImage } = await import("./image");
      const url = await renderDiagramImage(kind, opts);
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
      const pristine = !!original && normalized(original) === JSON.stringify(canvas.current?.getDiagram());
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
      const existing = handles.get(slug);
      if (existing && !as) {
        await writeHandle(existing, text);
        toast.success(`Saved to ${existing.name}.`);
        return;
      }
      const handle = await saveWithPicker(text, name);
      if (!handle) return;
      bind(slug, { handle });
      toast.success(`Saved to ${handle.name}. Ctrl+S saves here again.`);
    });

  const saveToDrive = (asNew = false) =>
    attempt("save to Google Drive", async () => {
      const d = current();
      const { driveClient } = await loadDrive();
      const busy = toast.busy("Saving to Google Drive…");
      const stored = getBindings()[slug];
      const content = serializeNative(d);
      const file =
        stored && !asNew
          ? await driveClient().update(stored.id, { content, mimeType: NATIVE_MIME })
          : await driveClient().create({ name: `${baseName(d)}.diagram.json`, mimeType: NATIVE_MIME, content });
      toast.dismiss(busy);
      bind(slug, { drive: { id: file.id, name: file.name } });
      toast.success(
        `Saved to Google Drive as ${file.name}.`,
        file.webViewLink
          ? {
              action: {
                label: "Open in Drive",
                run: () => window.open(file.webViewLink, "_blank", "noopener"),
                testId: "toast-open-drive",
              },
            }
          : undefined,
      );
    });

  /** Ctrl+S: back to wherever this diagram came from / was last saved, else ask. */
  const save = () => {
    if (!handles.has(slug) && driveEnabled && getBindings()[slug]) return saveToDrive();
    return saveToDevice();
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
        openSlot(IMPORTED_SLUG, outcome.diagram);
      } catch (err) {
        toast.error(`Couldn't import ${source.name}. ${message(err)}`);
        return;
      }
      setDialog(null);
      // Only native files are saved back in place; a .drawio stays untouched (Save asks for a new file).
      bind(IMPORTED_SLUG, outcome.format === "native" ? { handle: source.handle, drive: source.drive } : null);
      const note = outcome.warnings.length
        ? ` ${outcome.warnings[0]}${outcome.warnings.length > 1 ? ` (+${outcome.warnings.length - 1} more)` : ""}`
        : "";
      const from = outcome.format === "native" ? "" : ` from ${outcome.format === "drawio" ? "draw.io" : "Mermaid"}`;
      toast.info(`Imported “${outcome.diagram.title}”${from}.${note}`, { duration: note ? 7000 : undefined });
    },
    [openSlot, bind],
  );

  const importFile = useCallback(
    async (file: File, handle?: FileHandle) => {
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
      handleOutcome(await importText(text, file.name), { name: file.name, handle });
    },
    [handleOutcome],
  );

  const openFile = () =>
    attempt("open the file", async () => {
      if (!fsSupported) {
        fileInput.current?.click();
        return;
      }
      const picked = await openWithPicker();
      if (picked) await importFile(picked.file, picked.handle);
    });

  const openFromDrive = () =>
    attempt("open from Google Drive", async () => {
      const { pickDriveFile, driveClient } = await loadDrive();
      const picked = await pickDriveFile();
      if (!picked) return;
      const busy = toast.busy(`Opening ${picked.name}…`);
      const file = await driveClient().download(picked.id);
      toast.dismiss(busy);
      handleOutcome(await importText(file.text, file.name), {
        name: file.name,
        drive: { id: file.id, name: file.name },
      });
    });

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
        openSlot(SHARED_SLUG, d);
        bind(SHARED_SLUG, null);
        toast.info(`Opened the shared diagram “${d.title}”. It's kept apart from your own diagrams.`);
      } catch (err) {
        toast.dismiss(busy);
        toast.error(message(err));
      }
    },
    [openSlot, bind],
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

  /** Shared banner: keep the shared diagram as the user's own (the imported slot). */
  const keepSharedCopy = () =>
    attempt("keep a copy", () => {
      const d = current();
      openSlot(IMPORTED_SLUG, d);
      bind(IMPORTED_SLUG, null);
      toast.success(`Kept a copy: “${d.title}” is now your imported diagram.`);
    });

  // ---------------------------------------------------------------- keyboard

  const api = {
    exportNative,
    exportPng: (opts: { scale?: number; transparent?: boolean } = {}) => exportImage("png", opts),
    exportSvg: () => exportImage("svg"),
    exportImage: (kind: "png" | "svg", opts: { scale?: number; transparent?: boolean } = {}) => exportImage(kind, opts),
    openImageOptions: () => setDialog({ kind: "image" }),
    copyShareLink,
    exportDrawio,
    copyMermaid,
    downloadMermaid,
    openShare,
    openEmbed,
    save,
    saveAs: () => saveToDevice(true),
    saveToDrive: (asNew = false) => saveToDrive(asNew),
    openFile,
    openFromDrive,
    openPaste: () => setDialog({ kind: "paste" }),
    openShareLink: () => setDialog({ kind: "link" }),
    keepSharedCopy,
    preloadDrive: () => {
      if (driveEnabled) void loadDrive().then((m) => m.preloadDrive());
    },
    binding,
    fsSupported,
    driveEnabled,
    replacesImported: getImported()?.title,
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

  // ---------------------------------------------------------------- canvas context menu

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    // Register after the canvas module (and its built-in actions) loaded, so ours replace "canvas.export".
    void import("../canvas/CanvasView").then(() => {
      if (!cancelled) off = actionRegistry.register(canvasActions(() => apiRef.current));
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

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

/** File entries for the canvas right-click menu (same names and order as the top bar's File menu). */
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
      id: "canvas.save",
      section: "file",
      targets: ["canvas"],
      order: 10,
      label: () => (get().binding ? `Save to ${get().binding!.name}` : "Save…"),
      icon: "download",
      shortcut: "Mod+S",
      run: () => void get().save(),
    },
    {
      // Replaces the editor's built-in JSON-only Export submenu.
      id: "canvas.export",
      section: "file",
      targets: ["canvas"],
      order: 20,
      label: "Export",
      icon: "download",
      children: () => [
        item("export:png", "PNG image", () => get().exportPng({ scale: 2 }), "2×"),
        item("export:share", "Copy share link", () => get().copyShareLink()),
        { type: "separator" },
        item("export:json", "Diagram file", () => get().exportNative(), ".diagram.json"),
        item("export:image", "Image…", () => get().openImageOptions(), "PNG / SVG"),
        item("export:drawio", "draw.io", () => get().exportDrawio(), ".drawio"),
        item("export:mermaid", "Copy as Mermaid", () => get().copyMermaid()),
        item("export:mermaid-download", "Mermaid file", () => get().downloadMermaid(), ".mmd"),
        item("export:embed", "Embed code…", () => get().openEmbed()),
      ],
    },
    {
      id: "canvas.import",
      section: "file",
      targets: ["canvas"],
      order: 30,
      label: "Import",
      icon: "upload",
      children: () => [
        { type: "item", id: "import:file", label: "Open…", shortcut: "Mod+O", run: () => void get().openFile() },
        ...(get().driveEnabled ? [item("import:drive", "Open from Google Drive…", () => get().openFromDrive())] : []),
        item("import:paste", "Paste text…", () => get().openPaste()),
        item("import:link", "Share link…", () => get().openShareLink()),
      ],
    },
  ];
}
