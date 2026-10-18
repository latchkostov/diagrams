import { t, msg } from "../../i18n";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { actionRegistry, type Action } from "../../editor/actions";
import { matches } from "../../editor/shortcuts";
import { paletteHost } from "../../palette/host";
import { privacyOf } from "../../lib/localOnly";
import { AI_TOOLS } from "../../lib/deployment";
import { Icon } from "../../components/Icon";
import { AI_PANEL_COMBO, OPEN_AI_PANEL, aiPanelTitle, buildWithAi, openAiPanel, type OpenAiPanel } from "./events";
import { aiDock, RAIL_WIDTH, clampWidth, collapseDock, useAiDock } from "./dock";
import { forgetLegacyAiKeys } from "./legacy";
import { railLabel, unseen, useUnseen } from "./unseen";
import { lazyComponent, whenIdle } from "../../lib/lazyLoad";

// The app shell's only AI code, kept small because it's in the main bundle: the dock's frame (the slim
// rail, or the column the AI panel loads into), the shortcut, and the menu entries. The panel, the AI
// core and WebMCP are separate chunks, loaded only when needed. The panel loads ahead of its first open:
// once the canvas is idle, or as the pointer reaches the rail.

// Pure: a copy deployed without an AI panel (src/lib/deployment.ts) drops it, and so its chunk.
const AiPanel = /* @__PURE__ */ lazyComponent(
  () => import("./AiPanel").then((m) => m.default),
  (_, { failed, retry }) =>
    failed ? (
      <div className="ai-dock-loading ai-dock-failed" role="alert" data-testid="ai-panel-load-error">
        <p>{t("ai.loadFailed")}</p>
        <div>
          <button className="btn" onClick={collapseDock} data-testid="ai-panel-load-close">
            {t("ai.close")}
          </button>
          <button className="btn btn-primary" onClick={retry} data-testid="ai-panel-load-retry">
            {t("ai.retry")}
          </button>
        </div>
      </div>
    ) : (
      <div className="ai-dock-loading" aria-busy="true" />
    ),
);
// None in a copy deployed without AI tools (src/lib/deployment.ts): folded at build time, so no chunk either.
const WebMcpBridge = AI_TOOLS ? lazy(() => import("../webmcp/WebMcpBridge")) : null;

/** WebMCP feature detection without loading the adapter (`navigator.modelContext` is the old alias). */
const hasModelContext = () =>
  typeof document !== "undefined" && ("modelContext" in document || "modelContext" in navigator);

