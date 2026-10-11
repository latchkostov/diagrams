import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { actionRegistry } from "../../editor/actions";
import { paletteHost } from "../../palette/host";
import { OPEN_AI_DIALOG, openAiDialog } from "./events";

// The app shell's only AI code, kept small because it's in the main bundle. The dialog, the AI core
// and WebMCP are separate chunks, loaded on first open and only when the browser has WebMCP.

const AiDialog = lazy(() => import("./AiDialog"));
const WebMcpBridge = lazy(() => import("../webmcp/WebMcpBridge"));

/** WebMCP feature detection without loading the adapter (`navigator.modelContext` is the old alias). */
const hasModelContext = () =>
  typeof document !== "undefined" && ("modelContext" in document || "modelContext" in navigator);

export function AiMount({
  view,
  presenting,
  onNewDiagram,
}: {
  view: "canvas" | "gallery" | "lab";
  presenting: boolean;
  onNewDiagram: () => void;
}) {
  const host = useSyncExternalStore(paletteHost.subscribe, paletteHost.get);
  const canvas = view === "canvas" ? host.canvas : null;
  const editable = !!canvas && !canvas.live && !presenting;
  const [open, setOpen] = useState(false);
  // WebMCP waits for the editor's first mount, then stays registered while the editor view is up
  // (a diagram switch remounts the canvas for a moment; the tools look the editor up per call).
  const [editorSeen, setEditorSeen] = useState(false);
  if (canvas && !editorSeen) setEditorSeen(true);
  if (view !== "canvas" && editorSeen) setEditorSeen(false);
  // Going live, presenting or leaving the diagram closes it (it doesn't pop back later).
  if (open && (view !== "canvas" || presenting || canvas?.live)) setOpen(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_AI_DIALOG, onOpen);
    return () => window.removeEventListener(OPEN_AI_DIALOG, onOpen);
  }, []);

  // "Build with AI…" on the canvas right-click, and so in the command palette too.
  useEffect(
    () =>
      actionRegistry.register([
        {
          id: "canvas.build-with-ai",
          section: "insert",
          targets: ["canvas"],
          order: 110,
          label: "Build with AI…",
          icon: "ai",
          run: () => openAiDialog(),
        },
      ]),
    [],
  );

  const [mcp] = useState(hasModelContext);
  const live = !!canvas?.live || presenting;

  return (
    <>
      {open && editable && (
        <Suspense fallback={null}>
          <AiDialog key={canvas?.documentId} onClose={() => setOpen(false)} />
        </Suspense>
      )}
      {mcp && editorSeen && (
        <Suspense fallback={null}>
          <WebMcpBridge live={live} onNewDiagram={onNewDiagram} />
        </Suspense>
      )}
    </>
  );
}
