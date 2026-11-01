import { t } from "../i18n";
import { holdInput } from "../lib/inputHold";
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
import type { ExportResult } from "./exportResult";
import type { ImportResult } from "./importResult";
import type { DiagramFile } from "../model/types";
import type { CanvasHandle } from "../canvas/CanvasView";
import type { View } from "../lib/urlState";
import {
  bindSaveTarget,
  trackDocumentSession,
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
  ROOMS,
  type CanvasPrivacyState,
  type Privacy,
} from "../lib/localOnly";
import { newDiagramsPrivate } from "../lib/privacyPrefs";
import { LINK_OPEN, SHARE_LINKS } from "../lib/deployment";
import { PRIVACY_REQUEST } from "../lib/usePrivacy";
import { EDIT_TOGETHER } from "../lib/roomEntry";
import { loadedCanvasActions } from "../canvas/loadCanvasView";
import { LIMITS, preserveUnknown, serializeNative } from "./native";
import {
  drawioWriter,
  importFiles,
  importText,
  mermaidWriter,
  OPEN_ACCEPT,
  preloadFormats,
  type ImportOutcome,
} from "./formats";
import type { ImportGraph, ImportReport } from "./infra/graph";
import { clearUrlFragment, decodeShare, sharePayloadFromHash, sharePayloadFromInput } from "./share";
import {
  BadEncryptedLinkError,
  encryptedPayloadFromHash,
  encryptedPayloadFromInput,
  parseEncrypted,
} from "./passwordLink";
import { createFileWriter, fsAccessSupported, openWithPicker, slugify, type FileHandle } from "./files";
import { beginObservedWork, observationPorts, sameObservationSource } from "../lib/observations";
import { currentObservationSource } from "../palette/observationSource";
import { deviceProvider } from "./storage/device";
import { CLOUD_PROVIDERS, providerInfo, type ProviderInfo } from "./storage/registry";
import { StorageError, type OpenContext, type StorageEntry, type StorageProvider } from "./storage/types";
import { toast } from "./ui/toast";
import { copyText } from "./ui/copyText";
import {
  EmbedDialog,
  HtmlExportDialog,
  ImageDialog,
  ImportReportDialog,
  OpenLinkDialog,
  PagesDialog,
  PasswordLinkDialog,
  PasteDialog,
  preloadDialogs,
  PrivacyDialog,
  ClearDeviceDialog,
  ShareChooserDialog,
  ShareDialog,
  StorageFilesDialog,
  UnlockDialog,
} from "./ui/lazyDialogs";
import type { EmbedScope } from "./ui/ShareChooser";
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
  /** The diagram asked for (the picker's choice): ahead of `slug` while an example downloads. Defaults to `slug`. */
  requestedSlug?: string;
  canvas: RefObject<CanvasHandle | null>;
  /**
   * Adds the diagram to Your diagrams (bound to `target` for Save) and shows it; returns its slug. Throws if it
   * can't be kept.
   */
  openDiagram: (d: DiagramFile, target?: SaveTarget, sourceSlug?: string) => string | undefined;
  /** Shows a diagram from a share link in the shared slot, apart from the user's own. */
  openShared: (d: DiagramFile) => void;
  /** Public examples can be embedded by name. */
  isPublicExample: (slug: string) => boolean;
  /** Explicit practice destination. Normal Open retains its ownership, handle and provenance behavior. */
  importDestination?: Options["openDiagram"];
  /** Temporary documents supply provenance and privacy changes without acquiring ownership. */
  temporaryPrivacy?: { get(): CanvasPrivacyState; setPrivate(on: boolean): void };
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
  /** File ▸ Share…: every way out, safest first, for `source` (it closes if another diagram opens). */
  | { kind: "chooser"; source: string }
  /**
   * Embed code, for one kind: `private` (Embed in your app, the host-supplied embed; `privateDiagram` says the diagram
   * is private) or `public` (in the link, or `example` by name). The kind never changes while it's open: a public one
   * closes when its diagram turns private.
   */
  | { kind: "embed"; scope: "private"; diagram: DiagramFile; source: string; privateDiagram: boolean }
  | { kind: "embed"; scope: "public"; diagram: DiagramFile; source: string; example?: string }
  | { kind: "image" }
  /** Interactive HTML: the diagram as it was when the dialog opened. */
  | { kind: "html"; diagram: DiagramFile }
  /** Turning Private off for `source`, the document it was opened for (it closes if another one opens). */
  | { kind: "privacy"; source: string }
  /** File ▸ Privacy ▸ Clear everything on this device…: the one confirmation. */
  | { kind: "clear-device" }
  | { kind: "paste" }
  /** The Import report of the diagram open now (an infrastructure import, this tab). */
  | { kind: "report" }
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

/** An import's message download can fail before the operation has an error handler. */
const loadFileMessages = (valid: () => boolean = () => true) =>
  import("./ui/fileMessages").catch(() => {
    if (valid()) toast.error(t("fileDialog.loadFailed"));
  });