/** A request for the open panel (focus it, or open Advanced); `seq` makes each one new. */
export type PanelRequest = OpenAiPanel & {
  seq: number;
  /** When it was made: a panel that mounts later (another diagram opened) doesn't act on an old one. */
  at: number;
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
  // App subscribes to the locale and renders this shell; the lazy panel subscribes independently.
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
  // A restored dock can load before the canvas. Do not offer inputs on a panel
  // that will immediately remount, or remount it during a host's detach/attach.
  // Saving an example as an owned copy changes its storage identity while the editor stays mounted.
  // Keep the composer and dictation with that editor; a different editor still starts a fresh panel.
  const identity = canvas ? (canvas.instanceId ?? canvas.documentId ?? "none") : null;
  const [panelIdentity, setPanelIdentity] = useState(identity);
  if (identity !== null && identity !== panelIdentity) setPanelIdentity(identity);
  if (view !== "canvas" && panelIdentity !== null) setPanelIdentity(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      aiDock.set({ open: true });
      setRequest((r) => ({
        ...(e as CustomEvent<OpenAiPanel>).detail,
        seq: (r?.seq ?? 0) + 1,
        at: Date.now(),
      }));
    };
    window.addEventListener(OPEN_AI_PANEL, onOpen);
    return () => window.removeEventListener(OPEN_AI_PANEL, onOpen);
  }, []);

  // Ctrl+I: open and focus the panel; from inside it, fold it away.
  useEffect(() => {
    if (!docked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !matches(e, AI_PANEL_COMBO)) return;
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

  // The browser stores no model key any more: clear what the removed setting left behind.
  useEffect(() => forgetLegacyAiKeys(), []);

  // "AI panel" on the canvas right-click (and so in the palette); "Copy for AI" on a node, an edge or a
  // selection (their ids and labels, for the person to hand to their agent); "Build with AI…" (a new
  // diagram, described with copy and paste) in the palette only. The last two only with AI tools.
  useEffect(
    () =>
      actionRegistry.register([
        {
          id: "canvas.ai-panel",
          section: "insert",
          targets: ["canvas"],
          modes: ["edit", "live"],
          order: 110,
          label: msg("ai.aIPanel"),
          icon: "ai",
          shortcut: AI_PANEL_COMBO,
          run: () => openAiPanel(),
        },
        ...(AI_TOOLS ? aiToolActions(() => newDiagram.current()) : []),
      ]),
    [],
  );

  // Agent changes made while folded show as a count on the rail; opening the panel shows them.
  const documentId = canvas?.documentId;
  const fresh = useUnseen(documentId);
  const shown = docked && dock.open;
  useEffect(() => {
    if (shown && documentId && fresh) unseen.clear(documentId);
  }, [shown, documentId, fresh]);

  // Once a diagram is up (not while the canvas itself is still downloading), and not while live view runs.
  const canvasUp = docked && !!canvas && !canvas.live;
  useEffect(() => (canvasUp ? whenIdle(AiPanel.preload) : undefined), [canvasUp]);

  const [mcp] = useState(() => AI_TOOLS && hasModelContext());
  const live = !!canvas?.live || presenting;

  return (
    <>
      {docked &&
        (dock.open ? (
          // One landmark: the panel inside is the region, so this frame is a plain container.
          <div
            className="ai-dock"
            style={{ width }}
            data-testid="ai-dock"
            data-ready={canvas ? "true" : "false"}
            inert={!canvas}
            onContextMenu={(e) => {
              if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement))
                e.preventDefault();
            }}
          >
            {panelIdentity === null ? (
              <div className="ai-dock-loading" aria-busy="true" data-testid="ai-panel-waiting-canvas" />
            ) : (
              <AiPanel key={panelIdentity} request={request} />
            )}
          </div>
        ) : (
          <aside className="ai-rail" aria-label={t("ai.aIPanel")} data-testid="ai-rail">
            <button
              className="ai-rail-btn"
              onClick={() => openAiPanel()}
              onPointerEnter={AiPanel.preload}
              onFocus={AiPanel.preload}
              aria-label={railLabel(fresh)}
              title={aiPanelTitle()}
              data-testid="ai-rail-open"
            >
              <Icon name="ai" size={18} />
              {fresh > 0 && (
                <span className="ai-rail-badge" aria-hidden="true" data-testid="ai-rail-badge">
                  {fresh > 9 ? "9+" : fresh}
                </span>
              )}
            </button>
          </aside>
        ))}
      {WebMcpBridge && mcp && editorSeen && (
        <Suspense fallback={null}>
          <WebMcpBridge live={live} onNewDiagram={onNewDiagram} />
        </Suspense>
      )}
    </>
  );
}

/** Copy for AI and Build with AI: AI outside the app, so only in a copy deployed with AI tools. */
function aiToolActions(newDiagram: () => void): Action[] {
  return [
    {
      id: "item.copy-for-ai",
      section: "clipboard",
      targets: ["node", "edge", "selection"],
      modes: ["edit", "live"],
      order: 190,
      label: msg("ai.copyForAI"),
      icon: "ai",
      // Off (and saying why) on a private diagram. A local-only example's says so when chosen.
      enabled: () => privacyOf(paletteHost.get().canvas) !== "private",
      hint: () => (privacyOf(paletteHost.get().canvas) === "private" ? t("ai.private") : undefined),
      // Loaded on use: the main bundle stays small.
      run: (ctx) =>
        void import("./copyForAi").then((m) =>
          m.copyForAi([...ctx.selection.nodeIds, ...ctx.selection.edgeIds, ...ctx.selection.groupIds]),
        ),
    },
    {
      id: "file.build-with-ai",
      section: "file",
      targets: ["canvas"],
      paletteOnly: true,
      label: msg("ai.buildWithAI"),
      icon: "ai",
      run: () => buildWithAi(newDiagram),
    },
  ];
}
