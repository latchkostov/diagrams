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
import { examples } from "./examples";
import { TopBar, type ExampleOption } from "./components/TopBar";
import type { CanvasHandle } from "./canvas/CanvasView";
import type { OpenTarget } from "./lab/LabView";
import type { DiagramFile } from "./model/types";
import { useUrlState, type View } from "./lib/urlState";
import {
  clearShared,
  DIAGRAMS_CHANGED,
  emptyDiagram,
  getAutosave,
  getImported,
  getDiagramIdentity,
  type SaveTarget,
  getShared,
  IMPORTED_SLUG,
  setImported,
  setShared,
  SHARED_SLUG,
  writeAutosave,
} from "./lib/diagramIO";
import { Icon } from "./components/Icon";
import { lastCanvas } from "./lib/canvasBridge";
import type { StartOptions } from "./canvas/StartCard";
import { useInterop, useInteropCanvasActions, type Slot } from "./interop/useInterop";
import { notify } from "./interop/ui/toast";
import { Toaster } from "./interop/ui/Toaster";
import { EmbedView } from "./interop/embed/EmbedView";
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
  // Refresh the picker independently of the currently open document identity.
  const [slotVersion, setSlotVersion] = useState(0);

  // "Your diagram" (the one slot you own, blank until you start or import one) comes first, then a
  // shared diagram if one is open, then the examples.
  const options: ExampleOption[] = useMemo(() => {
    void slotVersion; // the trigger to re-read the stored slots from localStorage
    const shared = getShared();
    return [
      { slug: IMPORTED_SLUG, title: getImported()?.title ?? "Untitled diagram", group: "yours" as const },
      ...(shared ? [{ slug: SHARED_SLUG, title: `${shared.title} (shared)`, group: "yours" as const }] : []),
      ...examples.map((e) => ({ slug: e.slug, title: e.diagram.title, group: "examples" as const })),
    ];
  }, [slotVersion]);

  // No diagram in the URL: reopen the last one, else your own (a blank canvas with the start card).
  const valid = (s: string | undefined): s is string => !!s && options.some((o) => o.slug === s);
  const remembered = lastCanvas();
  const slug = valid(url.example) ? url.example : valid(remembered) ? remembered : IMPORTED_SLUG;

  const canvasIdentity = getDiagramIdentity(slug);

  // Slot changes refresh the picker; only replacement of the open document remounts its canvas.
  useEffect(() => {
    const bump = () => setSlotVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "diagrams.imported.v1" || e.key === "diagrams.shared.v1") bump();
    };
    window.addEventListener(DIAGRAMS_CHANGED, bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DIAGRAMS_CHANGED, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Normalise the URL once we know which example is shown.
  useEffect(() => {
    if (url.view === "canvas" && url.example !== slug) setUrl({ example: slug }, { replace: true });
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

  const openSlot = useCallback(
    (slot: Slot, d: DiagramFile, target?: SaveTarget) => {
      // Validates before replacing the slot; on failure the current diagram stays (and the caller reports why).
      if (slot === IMPORTED_SLUG) {
        setImported(d, target);
        if (slug === SHARED_SLUG) clearShared();
      } else {
        setShared(d, target);
      }
      setSlotVersion((v) => v + 1);
      setUrl({ view: "canvas", example: slot, present: false });
    },
    [setUrl, slug],
  );

  /** File > New diagram and the start card: a blank "your diagram", with Undo if it replaced work. */
  const newDiagram = useCallback(() => {
    const previous =
      slug === IMPORTED_SLUG && canvasRef.current
        ? canvasRef.current.getDiagram()
        : (getAutosave(IMPORTED_SLUG) ?? getImported());
    try {
      openSlot(IMPORTED_SLUG, emptyDiagram());
    } catch (err) {
      notify(`Couldn't start a new diagram. ${err instanceof Error ? err.message : String(err)}`, { kind: "error" });
      return;
    }
    if (previous?.nodes.length)
      notify(`Started a new diagram. “${previous.title}” was replaced.`, {
        action: { label: "Undo", run: () => openSlot(IMPORTED_SLUG, previous), testId: "new-diagram-undo" },
      });
  }, [slug, openSlot]);

  const interop = useInterop({
    view: url.view,
    slug,
    canvas: canvasRef,
    openSlot,
    isPublicExample: (s) => publicSlugs.has(s),
  });

  const canvasCallbackRef = useInteropCanvasActions(canvasRef, interop);

  const onLabOpen = (target: OpenTarget) => {
    if ("slug" in target) return setUrl({ view: "canvas", example: target.slug, present: false });
    try {
      openSlot(IMPORTED_SLUG, target.diagram);
    } catch (err) {
      notify(`Couldn't open it. ${err instanceof Error ? err.message : String(err)}`, { kind: "error" });
    }
  };
  const presenting = url.view === "canvas" && url.present;
  // The start card on a blank canvas: public examples only (private ones never appear in UI copy).
  const start: StartOptions = {
    examples: examples
      .filter((e) => publicSlugs.has(e.slug))
      .map((e) => ({
        slug: e.slug,
        title: e.diagram.title,
        description: e.diagram.description,
        stencils: [...new Set(e.diagram.nodes.map((n) => n.stencil))].slice(0, 3),
      })),
    onExample: (example) => setUrl({ example }),
    onOpenFile: () => void interop.openFile(),
    onPaste: interop.openPaste,
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
            url.view === "canvas" && slug === SHARED_SLUG
              ? { onKeep: () => void interop.keepSharedCopy(), replaces: interop.replacesImported }
              : undefined
          }
          onPresent={() => setUrl({ present: true })}
          onNewDiagram={newDiagram}
        />
      )}
      <div className="app-body">
        <ViewBoundary
          // Remount (and clear the error) when the user navigates elsewhere.
          resetKey={`${url.view}:${url.view === "canvas" ? `${slug}:${canvasIdentity}` : ""}`}
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
                key={`${slug}:${canvasIdentity}`}
                ref={canvasCallbackRef}
                slug={slug}
                presenting={presenting}
                onExitPresent={() => setUrl({ present: false })}
                start={start}
              />
            )}
          </Suspense>
        </ViewBoundary>
      </div>
      {interop.layer}
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
