import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { examples } from "./examples";
import { TopBar, type ExampleOption } from "./components/TopBar";
import type { CanvasHandle } from "./canvas/CanvasView";
import type { OpenTarget } from "./lab/LabView";
import { useUrlState, type View } from "./lib/urlState";
import { downloadDiagram, getImported, IMPORTED_SLUG, parseDiagram, setImported, writeAutosave } from "./lib/diagramIO";
import { Icon } from "./components/Icon";

// Views are code-split: the gallery and canvas each pull in their own weight (React Flow lives
// with the canvas), and the Lab never downloads unless someone opens ?view=lab.
const GalleryView = lazy(() => import("./gallery/GalleryView").then((m) => ({ default: m.GalleryView })));
const CanvasView = lazy(() => import("./canvas/CanvasView").then((m) => ({ default: m.CanvasView })));
const LabView = lazy(() => import("./lab/LabView").then((m) => ({ default: m.LabView })));

type Toast = { kind: "error" | "info"; text: string } | null;

export function App() {
  const [url, setUrl] = useUrlState();
  const canvasRef = useRef<CanvasHandle>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [importedVersion, setImportedVersion] = useState(0);

  const options: ExampleOption[] = useMemo(() => {
    const list = examples.map((e) => ({ slug: e.slug, title: e.diagram.title }));
    const imported = getImported();
    if (imported) list.push({ slug: IMPORTED_SLUG, title: `Imported: ${imported.title}` });
    return list;
    // importedVersion is the trigger to re-read the imported diagram from localStorage.
  }, [importedVersion]);

  const slug = options.some((o) => o.slug === url.example) ? url.example! : options[0]?.slug ?? IMPORTED_SLUG;

  // Normalise the URL once we know which example is shown.
  useEffect(() => {
    if (url.view === "canvas" && url.example !== slug) setUrl({ example: slug }, { replace: true });
  }, [url.view, url.example, slug, setUrl]);

  useEffect(() => {
    if (!url.present) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setUrl({ present: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url.present, setUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showImported = (title: string) => {
    setImportedVersion((v) => v + 1);
    setUrl({ view: "canvas", example: IMPORTED_SLUG, present: false });
    setToast({ kind: "info", text: `Imported “${title}”.` });
  };

  const onImport = async (file: File) => {
    const result = parseDiagram(await file.text());
    if (!result.ok) {
      setToast({ kind: "error", text: `Couldn't import ${file.name}. ${result.error}` });
      return;
    }
    setImported(result.diagram);
    showImported(result.diagram.title);
  };

  const onExport = () => {
    const d = canvasRef.current?.getDiagram();
    if (!d) return;
    downloadDiagram(d, slug === IMPORTED_SLUG ? slugify(d.title) : slug);
    setToast({ kind: "info", text: `Exported ${d.nodes.length} nodes and ${d.edges.length} edges.` });
  };

  const onLabOpen = (target: OpenTarget) => {
    if ("slug" in target) return setUrl({ view: "canvas", example: target.slug, present: false });
    setImported(target.diagram);
    showImported(target.diagram.title);
  };

  const presenting = url.view === "canvas" && url.present;
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
          onImport={onImport}
          onExport={onExport}
          onPresent={() => setUrl({ present: true })}
        />
      )}
      <div className="app-body">
        <ViewBoundary
          // Remount (and clear the error) when the user navigates elsewhere.
          resetKey={`${url.view}:${url.view === "canvas" ? `${slug}:${importedVersion}` : ""}`}
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
                key={`${slug}:${importedVersion}`}
                ref={canvasRef}
                slug={slug}
                presenting={presenting}
                onExitPresent={() => setUrl({ present: false })}
              />
            )}
          </Suspense>
        </ViewBoundary>
      </div>
      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} data-testid="toast">
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss" data-testid="toast-dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "diagram";

function ViewLoading() {
  return (
    <div className="view-loading" data-testid="view-loading" role="status" style={centered}>
      <span style={{ color: "var(--text-3)", fontSize: 13 }}>Loading…</span>
    </div>
  );
}

const centered = { position: "absolute", inset: 0, display: "grid", placeItems: "center" } as const;

const viewName: Record<View, string> = { gallery: "the gallery", canvas: "the canvas", lab: "the Lab" };

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
    const chunkFailed = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
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
                : "Try again, or head back to the gallery."}
          </p>
          <code
            style={{ fontSize: 11.5, color: "var(--text-3)", overflowWrap: "anywhere", maxHeight: 96, overflow: "auto" }}
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
              <button className="btn btn-primary" onClick={() => this.setState({ error: null })} data-testid="error-retry">
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
                <Icon name="grid" size={14} /> Go to gallery
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
