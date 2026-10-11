import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { examples, themeLabel } from "./examples";
import { TopBar, type ExampleOption } from "./components/TopBar";
import type { CanvasHandle } from "./canvas/CanvasView";
import type { OpenTarget } from "./lab/LabView";
import type { DiagramFile } from "./model/types";
import { useUrlState, type View } from "./lib/urlState";
import {
  clearShared,
  createLibraryDiagram,
  deleteLibraryDiagram,
  DRAFT_SLUG,
  duplicateLibraryDiagram,
  getDiagramIdentity,
  newDraft,
  OPEN_LIBRARY,
  renameLibraryDiagram,
  resolveSlug,
  type SaveTarget,
  setShared,
  SHARED_SLUG,
  UNTITLED,
  writeAutosave,
} from "./lib/diagramIO";
import { useLibrary } from "./lib/useLibrary";
import { diagramThumb } from "./lib/thumbnail";
import { Icon } from "./components/Icon";
import { LibraryDialog } from "./components/LibraryDialog";
import { formatAgo } from "./lib/time";
import { lastCanvas, rememberCanvas } from "./lib/canvasBridge";
import type { StartOptions } from "./canvas/StartCard";
import { useInterop, useInteropCanvasActions } from "./interop/useInterop";
import { notify } from "./interop/ui/toast";
import { Toaster } from "./interop/ui/Toaster";
import { EmbedView } from "./interop/embed/EmbedView";
import { CommandPalette } from "./palette/CommandPalette";
import { AiMount } from "./ai/ui/AiMount";
import "./styles/interop.css";

