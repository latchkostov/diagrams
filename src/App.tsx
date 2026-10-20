import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { examples, exampleSummary, getLoadedExample, loadExample } from "./examples";
import { currentExampleSlug } from "./examples/retired";
import { groupByTheme, themeInfo } from "./examples/themes";
import { TopBar, type ExampleOption } from "./components/TopBar";
import type { CanvasHandle } from "./canvas/CanvasView";
import { LazyCanvasView as CanvasView, preloadCanvasView } from "./canvas/loadCanvasView";
import type { OpenTarget } from "./lab/LabView";
import type { DiagramFile } from "./model/types";
import { showDiagram, useUrlState, type View } from "./lib/urlState";
import {
  clearShared,
  createLibraryDiagram,
  deleteLibraryDiagram,
  DEVICE_PROVIDER,
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
import { newDiagramsPrivate } from "./lib/privacyPrefs";
import { Icon } from "./components/Icon";
import { formatAgo } from "./i18n/relativeTime";
import { stopStorageWrites } from "./lib/storage";
import { lastCanvas, rememberCanvas } from "./lib/canvasBridge";
import type { StartOptions } from "./canvas/StartCard";
import { useInterop, useInteropCanvasActions } from "./interop/useInterop";
import { notify } from "./interop/ui/toast";
import { Toaster } from "./interop/ui/Toaster";
import { loadingDialog, preloadDialogs } from "./interop/ui/lazyDialogs";
import { CommandPalette } from "./palette/CommandPalette";
import { paletteHost } from "./palette/host";
import { lazyComponent, LOAD_FAILED, loadOnce, whenIdle } from "./lib/lazyLoad";
import { EDIT_TOGETHER, roomEntryPending, roomInAddress, roomTabPending } from "./lib/roomEntry";
import { AiMount } from "./ai/ui/AiMount";
import { unseen } from "./ai/ui/unseen";
import { AI_PANEL } from "./lib/deployment";
import { t, useLocale } from "./i18n";
import "./styles/interop.css";

// Views are code-split: the gallery and canvas each pull in their own weight (React Flow lives
// with the canvas), and the Lab never downloads unless someone opens ?view=lab (dev and e2e builds only: a production
// build has no Lab, LAB in ./lib/urlState).
const GalleryView = lazy(() => import("./gallery/GalleryView").then((m) => ({ default: m.GalleryView })));
// The condition is spelled out (not LAB) so the bundler folds it here and drops the chunk from production builds.
const LabView =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? lazy(() => import("./lab/LabView").then((m) => ({ default: m.LabView })))
    : () => null;
/**
 * Rooms (Edit together; src/collab/room): their code, Yjs included, loads only for a page with a room to open or when
 * one is asked for. In development and e2e builds, and in production with VITE_ENABLE_COLLAB=1 (ROOMS in
 * ./lib/localOnly). Spelled out from the build's own literals (scripts/deployment-env.ts defines them), not the
 * constants src/lib/deployment.ts exports: those fold only after the module graph is known, so a build without rooms
 * would still see this import, and the code the room shares with the canvas would leave the canvas's own chunk.
 */
declare const __DEPLOYMENT_COLLAB__: boolean;
type RoomsModule = typeof import("./collab/room");
const loadRooms =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1" || __DEPLOYMENT_COLLAB__
    ? loadOnce(() => import("./collab/room"))
    : undefined;
const noRoomSubscribe = () => () => {};
const noRoomSnapshot = () => undefined;

/**
 * The room module once this page needs it, configured with how to show a diagram and read the canvas. `resuming`:
 * this tab was in a room before a reload, and it isn't open again yet (the canvas waits rather than show the copy).
 */
function useRooms(view: View, page: { navigate(slug: string): void; capture(slug: string): DiagramFile | undefined }) {
  const [rooms, setRooms] = useState<RoomsModule | null>(null);
  const [resuming, setResuming] = useState(() => !!loadRooms && roomTabPending());
  const pageRef = useRef(page);
  useLayoutEffect(() => {
    pageRef.current = page;
  });
  useEffect(() => {
    if (!loadRooms || view === "lab") return;
    let active = true;
    const load = (then: (m: RoomsModule) => unknown) =>
      loadRooms().then(
        (m) => {
          if (!active) return;
          m.room.configure({
            navigate: (slug) => pageRef.current.navigate(slug),
            capture: (slug) => pageRef.current.capture(slug),
          });
          setRooms(m);
          return then(m);
        },
        () => {
          setResuming(false);
          notify(LOAD_FAILED, { kind: "error" });
        },
      );
    if (roomEntryPending())
      void load(async (m) => {
        try {
          m.room.readAddress();
          await m.room.resume();
        } finally {
          setResuming(false);
        }
      });
    const onAddress = () => {
      if (roomInAddress()) void load((m) => m.room.readAddress());
    };
    const onStart = () => void load((m) => m.room.requestStart());
    window.addEventListener("hashchange", onAddress);
    window.addEventListener(EDIT_TOGETHER, onStart);
    return () => {
      active = false;
      window.removeEventListener("hashchange", onAddress);
      window.removeEventListener(EDIT_TOGETHER, onStart);
    };
  }, [view]);
  const snapshot = useSyncExternalStore(
    rooms?.room.subscribe ?? noRoomSubscribe,
    rooms?.room.getSnapshot ?? noRoomSnapshot,
  );
  return { rooms, snapshot, resuming };
}

/** Your diagrams: loads when the app is idle, or when first opened. */
let libraryMessages: typeof import("./interop/ui/fileMessages");
const LibraryDialog = lazyComponent(
  () =>
    Promise.all([import("./components/LibraryDialog"), import("./interop/ui/fileMessages")]).then(
      ([dialog, messages]) => {
        libraryMessages = messages;
        return dialog.LibraryDialog;
      },
    ),
  loadingDialog(() => t("topbar.yourDiagrams")),
);
const ExamplesDialog = lazyComponent(
  () => import("./components/ExamplesDialog").then((m) => m.ExamplesDialog),
  loadingDialog(() => t("topbar.examples")),
);
// ?embed=1 renders the read-only viewer only: no top bar, no editor.
// Any `embed` parameter (the links say embed=1): the same rule as the CSP that lets other sites frame
// embeds and nothing else (scripts/security-headers.ts), so no URL gets the app in a frame.
const EMBED = new URLSearchParams(window.location.search).has("embed");
const EmbedView = lazyComponent(() => import("./interop/embed/EmbedView").then((m) => m.EmbedView));
// The viewer always shows a canvas: fetch both at once rather than one after the other.
if (EMBED) {
  stopStorageWrites();
  EmbedView.preload();
  preloadCanvasView();
}

// Only public examples appear in prompts, the palette and the start card.
const publicSlugs = new Set(examples.filter((e) => !e.localOnly).map((e) => e.slug));

export function App() {
  return (
    <>
      {EMBED ? <EmbedView /> : <MainApp />}
      <Toaster />
    </>
  );
}

function MainApp() {
  // A new language re-renders the app (the start card's lines, the picker's groups).
  const locale = useLocale();
  const [url, setUrl] = useUrlState();
  const canvasRef = useRef<CanvasHandle>(null);
  useEffect(() => () => paletteHost.cancelRun(), []);
  // Your diagrams and the shared slot, re-read when they change (here or in another tab).
  const library = useLibrary();
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!copyNotice) return;
    const timer = setTimeout(() => setCopyNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [copyNotice]);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [exampleFocus, setExampleFocus] = useState<{ slug: string; request: number } | null>(null);
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
  const requested = url.example ? resolveSlug(currentExampleSlug(url.example)) : undefined;
  const lastSeen = lastCanvas();
  const remembered = lastSeen && currentExampleSlug(lastSeen);
  const targetSlug = valid(requested)
    ? requested
    : remembered && valid(resolveSlug(remembered))
      ? resolveSlug(remembered)
      : (library.entries[0]?.slug ?? DRAFT_SLUG);

  // Keep the mounted canvas (and its edits) until the requested example is ready. The
  // cleanup also prevents a slow import from replacing a newer navigation. Meanwhile the picker
  // shows targetSlug (the pending selection), so keyboard navigation moves on from it.
  const waitingForExample = examples.some((e) => e.slug === targetSlug) && !getLoadedExample(targetSlug);
  const [loadedSlug, setLoadedSlug] = useState<string | undefined>(() => (waitingForExample ? undefined : targetSlug));
  // Stored documents and cached examples still open synchronously, including Lab imports.
  const displayedSlug = waitingForExample ? loadedSlug : targetSlug;
  const slug = displayedSlug ?? DRAFT_SLUG;
  useEffect(() => {
    if (url.view !== "canvas") return;
    let active = true;
    // On a cold start nothing is mounted yet: fetch the canvas code beside the example.
    if (waitingForExample) preloadCanvasView();
    const ready = waitingForExample ? loadExample(targetSlug) : Promise.resolve();
    void ready.then(
      () => active && setLoadedSlug(targetSlug),
      () => {
        if (!active) return;
        notify("Couldn't load that example. Check your connection and try again, or reload the app.", {
          kind: "error",
        });
        setLoadedSlug(slug);
        setUrl({ example: slug }, { replace: true });
      },
    );
    return () => {
      active = false;
    };
  }, [targetSlug, waitingForExample, url.view, slug, setUrl]);

  // Identity changes only when the open document is replaced. It stays put when a blank draft
  // becomes a library entry on its first edit, so the canvas doesn't remount.
  const canvasIdentity = getDiagramIdentity(slug);
  // A copy is a new document, but keeps this canvas mount and its Undo history.
  const [canvasMount, setCanvasMount] = useState({ identity: canvasIdentity, key: 0 });
  if (canvasMount.identity !== canvasIdentity) setCanvasMount({ identity: canvasIdentity, key: canvasMount.key + 1 });
  // The live keys in the URL (live, sim, traffic, ...) describe the diagram on screen, which can differ
  // from the URL's example while one is loading. A layout effect, so it's current before the live
  // view's effects write them.
  const canvasShown = url.view === "canvas" && displayedSlug !== undefined;
  useLayoutEffect(() => {
    const pending = paletteHost.get().pendingRun;
    if (pending && (url.view !== "canvas" || pending.documentId !== getDiagramIdentity(targetSlug)))
      paletteHost.cancelRun();
  }, [url.view, targetSlug]);
  useLayoutEffect(() => {
    showDiagram(canvasShown ? { identity: canvasIdentity, example: slug } : null);
  }, [canvasShown, canvasIdentity, slug]);
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
      title: e.title,
      group: "examples" as const,
      localOnly: e.localOnly,
      theme: e.theme && themeInfo(e.theme),
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
    if (displayedSlug !== targetSlug) return;
    if (url.example !== slug) setUrl({ example: slug }, { replace: true });
    // A bare URL reopens this one next time (a draft that became an entry is remembered as the entry).
    rememberCanvas(slug);
  }, [url.view, url.example, slug, displayedSlug, targetSlug, setUrl]);

  // Once a diagram is on screen and the app is idle, fetch the stencil library, the dialogs and Your
  // diagrams in the background, so they open at once. (The editable canvas publishes itself when it mounts.)
  // Not while live view runs: its animation comes first; this waits until the person is back to editing.
  const canvasUp = useSyncExternalStore(paletteHost.subscribe, () => {
    const canvas = paletteHost.get().canvas;
    return canvas !== null && !canvas.live;
  });
  useEffect(() => {
    if (url.view !== "canvas" || !canvasUp) return;
    return whenIdle(() => {
      void import("./gallery/GalleryView").catch(() => {});
      preloadDialogs();
      LibraryDialog.preload();
    });
  }, [url.view, canvasUp]);

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
      // "New diagrams are private" covers what comes in from this device; a cloud file keeps saving back there.
      const fromCloud = !!target && target.providerId !== DEVICE_PROVIDER;
      const created = createLibraryDiagram(d, target, undefined, {
        sourceSlug,
        private: !fromCloud && newDiagramsPrivate.get(),
      });
      if (slug === SHARED_SLUG) clearShared();
      setUrl({ view: "canvas", example: created, present: false });
      return created;
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

  // Rooms: a joiner's new entry opens here; a room that ends keeps what its canvas shows.
  const shownSlug = useRef(slug);
  useLayoutEffect(() => {
    shownSlug.current = slug;
  });
  const {
    rooms,
    snapshot: roomSnap,
    resuming,
  } = useRooms(url.view, {
    navigate: (example) => setUrl({ view: "canvas", example, present: false }),
    capture: (target) => (shownSlug.current === target ? canvasRef.current?.getDiagram() : undefined),
  });
  const openRoom = roomSnap?.open;
  const roomHere = openRoom?.slug !== undefined && openRoom.slug === slug ? openRoom : undefined;
  // Read once per room canvas mount (when its document is ready): later changes reach the canvas through the room.
  const roomSession = roomHere?.session;
  const roomReady = !!roomHere?.ready;
  const roomInitial = useMemo(
    () => (roomReady ? roomSession?.doc.project().diagram : undefined),
    [roomSession, roomReady],
  );
  const roomBusy = resuming || !!roomSnap?.opening || (!!openRoom && openRoom.slug === undefined);

  const interop = useInterop({
    view: url.view,
    slug,
    requestedSlug: targetSlug,
    canvas: canvasRef,
    openDiagram,
    openShared,
    isPublicExample: (s) => publicSlugs.has(s),
  });

  // ---------------------------------------------------------------- Your diagrams (the library)

  const failed = (what: string, err: unknown) => {
    const words = libraryMessages;
    const reason =
      what === "save"
        ? words.libraryStorageFull()
        : what === "restore"
          ? words.libraryRestoreFull()
          : err instanceof Error
            ? err.message
            : String(err);
    const message = words.libraryFailure(what, reason);
    setLibraryError(message);
    notify(message, { kind: "error" });
  };
  // CanvasHandle.flush currently hides persistence failures. Persist its live snapshot
  // through the result-bearing API before any action that depends on stored content.
  const saveForLibraryAction = (target: string): boolean => {
    setLibraryError(null);
    if (target !== slug || !canvasRef.current) return true;
    if (writeAutosave(target, canvasRef.current.getDiagram(), canvasIdentity)) return true;
    failed("save", new Error("Storage is full or blocked. Save or export this diagram before continuing."));
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
        failed("rename", err);
      }
    },
    onDuplicate: (target: string) => {
      if (!saveForLibraryAction(target)) return;
      try {
        const copy = duplicateLibraryDiagram(target);
        notify(libraryMessages.libraryDuplicated(titleOf(target)), {
          kind: "success",
          action: {
            label: t("fileDialog.open"),
            run: () => {
              setLibraryOpen(false);
              setUrl({ view: "canvas", example: copy, present: false });
            },
            testId: "duplicate-open",
          },
        });
      } catch (err) {
        failed("duplicate", err);
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
        return failed("delete", err);
      }
      if (wasOpen) {
        // On to the most recent other diagram, or a blank one.
        const next = library.entries.find((e) => e.slug !== target)?.slug;
        if (!next) newDraft();
        setUrl({ view: "canvas", example: next ?? DRAFT_SLUG, present: false }, { replace: true });
      }

      const restore = () => {
        if (!undo()) return failed("restore", new Error("The browser's storage is full."));
        setLibraryUndo(null);
        setLibraryError(null);
        if (wasOpen) setUrl({ view: "canvas", example: target, present: false });
      };
      const message = libraryMessages.libraryDeleted(title);
      setLibraryUndo({ message, run: restore });
      notify(message, { action: { label: t("shortcuts.undo"), run: restore, testId: "delete-undo" } });
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
  // never appear in UI copy), grouped by theme like the picker. Thumbnails come from the same renderer
  // as Your diagrams.
  const exampleSections = useMemo(
    () =>
      groupByTheme(
        examples.filter((e) => publicSlugs.has(e.slug)),
        (e) => e.theme,
      ).map(({ theme, items }) => ({
        theme,
        items: items.map((e) => ({
          slug: e.slug,
          title: e.title,
          description: exampleSummary(e),
          thumb: e.thumb,
          featured: e.featured,
        })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- example summaries resolve the current locale
    [locale],
  );
  const start: StartOptions = {
    recent: library.entries
      .filter((e) => e.slug !== slug)
      .map((e) => ({
        slug: e.slug,
        title: e.title,
        detail: t("start.recentDetail", { count: e.nodes, ago: formatAgo(e.updatedAt) }),
        thumb: e.thumb,
      })),
    examples: exampleSections,
    onOpen: (example) => setUrl({ example }),
    onOpenFile: () => void interop.openFile(),
    onPaste: interop.openPaste,
    onLibrary: openLibrary,
    onBrowseExamples: () => setExamplesOpen(true),
  };
  const goTo = (view: View) => setUrl({ view, present: false });

  return (
    <div className={`app${presenting ? " is-presenting" : ""}`}>
      {!presenting && (
        <TopBar
          view={url.view}
          onView={goTo}
          exampleOptions={options}
          example={targetSlug}
          onExample={(example) => setUrl({ example })}
          onBrowseExamples={() => setExamplesOpen(true)}
          interop={interop}
          shared={
            url.view === "canvas" && slug === SHARED_SLUG ? { onKeep: () => void interop.keepSharedCopy() } : undefined
          }
          room={
            rooms && openRoom ? (
              <rooms.RoomChip
                room={rooms.room}
                here={!!roomHere}
                onShow={() => openRoom.slug && setUrl({ view: "canvas", example: openRoom.slug, present: false })}
              />
            ) : undefined
          }
          onPresent={() => setUrl({ present: true })}
          onNewDiagram={newDiagram}
          onLibrary={openLibrary}
          libraryCount={library.entries.length}
        />
      )}
      <div className="app-body">
        <div className="app-main">
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
              ) : displayedSlug === undefined ? (
                <ViewLoading />
              ) : roomBusy || (roomHere && (!roomHere.ready || !roomInitial)) ? (
                rooms ? (
                  <rooms.RoomConnecting room={rooms.room} />
                ) : (
                  <ViewLoading />
                )
              ) : (
                <CanvasView
                  // A room's canvas is its own mount: it edits through the room (src/collab/room).
                  key={roomHere ? `${canvasMount.key}:room${roomHere.mount}` : canvasMount.key}
                  room={roomHere?.editor}
                  initial={roomHere ? roomInitial : undefined}
                  ref={canvasCallbackRef}
                  slug={slug}
                  focusRequest={exampleFocus?.slug === slug ? exampleFocus.request : undefined}
                  presenting={presenting}
                  onExitPresent={() => setUrl({ present: false })}
                  start={start}
                  onTitleChange={onTitleChange}
                  copyNotice={copyNotice ? t("fileToast.savedACopyOfValue0ToYour", { value0: copyNotice }) : undefined}
                  onExampleCopy={
                    examples.some((e) => e.slug === slug)
                      ? (source, copy, title) => {
                          unseen.copy(getDiagramIdentity(source), getDiagramIdentity(copy));
                          setCopyNotice(title);
                          setLoadedSlug((current) => (current === source ? copy : current));
                          // A flush while leaving a diagram keeps the copy without replacing newer navigation.
                          if (new URLSearchParams(window.location.search).get("example") === source) {
                            setCanvasMount({ identity: getDiagramIdentity(copy), key: canvasMount.key });
                            showDiagram({ identity: getDiagramIdentity(copy), example: copy });
                            setUrl({ example: copy }, { replace: true });
                          }
                        }
                      : undefined
                  }
                />
              )}
            </Suspense>
          </ViewBoundary>
        </div>
        {/* No AI panel in a copy deployed without AI tools or the on-device model (src/lib/deployment.ts). */}
        {AI_PANEL && <AiMount view={url.view} presenting={presenting} onNewDiagram={newDiagram} />}
      </div>
      <div className="sr-only" role="status" data-testid="example-loading">
        {url.view === "canvas" && waitingForExample
          ? `Loading ${examples.find((e) => e.slug === targetSlug)?.title ?? "the example"}…`
          : ""}
      </div>
      {examplesOpen && (
        <ExamplesDialog
          onClose={() => setExamplesOpen(false)}
          onOpen={(example, simulation) => {
            paletteHost.cancelRun();
            canvasRef.current?.flush();
            setExamplesOpen(false);
            setExampleFocus((previous) => ({ slug: example, request: (previous?.request ?? 0) + 1 }));
            setUrl({ view: "canvas", example, present: false });
            if (simulation) {
              const query = new URLSearchParams(window.location.search);
              query.set("live", "1");
              const localOnly = examples.some((entry) => entry.slug === example && entry.localOnly);
              if (localOnly) query.delete("sim");
              else query.set("sim", simulation);
              window.history.replaceState(null, "", `${window.location.pathname}?${query}${window.location.hash}`);
              paletteHost.runSimulation(simulation, getDiagramIdentity(example));
            }
          }}
        />
      )}
      {interop.layer}
      {rooms && (
        <rooms.RoomLayer room={rooms.room} slug={slug} canvas={canvasRef} canvasShown={url.view === "canvas"} />
      )}
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
        onPresent={url.view === "canvas" && !url.present ? () => setUrl({ present: true }) : undefined}
      />
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
