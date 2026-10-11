import { useEffect, useMemo, useRef, useState } from "react";
import { examples } from "./examples";
import { TopBar, type ExampleOption } from "./components/TopBar";
import { GalleryView } from "./gallery/GalleryView";
import { CanvasView, type CanvasHandle } from "./canvas/CanvasView";
import { useUrlState } from "./lib/urlState";
import { downloadDiagram, getImported, IMPORTED_SLUG, parseDiagram, setImported } from "./lib/diagramIO";

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

  const onImport = async (file: File) => {
    const result = parseDiagram(await file.text());
    if (!result.ok) {
      setToast({ kind: "error", text: `Couldn't import ${file.name}. ${result.error}` });
      return;
    }
    setImported(result.diagram);
    setImportedVersion((v) => v + 1);
    setUrl({ view: "canvas", example: IMPORTED_SLUG, present: false });
    setToast({ kind: "info", text: `Imported “${result.diagram.title}”.` });
  };

  const onExport = () => {
    const d = canvasRef.current?.getDiagram();
    if (!d) return;
    downloadDiagram(d, slug === IMPORTED_SLUG ? slugify(d.title) : slug);
    setToast({ kind: "info", text: `Exported ${d.nodes.length} nodes and ${d.edges.length} edges.` });
  };

  const presenting = url.view === "canvas" && url.present;

  return (
    <div className={`app${presenting ? " is-presenting" : ""}`}>
      {!presenting && (
        <TopBar
          view={url.view}
          onView={(view) => setUrl({ view, present: false })}
          exampleOptions={options}
          example={slug}
          onExample={(example) => setUrl({ example })}
          onImport={onImport}
          onExport={onExport}
          onPresent={() => setUrl({ present: true })}
        />
      )}
      <div className="app-body">
        {url.view === "gallery" ? (
          <GalleryView />
        ) : (
          <CanvasView
            key={`${slug}:${importedVersion}`}
            ref={canvasRef}
            slug={slug}
            presenting={presenting}
            onExitPresent={() => setUrl({ present: false })}
          />
        )}
      </div>
      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} data-testid="toast">
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "diagram";