// Views are code-split: the gallery and canvas each pull in their own weight (React Flow lives
// with the canvas), and the Lab never downloads unless someone opens ?view=lab.
const GalleryView = lazy(() => import("./gallery/GalleryView").then((m) => ({ default: m.GalleryView })));
const CanvasView = lazy(() => import("./canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const LabView = lazy(() => import("./lab/LabView").then((m) => ({ default: m.LabView })));

// Public examples by file name (the glob doesn't descend into ./private, which only loads in dev).
const publicSlugs = new Set(
  Object.keys(import.meta.glob("./examples/*.json")).map((p) => p.slice("./examples/".length, -".json".length)),
);

export function App() {
  // ?embed=1 renders the read-only viewer only: no top bar, no editor.
  const embed = useMemo(() => new URLSearchParams(window.location.search).get("embed") === "1", []);
  return (
    <>
      {embed ? <EmbedView /> : <MainApp />}
      <Toaster />
    </>
  );
}

function MainApp() {
  const [url, setUrl] = useUrlState();
  const canvasRef = useRef<CanvasHandle>(null);
  // Your diagrams and the shared slot, re-read when they change (here or in another tab).
  const library = useLibrary();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryUndo, setLibraryUndo] = useState<{ message: string; run: () => void } | null>(null);

  // No diagram in the URL: reopen the last one, else your most recent, else a blank draft (the start card).
  const valid = (s: string | undefined): s is string =>
    !!s &&
    (s === DRAFT_SLUG ||
      library.entries.some((e) => e.slug === s) ||
      (s === SHARED_SLUG && !!library.shared) ||
      examples.some((e) => e.slug === s));
  const requested = url.example ? resolveSlug(url.example) : undefined;
  const remembered = lastCanvas();
  const slug = valid(requested)
    ? requested
    : remembered && valid(resolveSlug(remembered))
      ? resolveSlug(remembered)
      : (library.entries[0]?.slug ?? DRAFT_SLUG);

  // Identity changes only when the open document is replaced. It stays put when a blank draft
  // becomes a library entry on its first edit, so the canvas doesn't remount.
  const canvasIdentity = getDiagramIdentity(slug);
  // The open diagram's title as it's typed: the picker follows it before the autosave lands.
  const [openTitle, setOpenTitle] = useState<{ identity: string; title: string } | null>(null);
  const onTitleChange = useCallback(
    (title: string) => setOpenTitle({ identity: canvasIdentity, title }),
    [canvasIdentity],
  );
  const liveTitle = (fallback: string) =>
    openTitle?.identity === canvasIdentity ? openTitle.title.trim() || UNTITLED : fallback;

  // Your diagrams (most recent first, an open blank draft on top), then a shared diagram, then the examples.
  const options: ExampleOption[] = [
    ...(slug === DRAFT_SLUG ? [{ slug: DRAFT_SLUG, title: liveTitle(UNTITLED), group: "yours" as const }] : []),
    ...library.entries.map((e) => ({
      slug: e.slug,
      title: e.slug === slug ? liveTitle(e.title) : e.title,
      group: "yours" as const,
    })),
    ...(library.shared
      ? [
          {
            slug: SHARED_SLUG,
            title: `${slug === SHARED_SLUG ? liveTitle(library.shared.title) : library.shared.title} (shared)`,
            group: "yours" as const,
          },
        ]
      : []),
    ...examples.map((e) => ({
      slug: e.slug,
      title: e.diagram.title,
      group: "examples" as const,
      theme: e.theme && { id: e.theme, label: themeLabel(e.theme) },
    })),
  ];

  // "Your diagrams": the open diagram's pending edits are saved first, so the list is current.
  const refreshLibrary = library.refresh;
  const openLibrary = useCallback(() => {
    setLibraryError(null);
    canvasRef.current?.flush();
    refreshLibrary();
    setLibraryOpen(true);
  }, [refreshLibrary]);
  // ...from anywhere (e.g. the storage warning's button).
  useEffect(() => {
    window.addEventListener(OPEN_LIBRARY, openLibrary);
    return () => window.removeEventListener(OPEN_LIBRARY, openLibrary);
  }, [openLibrary]);

  // Normalise the URL once we know which example is shown.
  useEffect(() => {
    if (url.view !== "canvas") return;
    if (url.example !== slug) setUrl({ example: slug }, { replace: true });
    // A bare URL reopens this one next time (a draft that became an entry is remembered as the entry).
    rememberCanvas(slug);
  }, [url.view, url.example, slug, setUrl]);

  // Once the diagram is up, fetch the stencil library in the background so the tab opens instantly.
  useEffect(() => {
    if (url.view !== "canvas") return;
    const t = setTimeout(() => void import("./gallery/GalleryView").catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [url.view]);

  useEffect(() => {
    if (!url.present) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUrl({ present: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url.present, setUrl]);

  /** Open, Import, Paste, the Lab and "Save a copy": a new entry in Your diagrams, never a replacement. */
  const openDiagram = useCallback(
    (d: DiagramFile, target?: SaveTarget, sourceSlug?: string) => {
      // Validates and stores first; on failure the current diagram stays (and the caller reports why).
      const created = createLibraryDiagram(d, target, undefined, { sourceSlug });
      if (slug === SHARED_SLUG) clearShared();
      setUrl({ view: "canvas", example: created, present: false });
    },
    [setUrl, slug],
  );
  const openShared = useCallback(
    (d: DiagramFile) => {
      setShared(d);
      setUrl({ view: "canvas", example: SHARED_SLUG, present: false });
    },
    [setUrl],
  );

  /** File > New diagram: a blank draft. Nothing is replaced, so there's nothing to undo. */
  const newDiagram = useCallback(() => {
    canvasRef.current?.flush();
    newDraft();
    setUrl({ view: "canvas", example: DRAFT_SLUG, present: false });
  }, [setUrl]);

  const interop = useInterop({
    view: url.view,
    slug,
    canvas: canvasRef,
    openDiagram,
    openShared,
    isPublicExample: (s) => publicSlugs.has(s),
  });

  // ---------------------------------------------------------------- Your diagrams (the library)

  const failed = (what: string, err: unknown) => {
    const message = `Couldn't ${what}. ${err instanceof Error ? err.message : String(err)}`;
    setLibraryError(message);
    notify(message, { kind: "error" });
  };
  // CanvasHandle.flush currently hides persistence failures. Persist its live snapshot
  // through the result-bearing API before any action that depends on stored content.
  const saveForLibraryAction = (target: string): boolean => {
    setLibraryError(null);
    if (target !== slug || !canvasRef.current) return true;
    if (writeAutosave(target, canvasRef.current.getDiagram(), canvasIdentity)) return true;
    failed("save your edits", new Error("Storage is full or blocked. Save or export this diagram before continuing."));
    return false;
  };
  const titleOf = (target: string) => library.entries.find((e) => e.slug === target)?.title ?? UNTITLED;
  const libraryActions = {
    onOpen: (example: string) => setUrl({ view: "canvas", example, present: false }),
    onNew: newDiagram,
    onRename: (target: string, title: string) => {
      setLibraryError(null);
      // The open diagram is renamed through its canvas: an undoable edit that the autosave keeps.
      if (target === slug && canvasRef.current) return canvasRef.current.setTitle(title);
      try {
        renameLibraryDiagram(target, title);
      } catch (err) {
        failed("rename it", err);
      }
    },
    onDuplicate: (target: string) => {
      if (!saveForLibraryAction(target)) return;
      try {
        const copy = duplicateLibraryDiagram(target);
        notify(`Duplicated “${titleOf(target)}”.`, {
          kind: "success",
          action: {
            label: "Open",
            run: () => {
              setLibraryOpen(false);
              setUrl({ view: "canvas", example: copy, present: false });
            },
            testId: "duplicate-open",
          },
        });
      } catch (err) {
        failed("duplicate it", err);
      }
    },
    onDelete: (target: string) => {
      const wasOpen = target === slug;
      if (!saveForLibraryAction(target)) return;
      const title = titleOf(target);
      let undo: () => boolean;
      try {
        undo = deleteLibraryDiagram(target);
      } catch (err) {
        return failed("delete it", err);
      }
      if (wasOpen) {
        // On to the most recent other diagram, or a blank one.
        const next = library.entries.find((e) => e.slug !== target)?.slug;
        if (!next) newDraft();
        setUrl({ view: "canvas", example: next ?? DRAFT_SLUG, present: false }, { replace: true });
      }
      const message = `Deleted “${title}”.`;
      const restore = () => {
        if (!undo()) return failed("restore it", new Error("The browser's storage is full."));
        setLibraryUndo(null);
        setLibraryError(null);
        if (wasOpen) setUrl({ view: "canvas", example: target, present: false });
      };
      setLibraryUndo({ message, run: restore });
      notify(message, {
        action: {
          label: "Undo",
          run: restore,
          testId: "delete-undo",
        },
      });
    },
  };

  const canvasCallbackRef = useInteropCanvasActions(canvasRef, interop);

  const onLabOpen = (target: OpenTarget) => {
    if ("slug" in target) return setUrl({ view: "canvas", example: target.slug, present: false });
    try {
      openDiagram(target.diagram);
    } catch (err) {
      notify(`Couldn't open it. ${err instanceof Error ? err.message : String(err)}`, { kind: "error" });
    }
  };
  const presenting = url.view === "canvas" && url.present;
  // The start card on a blank canvas: your recent diagrams, then public examples only (private ones
  // never appear in UI copy). Thumbnails come from the same renderer as Your diagrams.
  const exampleThumbs = useMemo(
    () =>
      examples
        .filter((e) => publicSlugs.has(e.slug))
        .map((e) => ({
          slug: e.slug,
          title: e.diagram.title,
          description: e.summary ?? e.diagram.description,
          thumb: diagramThumb(e.diagram),
          theme: e.theme && themeLabel(e.theme),
          featured: e.featured,
        })),
    [],
  );
  const start: StartOptions = {
    recent: library.entries
      .filter((e) => e.slug !== slug)
      .map((e) => ({
        slug: e.slug,
        title: e.title,
        detail: `${e.nodes} ${e.nodes === 1 ? "node" : "nodes"} · edited ${formatAgo(e.updatedAt)}`,
        thumb: e.thumb,
      })),
    examples: exampleThumbs,
    onOpen: (example) => setUrl({ example }),
    onOpenFile: () => void interop.openFile(),
    onPaste: interop.openPaste,
    onLibrary: openLibrary,
  };
  const goTo = (view: View) => setUrl({ view, present: false });

  return (
    <div className={`app${presenting ? " is-presenting" : ""}`}>
      {!presenting && (
        <TopBar
          view={url.view}
          onView={goTo}
          exampleOptions={options}
          example={slug}
          onExample={(example) => setUrl({ example })}
          interop={interop}
          shared={
            url.view === "canvas" && slug === SHARED_SLUG ? { onKeep: () => void interop.keepSharedCopy() } : undefined
          }
          onPresent={() => setUrl({ present: true })}
          onNewDiagram={newDiagram}
          onLibrary={openLibrary}
          libraryCount={library.entries.length}
        />
      )}
      <div className="app-body">
        <ViewBoundary
          // Remount (and clear the error) when the user navigates elsewhere.
          resetKey={`${url.view}:${url.view === "canvas" ? canvasIdentity : ""}`}
          view={url.view}
          onClearAutosave={url.view === "canvas" ? () => writeAutosave(slug, null) : undefined}
          onGoGallery={() => goTo("gallery")}
        >
          <Suspense fallback={<ViewLoading />}>
            {url.view === "gallery" ? (
              <GalleryView />
            ) : url.view === "lab" ? (
              <LabView onOpen={onLabOpen} />
            ) : (
              <CanvasView
                key={canvasIdentity}
                ref={canvasCallbackRef}
                slug={slug}
                presenting={presenting}
                onExitPresent={() => setUrl({ present: false })}
                start={start}
                onTitleChange={onTitleChange}
              />
            )}
          </Suspense>
        </ViewBoundary>
      </div>
      {interop.layer}
      {libraryOpen && (
        <LibraryDialog
          entries={library.entries.map((e) => (e.slug === slug ? { ...e, title: liveTitle(e.title) } : e))}
          current={slug}
          error={libraryError}
          undo={libraryUndo}
          onClose={() => setLibraryOpen(false)}
          {...libraryActions}
        />
      )}
      <CommandPalette
        view={url.view}
        diagrams={options.filter((o) => o.group !== "examples" || publicSlugs.has(o.slug))}
        currentSlug={slug}
        onOpenDiagram={(example) => setUrl({ view: "canvas", example, present: false })}
      />
      <AiMount view={url.view} presenting={presenting} onNewDiagram={newDiagram} />
    </div>
  );
}

function ViewLoading() {
  return (
    <div className="view-loading" data-testid="view-loading" role="status" style={centered}>
      <span style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</span>
    </div>
  );
}

const centered = { position: "absolute", inset: 0, display: "grid", placeItems: "center" } as const;

const viewName: Record<View, string> = { gallery: "the stencil library", canvas: "the diagram", lab: "the Lab" };

interface BoundaryProps {
  resetKey: string;
  view: View;
  onClearAutosave?: () => void;
  onGoGallery: () => void;
  children: ReactNode;
}

/** Catches a crashing view and offers a way out instead of a blank page. */
class ViewBoundary extends Component<BoundaryProps, { error: Error | null; key: string; cleared: boolean }> {
  state = { error: null as Error | null, key: this.props.resetKey, cleared: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey, cleared: false } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[diagrams] ${this.props.view} view crashed`, error, info.componentStack);
  }

  render() {
    const { error, cleared } = this.state;
    if (!error) return this.props.children;
    const { view, onClearAutosave, onGoGallery } = this.props;
    // A failed lazy chunk (e.g. after a redeploy) is fixed by reloading, not by retrying.
    const chunkFailed = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
      error.message,
    );
    return (
      <div style={centered} data-testid="error-boundary" role="alert">
        <div
          style={{
            maxWidth: 460,
            padding: "24px 26px",
            borderRadius: "var(--radius-l)",
            border: "1px solid var(--line)",
            background: "var(--surface)",
            boxShadow: "var(--node-shadow)",
            display: "grid",
            gap: 12,
          }}
        >
          <strong style={{ fontSize: 16, letterSpacing: "-0.01em" }}>Something went wrong in {viewName[view]}.</strong>
          <p style={{ margin: 0, color: "var(--text-2)" }}>
            {chunkFailed
              ? "Part of the app couldn't be downloaded. This usually happens after an update: reloading fixes it."
              : view === "canvas"
                ? "Your other diagrams are safe. If this one keeps failing, its saved edits may be the cause: clearing them restores the original."
                : "Try again, or open the stencil library."}
          </p>
          <code
            style={{
              fontSize: 11.5,
              color: "var(--text-3)",
              overflowWrap: "anywhere",
              maxHeight: 96,
              overflow: "auto",
            }}
            data-testid="error-message"
          >
            {error.message}
          </code>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chunkFailed ? (
              <button className="btn btn-primary" onClick={() => window.location.reload()} data-testid="error-reload">
                <Icon name="reset" size={14} /> Reload
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => this.setState({ error: null })}
                data-testid="error-retry"
              >
                <Icon name="reset" size={14} /> Try again
              </button>
            )}
            {onClearAutosave && !chunkFailed && (
              <button
                className="btn"
                disabled={cleared}
                onClick={() => {
                  onClearAutosave();
                  this.setState({ error: null, cleared: true });
                }}
                data-testid="error-clear-autosave"
              >
                Clear saved edits for this diagram
              </button>
            )}
            {view !== "gallery" && (
              <button className="btn" onClick={onGoGallery} data-testid="error-go-gallery">
                <Icon name="grid" size={14} /> Open stencils
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