/** Why no link was made (or a link dialog closed), with the safe way to share instead: Interactive HTML…. */
function refuseLink(exportHtml: () => void) {
  toast.info(SHARE_LINKS ? t("fileToast.privateLink") : t("fileToast.linksOff"), {
    action: { label: t("export.html"), run: exportHtml, testId: "toast-private-export" },
  });
}

/** Where an import came from, so "Save" can go back there (native files only). */
interface Source {
  name: string;
  target?: SaveTarget;
  /** The diagram this one is made from (Draw everything): it inherits that diagram's privacy. */
  sourceSlug?: string;
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

export function useInterop({
  view,
  slug,
  requestedSlug = slug,
  canvas: canvasRef,
  openDiagram,
  openShared,
  isPublicExample,
  importDestination,
  temporaryPrivacy,
}: Options) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // Dialog imports belong to the dialog that submitted them, including while operation messages download.
  const importSession = useRef(0);
  useLayoutEffect(() => {
    importSession.current++;
  }, [dialog]);
  useEffect(
    () => () => {
      importSession.current++;
    },
    [],
  );
  /**
   * The last import's report, for the diagram it made: in memory only, until another diagram opens. `seen`:
   * that diagram has been open (the import itself switches to it).
   */
  const [imported, setImported] = useState<{
    slug: string;
    report: ImportReport;
    /** Terraform's Draw everything, as data (never the source files). */
    replay?: ImportGraph;
    seen?: boolean;
  } | null>(null);
  const [shownSlug, setShownSlug] = useState(slug);
  if (shownSlug !== slug) {
    setShownSlug(slug);
    if (imported?.slug === slug) setImported({ ...imported, seen: true });
    else if (imported?.seen) setImported(null);
  }
  const report = imported?.slug === slug ? imported.report : undefined;
  const replay = imported?.slug === slug ? imported.replay : undefined;
  if (dialog?.kind === "report" && !report) setDialog(null);
  // The diagram open right now (a save that finishes later compares against it).
  const openSlug = useRef(slug);
  // The diagram asked for: ahead of `slug` while an example still downloads.
  const requested = useRef(requestedSlug);
  useLayoutEffect(() => {
    openSlug.current = slug;
    requested.current = requestedSlug;
  }, [slug, requestedSlug]);
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
      ...(temporaryPrivacy && source === slug ? temporaryPrivacy.get() : getPrivacyFlags(source)),
      ...(import.meta.env.DEV && source === openSlug.current ? { diagram: canvasRef.current?.getDiagram() } : {}),
    }),
    [canvasRef, slug, temporaryPrivacy],
  );
  /** Local-only (built in), Private (the switch) or null. Read when asked, never cached. */
  const privacy = (): Privacy => privacyOf(privacyState());

  // A private diagram never keeps a fragment in the address bar, however it became private (the switch,
  // a paste from a private diagram, another tab). Not on mount: a share link being opened is read first.
  useEffect(() => {
    if (view !== "canvas") return;
    const check = () => {
      if (isLocalOnly(privacyState())) clearUrlFragment();
    };
    window.addEventListener(DIAGRAMS_CHANGED, check);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, check);
  }, [view, privacyState]);

  // ---------------------------------------------------------------- export

  /** The open diagram as a file. A private one says so (`"private": true`), so it stays private when reopened. */
  const current = useCallback((): DiagramFile => {
    const d = canvasRef.current?.getDiagram();
    if (!d) throw new Error(t("fileToast.openADiagramOnTheCanvasFirst"));
    return withPrivacyField(preserveUnknown(d, getOriginal(slug)), isLocalOnly(privacyState()));
  }, [canvasRef, slug, privacyState]);

  const baseName = useCallback((d: DiagramFile) => (isOwnSlug(slug) ? slugify(d.title) : slug), [slug]);

  /** Runs an action, turning any failure into a friendly toast. Called from handlers, never during render. */
  const attempt = async (
    what: import("./ui/fileMessages").FileFailureAction,
    fn: (
      notify: (show: (words: typeof import("./ui/fileMessages")) => void) => void,
      writer: ReturnType<typeof createFileWriter>,
    ) => unknown,
  ): Promise<ExportResult> => {
    // Start the message download beside the operation, without awaiting before a system picker opens.
    const messages = import("./ui/fileMessages");
    messages.catch(() => {});
    const writer = createFileWriter();
    try {
      const result = await fn((show) => {
        // Notifications are best effort. They never delay a file operation or turn its success into failure.
        void messages.then(show).catch(() => {});
      }, writer);
      if (typeof result === "object" && result !== null && "status" in result) {
        if (result.status === "failure" || result.status === "cancelled") return { status: result.status };
      }
      return { status: writer.signal.aborted ? "cancelled" : "success" };
    } catch (err) {
      if (writer.signal.aborted) return { status: "cancelled" };
      if (err instanceof StorageError && err.standalone) toast.error(err.message);
      else
        void messages.then(
          (words) => toast.error(words.fileFailure(what, message(err))),
          () => toast.error(message(err)),
        );
      return { status: "failure" };
    } finally {
      writer.finish();
    }
  };

  const exportNative = () =>
    attempt("diagram", (notify, writer) => {
      const d = current();
      writer.text(serializeNative(d), `${baseName(d)}.diagram.json`, "application/json");
      notify(({ nativeExported }) => toast.success(nativeExported(d.nodes.length, d.edges.length)));
    });

  const exportImage = (kind: "png" | "svg", opts: ImageExportOptions = {}) =>
    attempt({ action: "image", name: kind.toUpperCase() }, async (_, writer) => {
      const d = current();
      // A big diagram takes seconds: the toast shows how far it has got and offers Cancel (Escape too).
      const version = canvasRef.current?.getDocumentVersion();
      const check = () => {
        if (canvasRef.current?.getDocumentVersion() !== version)
          // Reuse the localized export failure + retry messages; no image is downloaded from mixed revisions.
          throw new Error(t("common.tryAgain"));
      };
      const cancel = new AbortController();
      const cancelWork = () => cancel.abort();
      writer.signal.addEventListener("abort", cancelWork, { once: true });
      const release = holdInput(() => cancel.abort());
      const busy = toast.busy(t("fileToast.exportingImage", { format: kind.toUpperCase() }), {
        blocking: true,
        action: { label: t("common.cancel"), run: () => cancel.abort(), testId: "image-export-cancel", focus: true },
      });
      let abort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        abort = () => reject(cancel.signal.reason);
        cancel.signal.addEventListener("abort", abort, { once: true });
      });
      try {
        const { renderDiagramImage } = await Promise.race([import("./image"), aborted]);
        cancel.signal.throwIfAborted();
        check();
        // The picture carries its title, as presentation does (an untitled diagram has none to show).
        const title = d.title.trim();
        const header =
          opts.title !== false && title && title !== UNTITLED
            ? { title, description: d.description?.trim() || undefined }
            : undefined;
        const image = await renderDiagramImage(kind, {
          scale: opts.scale,
          transparent: opts.transparent,
          header,
          signal: cancel.signal,
          onProgress: (done) => toast.progress(busy, done),
          onEscape: () => cancel.abort(),
          check,
        });
        // Cancelled as it finished: still nothing downloaded.
        if (cancel.signal.aborted) {
          toast.dismiss(busy);
          return { status: "cancelled" } as const;
        }
        check();
        const suffix =
          kind === "png" ? `${opts.scale === 1 ? "" : "@2x"}${opts.transparent ? "-transparent" : ""}` : "";
        // A download clicks its temporary anchor; it must no longer be captured by our input hold.
        release();
        writer.blob(image, `${baseName(d)}${suffix}.${kind}`);
        toast.dismiss(busy);
        toast.success(t("fileToast.exportedValue0", { value0: kind.toUpperCase() }));
      } catch (err) {
        if (!cancel.signal.aborted) throw err;
        return { status: "cancelled" } as const;
      } finally {
        writer.signal.removeEventListener("abort", cancelWork);
        cancel.signal.removeEventListener("abort", abort);
        release();
        toast.dismiss(busy);
      }
    });

  const exportDrawio = () =>
    attempt("drawio", async (_, writer) => {
      const d = current();
      const [{ diagramToDrawio, drawioExported }, { inlineIcons }] = await Promise.all([
        drawioWriter(),
        import("./icons"),
      ]);
      const xml = diagramToDrawio(d, { iconSvg: await inlineIcons(d) });
      writer.text(xml, `${baseName(d)}.drawio`, "application/vnd.jgraph.mxfile");
      toast.success(drawioExported(d));
    });

  const copyMermaid = () =>
    attempt("copyMermaid", async () => {
      const d = current();
      const { diagramToMermaid, mermaidCopied, mermaidClipboardDenied } = await mermaidWriter();
      if (await copyText(diagramToMermaid(d))) toast.success(mermaidCopied(d));
      else throw new Error(mermaidClipboardDenied());
    });

  const downloadMermaid = () =>
    attempt("mermaid", async (_, writer) => {
      const d = current();
      const { diagramToMermaid, mermaidDownloaded } = await mermaidWriter();
      writer.text(diagramToMermaid(d), `${baseName(d)}.mmd`, "text/plain");
      toast.success(mermaidDownloaded());
    });

  /** Interactive HTML (src/export): every diagram, Private ones too, like a file saved to this device. */
  const openHtmlExport = () => attempt("html", () => setDialog({ kind: "html", diagram: current() }));

  /**
   * Share links and embeds: the one gate, asked every time a link is about to be made, copied, shown or
   * shared (never only when the command started). A private diagram gets no link, and says why.
   */
  const linkAllowed = (source: string = slug) => {
    if (canShareAsLink(privacyState(source))) return true;
    refuseLink(() => void openHtmlExport());
    return false;
  };
  const linkStillAllowed = (source: string) => canShareAsLink(privacyState(source));

  // A copy deployed without share links (src/lib/deployment.ts) never offers these; `!SHARE_LINKS` folds at
  // build time, so their code (and the link encoders) drops out of that bundle.

  /** The share dialog for `d`, from `source`: only while that document may still be shared. */
  const showShare = (d: DiagramFile, source: string) => {
    if (SHARE_LINKS && linkAllowed(source)) setDialog({ kind: "share", diagram: d, source });
  };

  /** Share… ▸ Share link…: the dialog makes the link and copies it (Copy link, its one action). */
  const openShare = () => attempt("shareLink", () => showShare(current(), slug));

  /** Link with password… for `d`, from `source`: only while that document may still be shared. */
  const showPasswordLink = (d: DiagramFile, source: string) => {
    if (SHARE_LINKS && linkAllowed(source)) setDialog({ kind: "password-link", diagram: d, source });
  };

  /** Share… ▸ Link with password…: the dialog picks the password, encrypts and copies (rechecking the gate). */
  const copyPasswordLink = () => attempt("passwordLink", () => showPasswordLink(current(), slug));

  /**
   * File ▸ Share… (the right-click's Export ▸ Share…, Ctrl+K): every way out, safest first. Only that a diagram is on the
   * canvas: the row picked reads it (a big diagram isn't converted just to show the list).
   */
  const openShareChooser = () =>
    attempt("share", () => {
      if (!canvasRef.current) throw new Error(t("fileToast.openADiagramOnTheCanvasFirst"));
      setDialog({ kind: "chooser", source: slug });
    });

  /**
   * Share… ▸ Embed in your app (`private`: the host's page supplies the diagram, nothing of it goes in a URL; every
   * diagram, private ones too) or Embed on a public page (`public`: in the link, or an example by name).
   */
  const openEmbed = (scope: EmbedScope) =>
    attempt("embed", async () => {
      const source = slug;
      const d = current();
      if (scope === "private") {
        setDialog({ kind: "embed", scope, diagram: d, source, privateDiagram: !linkStillAllowed(source) });
        return;
      }
      if (!SHARE_LINKS || !linkAllowed(source)) return;
      // Embed by name only when the example is public and unedited (the viewer shows the original).
      const original = getOriginal(source);
      const shown = JSON.stringify(canvasRef.current?.getDiagram());
      const pristine = !!original && (await normalized(original)) === shown;
      // The check above can wait for code: the diagram may have become private since. Then there's no public embed.
      if (!linkAllowed(source)) return;
      setDialog({
        kind: "embed",
        scope,
        diagram: d,
        source,
        example: isPublicExample(source) && pristine ? source : undefined,
      });
    });

  // ---------------------------------------------------------------- save

  const saveToDevice = (as = false) =>
    attempt("save", async (notify, writer) => {
      const d = current();
      const text = serializeNative(d);
      const name = `${baseName(d)}.diagram.json`;
      if (!fsSupported) {
        writer.text(text, name, "application/json");
        notify(({ downloadedFile }) => toast.success(downloadedFile(name)));
        return;
      }
      const session = trackDocumentSession(slug);
      try {
        const target = getSaveTarget(slug);
        const bindSession = (target: SaveTarget) => {
          const owner = session.resolve();
          return owner ? bind(owner.slug, target, owner.identity) : false;
        };
        const existing = target?.providerId === DEVICE_PROVIDER ? (target.ref as FileHandle) : undefined;
        if (existing && !as) {
          const file = await deviceProvider.save(existing, text);
          bindSession(deviceTarget(file.ref, Date.now()));
          toast.success(t("fileToast.savedToValue0", { value0: file.name }));
          return;
        }
        const file = await deviceProvider.saveAs(name, text);
        if (!file) return;
        // The destination binds to the diagram that started the save, even if another one is open now.
        const bound = bindSession(deviceTarget(file.ref, Date.now()));
        const stillOpen = openSlug.current === slug;
        notify(({ deviceSaved }) => toast.success(deviceSaved(file.name, d.title, bound, stillOpen)));
      } finally {
        session.dispose();
      }
    });

  /** Save to a cloud provider: over the file this diagram is bound to there, or (`asNew`) a new file. */
  const saveToCloud = (info: ProviderInfo, asNew = false) =>
    attempt({ action: "saveProvider", name: info.label }, async () => {
      const source = slug;
      if (!canSaveToCloud(privacyState(source))) {
        toast.error(t("fileToast.privateDiagramsArentSavedToValue0Save", { value0: info.label }), {
          action: {
            label: t("fileToast.saveToThisDevice"),
            run: () => void saveToDevice(true),
            testId: "toast-private-save-device",
          },
        });
        return;
      }
      const d = current();
      const session = trackDocumentSession(source);
      const stored = getSaveTarget(source);
      // Loading the provider and signing in take time. If this document becomes private meanwhile (the
      // switch, a paste, another tab), the write is cancelled: the provider checks the signal after every
      // token request and the upload carries it, so the captured public copy never lands.
      const cancel = new AbortController();
      const blocked = new StorageError(
        t("fileToast.notSavedToValue0Value1BecamePrivate", { value0: info.label, value1: d.title }),
        undefined,
        true,
      );
      const watch = () => {
        const owner = session.resolve();
        if (!owner || !canSaveToCloud(privacyState(owner.slug))) cancel.abort(blocked);
      };
      window.addEventListener(DIAGRAMS_CHANGED, watch);
      let busy: number | undefined;
      let file: Awaited<ReturnType<StorageProvider["saveAs"]>>;
      try {
        const provider = await info.load();
        watch();
        cancel.signal.throwIfAborted();
        busy = toast.busy(t("fileToast.savingToValue0", { value0: info.label }));
        const content = serializeNative(d);
        file =
          stored?.providerId === info.id && !asNew
            ? await provider.save(stored.ref, content, { signal: cancel.signal })
            : await provider.saveAs(`${baseName(d)}.diagram.json`, content, { signal: cancel.signal });
        watch();
        cancel.signal.throwIfAborted();
      } finally {
        session.dispose();
        window.removeEventListener(DIAGRAMS_CHANGED, watch);
        if (busy !== undefined) toast.dismiss(busy);
      }
      if (!file) return;
      const owner = session.resolve();
      const bound =
        !!owner &&
        bind(owner.slug, { providerId: info.id, ref: file.ref, name: file.name, savedAt: Date.now() }, owner.identity);
      const url = file.url;
      toast.success(
        bound
          ? t("fileToast.savedToValue0AsValue1", { value0: info.label, value1: file.name })
          : t("fileToast.savedValue0ToValue1AsValue2The", { value0: d.title, value1: info.label, value2: file.name }),
        url && /^https:\/\//.test(url)
          ? {
              action: {
                label: t("fileToast.openInValue0", { value0: info.label }),
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
    async (outcome: ImportOutcome, source: Source, valid: () => boolean = () => true): Promise<ImportResult> => {
      const origin = currentObservationSource();
      // Resolve messages before changing the document. A failed chunk leaves a paste/page dialog available to retry.
      const words = await loadFileMessages(valid);
      if (!valid()) return { status: "cancelled" };
      if (!words) return { status: "failure" };
      if (outcome.ok === false) {
        toast.error(t("fileToast.couldntImportValue0Value1", { value0: source.name, value1: outcome.error }));
        return { status: "failure" };
      }
      if (outcome.ok === "pages") {
        setDialog({ kind: "pages", fileName: source.name, pages: outcome.pages, pick: outcome.pick, source });
        return { status: "cancelled" };
      }
      let created: string | undefined;
      try {
        // Only our own format saves back to where it came from (a .drawio file is converted).
        created = (importDestination ?? openDiagram)(
          outcome.diagram,
          outcome.format === "native" ? source.target : undefined,
          source.sourceSlug,
        );
      } catch (err) {
        toast.error(t("fileToast.couldntImportValue0Value1", { value0: source.name, value1: message(err) }));
        return { status: "failure" };
      }
      if (!created) return { status: "cancelled" };
      // The destination policy stays with openDiagram. This fact does not grant sandbox ownership or save a copy.
      if (origin && created)
        observationPorts.imports.publish({ ...origin, format: outcome.format, source: source.name });
      setDialog(null);
      const r = outcome.report;
      if (r && created) {
        setImported({ slug: created, report: r, replay: outcome.replay });
        const { formatImportMessage } = words;
        toast.info(formatImportMessage(r.summary), {
          action: {
            label: t("fileToast.details"),
            run: () => setDialog({ kind: "report" }),
            testId: "toast-import-details",
          },
          // Long enough to read when there's something to check.
          duration: r.guesses.length || r.unread.length || r.pick ? 7000 : undefined,
        });
        return { status: "success" };
      }
      toast.info(words.importedFile(outcome.diagram.title, outcome.format, outcome.warnings), {
        duration: outcome.warnings.length ? 7000 : undefined,
      });
      return { status: "success" };
    },
    [openDiagram, importDestination],
  );

  /** Files from a drop, the file input or Open…: one, or several (a compose file and its overrides). */
  const importFileList = useCallback(
    async (files: readonly File[], target?: SaveTarget, signal?: AbortSignal): Promise<ImportResult> => {
      if (!files.length || signal?.aborted) return { status: "cancelled" };
      const origin = currentObservationSource();
      const work = beginObservedWork(origin);
      const valid = () => {
        const now = currentObservationSource();
        return !signal?.aborted && !work.signal.aborted && (!origin || (!!now && sameObservationSource(origin, now)));
      };
      try {
        const name = files.length === 1 ? files[0].name : t("fileToast.files", { count: files.length });
        // Check the size before reading anything into memory: the limit is for all of them together.
        const size = files.reduce((sum, f) => sum + f.size, 0);
        if (size > LIMITS.maxTextChars) {
          const words = await loadFileMessages(valid);
          if (words) toast.error(words.importTooLarge(name, size));
          return { status: valid() ? "failure" : "cancelled" };
        }
        let read: { name: string; text: string }[];
        try {
          read = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
        } catch {
          if (valid()) toast.error(t("fileToast.couldntReadName", { name: name }));
          return { status: valid() ? "failure" : "cancelled" };
        }
        if (!valid()) return { status: "cancelled" };
        return await handleOutcome(
          await importFiles(read),
          { name, target: files.length === 1 ? target : undefined },
          valid,
        );
      } finally {
        work.finish();
      }
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
  const openFromProvider = async (
    info: ProviderInfo,
    provider: StorageProvider,
    writer: ReturnType<typeof createFileWriter>,
  ) => {
    const file = await provider.open(openContext(info, provider));
    if (!file) return;
    writer.check();
    const target: SaveTarget =
      info.id === DEVICE_PROVIDER
        ? deviceTarget(file.ref as FileHandle)
        : { providerId: info.id, ref: file.ref, name: file.name };
    await handleOutcome(await importText(file.text, file.name), { name: file.name, target }, () => {
      try {
        writer.check();
        return true;
      } catch {
        return false;
      }
    });
  };

  /** Open… (Ctrl+O): this device's file picker (several files at once), or the file input where there's none. */
  const openFile = () =>
    attempt("open", async (_, writer) => {
      if (!fsSupported) {
        fileInput.current?.click();
        return;
      }
      const picked = await openWithPicker(true);
      if (!picked?.length) return;
      writer.check();
      // One file opened here saves back to it (our own format).
      await importFileList(
        picked.map((p) => p.file),
        deviceTarget(picked[0].handle),
      );
    });

  /** File > Open from ▸ <provider>. */
  const openFrom = (id: string) => {
    if (id === DEVICE_PROVIDER) return openFile();
    const info = providerInfo(id);
    if (!info) return Promise.resolve();
    return attempt({ action: "openProvider", name: info.label }, async (_, writer) =>
      openFromProvider(info, await info.load(), writer),
    );
  };

  const importPasted = useCallback(
    async (text: string) => {
      const session = ++importSession.current;
      const origin = currentObservationSource();
      const work = beginObservedWork(origin);
      const valid = () => {
        const now = currentObservationSource();
        return (
          !work.signal.aborted &&
          session === importSession.current &&
          (!origin || (!!now && sameObservationSource(origin, now)))
        );
      };
      try {
        await handleOutcome(await importText(text), { name: t("fileToast.pastedText") }, valid);
      } finally {
        work.finish();
      }
    },
    [handleOutcome],
  );

  const openSharePayload = useCallback(
    async (payload: string) => {
      const busy = toast.busy(t("fileToast.openingTheSharedDiagram"));
      try {
        const d = await decodeShare(payload);
        setDialog(null);
        openShared(d);
        toast.info(t("fileToast.openedTheSharedDiagramValue0ItsKept", { value0: d.title }));
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
      const asked = requested.current;
      // The WebCrypto part loads on use (./passwordLink.ts is all the app carries up front).
      const { decodeEncryptedShare } = await import("./shareCrypto");
      const d = await decodeEncryptedShare(token, password);
      if (session !== unlockSession.current) return;
      // Another diagram opened, or was asked for and is still downloading: the result never replaces it.
      if (openSlug.current !== from || requested.current !== asked)
        throw new Error(t("fileToast.anotherDiagramOpenedWhileThisOneWas"));
      // Stored first: if that fails (storage full or blocked), the prompt shows why and the link stays.
      openShared(d);
      unlockSession.current++;
      // Opened: take the ciphertext out of the address bar and this tab's history entry.
      if (encryptedPayloadFromHash(window.location.hash) === token) clearUrlFragment();
      setDialog(null);
      toast.info(t("fileToast.openedTheSharedDiagramValue0ItsKept", { value0: d.title }));
    },
    [openShared],
  );

  const openShareLinkInput = useCallback(
    (input: string) => {
      if (!LINK_OPEN) return void toast.error(t("fileToast.linkOpenOff"));
      const token = encryptedPayloadFromInput(input);
      if (token) return void askForPassword(token);
      const payload = sharePayloadFromInput(input);
      if (!payload) return void toast.error(t("fileToast.thatDoesntLookLikeALiveDiagrams"));
      void openSharePayload(payload);
    },
    [openSharePayload, askForPassword],
  );

  // Share links: on load and when only the hash changes (a link pasted into this tab).
  useEffect(() => {
    const check = () => {
      // A copy deployed without opening links (src/lib/deployment.ts): the diagram in the fragment is never
      // read, and leaves the address bar.
      if (!LINK_OPEN) {
        const hash = window.location.hash;
        if (encryptedPayloadFromHash(hash) || sharePayloadFromHash(hash)) {
          clearUrlFragment();
          toast.error(t("fileToast.linkOpenOff"));
        }
        return;
      }
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
    attempt("copy", () => {
      const d = current();
      openDiagram(d, undefined, slug);
      toast.success(t("fileToast.savedACopyOfValue0ToYour", { value0: d.title }));
    });

  // ---------------------------------------------------------------- the Private switch

  /**
   * On: your own diagram (or the blank draft) changes in place; an example or a shared diagram becomes a
   * private copy in Your diagrams. Off: one confirmation first (the privacy dialog).
   */
  const setPrivate = (on: boolean) =>
    attempt(on ? "private" : "privacy", () => {
      const kind = privacy();
      if (!on) {
        if (kind === "private") setDialog({ kind: "privacy", source: slug });
        return;
      }
      if (kind) return;
      if (temporaryPrivacy) {
        temporaryPrivacy.setPrivate(true);
        clearUrlFragment();
        toast.success(t("fileToast.private"));
        return;
      }
      if (isLibrarySlug(slug) || slug === DRAFT_SLUG) {
        setDiagramPrivate(slug, true);
        clearUrlFragment();
        const shown = toast.success(t("fileToast.private"));
        // An earlier AI conversation stays unless the person clears it: the toast offers to, when the conversation
        // store (its own chunk) has one for this diagram, in storage or in memory only. Only while nothing has moved
        // on: the same diagram, still private, and that toast still live (showing, or waiting behind another).
        const id = getDiagramIdentity(slug);
        const stillCurrent = () =>
          getDiagramIdentity(openSlug.current) === id && isLocalOnly(getPrivacyFlags(openSlug.current));
        void import("../ai/ui/clearOnPrivate").then(
          (m) => m.offerToClearConversation(id, shown, stillCurrent),
          () => {},
        );
        return;
      }
      const d = current();
      openDiagram(withPrivacyField(d, true), undefined, slug === SHARED_SLUG ? slug : undefined);
      clearUrlFragment();
      toast.success(t("fileToast.savedAPrivateCopyOfValue0To", { value0: d.title }));
    });

  /** Turns Private off for `source` only: the document the confirmation was asked for. */
  const confirmNotPrivate = (source: string) =>
    attempt("privacy", () => {
      setDialog(null);
      if (source !== openSlug.current) return;
      const changed = temporaryPrivacy ? (temporaryPrivacy.setPrivate(false), true) : setDiagramPrivate(source, false);
      if (changed) toast.success(t("fileToast.thisDiagramIsNoLongerPrivate"));
      // The badge that opened the dialog is gone with it: keep the keyboard on the canvas, not the page.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
      });
    });

  // The privacy confirmation is about one document: another one opening (Back, a link, another tab's
  // navigation, even while the dialog's code is still downloading) closes it.
  // So is Share…: its rows act on the diagram open now.
  if ((dialog?.kind === "privacy" || dialog?.kind === "chooser") && dialog.source !== slug) setDialog(null);

  // A share or embed dialog left open closes when its document becomes private (here or in another tab).
  const linkDialogSource =
    dialog?.kind === "share" || dialog?.kind === "embed" || dialog?.kind === "password-link"
      ? dialog.source
      : undefined;
  // Embed in your app stays open (it puts nothing in a URL); every other link dialog closes.
  const linkDialogKind = dialog?.kind === "embed" ? `embed-${dialog.scope}` : dialog?.kind;
  // The refusal's Interactive HTML… acts later, on the diagram open then.
  const exportHtml = useRef(openHtmlExport);
  useLayoutEffect(() => {
    exportHtml.current = openHtmlExport;
  });
  useEffect(() => {
    if (linkDialogSource === undefined) return;
    const check = () => {
      if (canShareAsLink(privacyState(linkDialogSource))) return;
      if (linkDialogKind === "embed-private") {
        setDialog((d) => (d?.kind === "embed" && d.scope === "private" ? { ...d, privateDiagram: true } : d));
        return;
      }
      setDialog(null);
      refuseLink(() => void exportHtml.current());
    };
    window.addEventListener(DIAGRAMS_CHANGED, check);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, check);
  }, [linkDialogSource, linkDialogKind, privacyState]);

  // The badge beside the title asks for the dialog: it explains, and turns Private off on confirmation.
  useEffect(() => {
    const onRequest = () => {
      if (privacy() === "private") setDialog({ kind: "privacy", source: slug });
    };
    window.addEventListener(PRIVACY_REQUEST, onRequest);
    return () => window.removeEventListener(PRIVACY_REQUEST, onRequest);
  });

  // ---------------------------------------------------------------- keyboard

  const api = {
    /** Real Share chooser state, available to product consumers in production too. */
    sharing: dialog?.kind === "chooser",
    /** The same privacy-aware snapshot used by the normal export dialogs. */
    exportSnapshot: current,
    exportNative,
    exportPng: (opts: ImageExportOptions = {}) => exportImage("png", opts),
    exportSvg: () => exportImage("svg"),
    exportImage: (kind: "png" | "svg", opts: ImageExportOptions = {}) => exportImage(kind, opts),
    openImageOptions: () => setDialog({ kind: "image" }),
    openHtmlExport,
    openShareChooser,
    exportDrawio,
    copyMermaid,
    downloadMermaid,
    save,
    saveAs: () => saveToDevice(true),
    saveTo,
    openFile,
    importFiles: importFileList,
    /** Discard in-memory practice import UI on Restart; this never changes ordinary Open's saved binding. */
    resetImports: () => {
      importSession.current++;
      setImported(null);
      setDialog(null);
    },
    openFrom,
    openPaste: () => setDialog({ kind: "paste" }),
    /** The open diagram's Import report, when it came from an infrastructure import in this tab. */
    importReport: report,
    openImportReport: () => setDialog({ kind: "report" }),
    openShareLink: () => setDialog({ kind: "link" }),
    keepSharedCopy,
    /** The open diagram's privacy: "local-only" (built in, always), "private" (the switch) or null. */
    privacy,
    setPrivate,
    setNewDiagramsPrivate: (on: boolean) => newDiagramsPrivate.set(on),
    openClearDevice: () => setDialog({ kind: "clear-device" }),
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
      // Google's sign-in and picker scripts run in this page: never while a private diagram is on screen (it can't
      // be saved to the cloud anyway). Asked again once the provider's code has loaded, of the diagram open then: it
      // may have turned private, or another one opened, meanwhile. Open from ▸ a provider still loads them, on that
      // click.
      const privateNow = () => isLocalOnly(privacyState(openSlug.current));
      if (privateNow()) return;
      for (const info of CLOUD_PROVIDERS)
        void info.load().then(
          (p) => privateNow() || p.preload?.(),
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
        multiple
        onChange={(e) => {
          void importFileList([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
        name="import-file"
        data-testid="import-input"
      />
      <DropOverlay onFiles={(files) => void importFileList(files)} />
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
            toast.info(t("fileToast.signedOutOfValue0", { value0: dialog.info.label }));
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
      {dialog?.kind === "chooser" && (
        <ShareChooserDialog
          privacy={() => privacyOf(privacyState(dialog.source))}
          // Each row hands over to its own dialog (which replaces this one), or saves the file and closes.
          onHtml={() => void openHtmlExport()}
          onFile={() => {
            setDialog(null);
            void exportNative();
          }}
          onEmbed={(scope) => void openEmbed(scope)}
          onPasswordLink={() => void copyPasswordLink()}
          onShareLink={() => void openShare()}
          onEditTogether={
            ROOMS
              ? () => {
                  setDialog(null);
                  window.dispatchEvent(new Event(EDIT_TOGETHER));
                }
              : undefined
          }
          onMakeNotPrivate={() => setDialog({ kind: "privacy", source: dialog.source })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "html" && <HtmlExportDialog diagram={dialog.diagram} onClose={() => setDialog(null)} />}
      {SHARE_LINKS && dialog?.kind === "share" && (
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
      {dialog?.kind === "clear-device" && <ClearDeviceDialog onClose={() => setDialog(null)} />}
      {SHARE_LINKS && dialog?.kind === "password-link" && (
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
            toast.info(t("fileToast.thePasswordprotectedDiagramWasntOpenedReloadThe"));
          }}
        />
      )}
      {dialog?.kind === "embed" && (
        <EmbedDialog
          diagram={dialog.diagram}
          scope={dialog.scope}
          example={dialog.scope === "public" ? dialog.example : undefined}
          allowed={() => linkStillAllowed(dialog.source)}
          privateDiagram={dialog.scope === "private" && dialog.privateDiagram}
          fileName={`${baseName(dialog.diagram)}.diagram.json`}
          onDownload={() => void exportNative()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "paste" && (
        <PasteDialog
          onImport={(t) => void importPasted(t)}
          onClose={() => {
            importSession.current++;
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "report" && report && (
        <ImportReportDialog
          report={report}
          isPrivate={() => !!privacy()}
          onMakePrivate={() => void setPrivate(true)}
          replay={replay}
          onReplay={(outcome) =>
            // Draw everything: made from this diagram, so it keeps this one's privacy whatever New diagrams says.
            handleOutcome(
              outcome.ok === true && privacy()
                ? { ...outcome, diagram: withPrivacyField(outcome.diagram, true) }
                : outcome,
              { name: report.source, sourceSlug: slug },
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "link" && <OpenLinkDialog onOpen={openShareLinkInput} onClose={() => setDialog(null)} />}
      {dialog?.kind === "pages" && (
        <PagesDialog
          fileName={dialog.fileName}
          pages={dialog.pages}
          onPick={(i) => {
            const session = ++importSession.current;
            return handleOutcome(dialog.pick(i), dialog.source, () => session === importSession.current);
          }}
          onClose={() => {
            importSession.current++;
            setDialog(null);
          }}
        />
      )}
    </>
  );

  // Detailed dialog diagnostics remain limited to dev/E2E.
  if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") return { ...api, layer, dialogKind: dialog?.kind };
  return { ...api, layer };
}

export type Interop = ReturnType<typeof useInterop>;
export type InteropApi = Omit<Interop, "layer">;

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
      unregister.current = handle ? loadedCanvasActions()?.registerCanvasActions(() => apiRef.current) : undefined;
    },
    [canvasRef],
  );
}
