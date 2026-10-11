import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { actionRegistry } from "../../editor/actions";
import { matches } from "../../editor/shortcuts";
import { paletteHost } from "../../palette/host";
import { Icon } from "../../components/Icon";
import { ASK_AI_COMBO, OPEN_AI_PANEL, askAiTitle, buildWithAi, openAiPanel, type OpenAiPanel } from "./events";
import { aiDock, RAIL_WIDTH, clampWidth, collapseDock, useAiDock } from "./dock";

// The app shell's only AI code, kept small because it's in the main bundle: the dock's frame (the slim
// rail, or the column the panel loads into), the shortcut, and the menu entries. The panel, the AI core,
// the model adapters and WebMCP are separate chunks, loaded on first open and only when needed.

const AiPanel = lazy(() => import("./AiPanel"));
const WebMcpBridge = lazy(() => import("../webmcp/WebMcpBridge"));

/** WebMCP feature detection without loading the adapter (`navigator.modelContext` is the old alias). */
const hasModelContext = () =>
  typeof document !== "undefined" && ("modelContext" in document || "modelContext" in navigator);

/** A request for the open panel (focus the composer, set a scope or an intent); `seq` makes each one new. */
export type PanelRequest = OpenAiPanel & {
  seq: number;
  /** When it was made: a panel that mounts later (another diagram opened) doesn't act on an old one. */
  at: number;
  /** The diagram it was made on: a scope only applies there. */
  documentId?: string;
};

const panelEl = () => document.querySelector<HTMLElement>('[data-testid="ai-panel"]');

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
  const dock = useAiDock();
  // The actions register once (re-registering would rebuild an open menu under the pointer).
  const newDiagram = useRef(onNewDiagram);
  useLayoutEffect(() => {
    newDiagram.current = onNewDiagram;
  }, [onNewDiagram]);
  // The dock is part of the diagram's tooling: editor and live view, never presenting (or embeds,
  // which don't mount the app shell at all).
  const docked = view === "canvas" && !presenting;
  const [request, setRequest] = useState<PanelRequest | null>(null);
  // WebMCP waits for the editor's first mount, then stays registered while the editor view is up
  // (a diagram switch remounts the canvas for a moment; the tools look the editor up per call).
  const [editorSeen, setEditorSeen] = useState(false);
  if (canvas && !editorSeen) setEditorSeen(true);
  if (view !== "canvas" && editorSeen) setEditorSeen(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      aiDock.set({ open: true });
      setRequest((r) => ({
        ...(e as CustomEvent<OpenAiPanel>).detail,
        seq: (r?.seq ?? 0) + 1,
        at: Date.now(),
        documentId: paletteHost.get().canvas?.documentId,
      }));
    };
    window.addEventListener(OPEN_AI_PANEL, onOpen);
    return () => window.removeEventListener(OPEN_AI_PANEL, onOpen);
  }, []);

  // Ctrl+I: open and focus the panel; from inside it, fold it away.
  useEffect(() => {
    if (!docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !matches(e, ASK_AI_COMBO)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      const panel = panelEl();
      if (aiDock.get().open && panel?.contains(document.activeElement)) collapseDock();
      else openAiPanel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [docked]);

  // Toasts centre on the canvas, clear of the dock.
  const width = docked ? (dock.open ? clampWidth(dock.width) : RAIL_WIDTH) : 0;
  useEffect(() => {
    document.documentElement.style.setProperty("--ai-dock-w", `${width}px`);
    return () => void document.documentElement.style.removeProperty("--ai-dock-w");
  }, [width]);

  // "Ask AI…" on the canvas right-click (and so in the palette); "Change with AI…" on a node, an edge or
  // a selection (it becomes the request's scope); "Build with AI…" (a new diagram, described) in the
  // palette and the File menu.
  useEffect(
    () =>
      actionRegistry.register([
        {
          id: "canvas.ask-ai",
          section: "insert",
          targets: ["canvas"],
          modes: ["edit", "live"],
          order: 110,
          label: "Ask AI…",
          icon: "ai",
          shortcut: ASK_AI_COMBO,
          run: () => openAiPanel(),
        },
        {
          id: "item.change-with-ai",
          section: "edit",
          targets: ["node", "edge", "selection"],
          order: 190,
          label: "Change with AI…",
          icon: "ai",
          run: (ctx) =>
            openAiPanel({
              scope: [...ctx.selection.nodeIds, ...ctx.selection.edgeIds, ...ctx.selection.groupIds],
              intent: "change",
            }),
        },
        {
          id: "file.build-with-ai",
          section: "file",
          targets: ["canvas"],
          paletteOnly: true,
          label: "Build with AI…",
          icon: "ai",
          run: () => buildWithAi(() => newDiagram.current()),
        },
      ]),
    [],
  );

  const [mcp] = useState(hasModelContext);
  const live = !!canvas?.live || presenting;

  return (
    <>
      {docked &&
        (dock.open ? (
          <section
            className="ai-dock"
            style={{ width }}
            aria-label="Ask AI"
            data-testid="ai-dock"
            onContextMenu={(e) => {
              if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement))
                e.preventDefault();
            }}
          >
            <Suspense fallback={<div className="ai-dock-loading" aria-busy="true" />}>
              <AiPanel key={canvas?.documentId ?? "none"} request={request} />
            </Suspense>
          </section>
        ) : (
          <aside className="ai-rail" aria-label="Ask AI" data-testid="ai-rail">
            <button
              className="ai-rail-btn"
              onClick={() => openAiPanel()}
              aria-label="Ask AI"
              title={askAiTitle()}
              data-testid="ai-rail-open"
            >
              <Icon name="ai" size={18} />
            </button>
          </aside>
        ))}
      {mcp && editorSeen && (
        <Suspense fallback={null}>
          <WebMcpBridge live={live} onNewDiagram={onNewDiagram} />
        </Suspense>
      )}
    </>
  );
}

/** The top bar's Ask AI button: shows and hides the dock (Ctrl+I). Icon-only below 1100 px. */
export function AskAiButton() {
  const { open } = useAiDock();
  return (
    <button
      className={`btn ai-topbar-btn${open ? " is-pressed" : ""}`}
      onClick={() => (open ? collapseDock() : openAiPanel())}
      aria-pressed={open}
      aria-label="Ask AI"
      title={askAiTitle()}
      data-testid="ask-ai-toggle"
    >
      <Icon name="ai" size={14} /> <span className="label-optional">Ask AI</span>
    </button>
  );
}
