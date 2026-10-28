import { t } from "../../i18n";
import { surfaceCatalogs } from "../../i18n/surfaces";
// What every AI change shows once applied: a toast with Undo and a brief highlight of what changed.
// Shared by the AI panel and the WebMCP tools.

import type { EditorApi } from "../../editor/types";
import { notify, toast } from "../../interop/ui/toast";

const GROUP_PREFIX = "group:";
const FLASH_MS = 1800;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
let flashStyle: HTMLStyleElement | undefined;

/**
 * Glows the changed nodes, boundaries, annotations and connections for a moment. A stylesheet keyed
 * by id (not classes on React Flow's elements), so re-renders during the flash can't drop it.
 */
export function flashChanged(ids: readonly string[]): void {
  if (typeof document === "undefined") return;
  clearTimeout(flashTimer);
  flashStyle?.remove();
  flashStyle = undefined;
  if (!ids.length) return;
  const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));
  const nodes = ids.flatMap((id) => [
    `.react-flow__node[data-id="${esc(id)}"]`,
    `.react-flow__node[data-id="${esc(GROUP_PREFIX + id)}"]`,
  ]);
  const edges = ids.map((id) => `.react-flow__edge[data-id="${esc(id)}"] .react-flow__edge-path`);
  const style = document.createElement("style");
  style.dataset.aiFlash = "";
  style.textContent = `
@keyframes ai-flash-node {
  25%, 60% { filter: drop-shadow(0 0 0.5px var(--accent)) drop-shadow(0 0 10px color-mix(in oklab, var(--accent) 55%, transparent)); }
}
@keyframes ai-flash-edge {
  25%, 60% { stroke: var(--accent); stroke-width: 2.5px; }
}
${nodes.join(",\n")} { animation: ai-flash-node ${FLASH_MS}ms var(--ease-out) both; }
${edges.join(",\n")} { animation: ai-flash-edge ${FLASH_MS}ms var(--ease-out) both; }
@media (prefers-reduced-motion: reduce) {
  ${nodes.join(",\n  ")} { animation: none; outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 12px; }
}`;
  document.head.appendChild(style);
  flashStyle = style;
  flashTimer = setTimeout(() => {
    style.remove();
    if (flashStyle === style) flashStyle = undefined;
  }, FLASH_MS + 100);
}

let markStyle: HTMLStyleElement | undefined;

/**
 * Outlines elements while a thread turn is hovered or focused (no animation); `[]` clears it. Ids that
 * are no longer on the canvas simply match nothing.
 */
export function markElements(ids: readonly string[]): void {
  if (typeof document === "undefined") return;
  markStyle?.remove();
  markStyle = undefined;
  if (!ids.length) return;
  const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));
  const nodes = ids.flatMap((id) => [
    `.react-flow__node[data-id="${esc(id)}"]`,
    `.react-flow__node[data-id="${esc(GROUP_PREFIX + id)}"]`,
  ]);
  const edges = ids.map((id) => `.react-flow__edge[data-id="${esc(id)}"] .react-flow__edge-path`);
  const style = document.createElement("style");
  style.dataset.aiMark = "";
  style.textContent = `
${nodes.join(",\n")} { filter: drop-shadow(0 0 0.5px var(--accent)) drop-shadow(0 0 8px color-mix(in oklab, var(--accent) 50%, transparent)); }
${edges.join(",\n")} { stroke: var(--accent); stroke-width: 2.5px; }`;
  document.head.appendChild(style);
  markStyle = style;
}

/** The AI panel is on screen (its frame, even while the panel's own chunk is still loading). */
export const panelShown = () => typeof document !== "undefined" && !!document.querySelector('[data-testid="ai-dock"]');

let appliedToast: number | undefined;

/** A polite status for screen readers when an AI change shows no toast (the toast has its own). */
function announce(text: string): void {
  let region = document.querySelector<HTMLElement>("[data-ai-announce]");
  if (!region) {
    region = document.createElement("div");
    region.dataset.aiAnnounce = "";
    region.dataset.testid = "ai-announce";
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  // Emptied first, so the same words twice are read twice.
  region.textContent = "";
  const el = region;
  requestAnimationFrame(() => (el.textContent = text));
}

export interface AppliedFeedback {
  /** A turn in the thread offers Undo for exactly this step: with the panel open, no toast then. */
  turnUndo: boolean;
  /** Bring changed elements that are off screen into view: the person's own applies, never an agent's. */
  reveal: boolean;
}

/**
 * "AI: +3 nodes, +2 connections" with Undo, and the highlight. While the AI panel is open and the change
 * is a turn there with its own Undo, the toast stays away (one Undo, not two) and a status announces it.
 */
export function showApplied(
  summary: string,
  changed: readonly string[],
  editor: EditorApi,
  { turnUndo, reveal }: AppliedFeedback,
): void {
  if (typeof document === "undefined") return;
  const tell = () => {
    if (turnUndo && panelShown()) announce(t("ai.appliedSummary", { summary }));
    else {
      const id = notify(t("ai.appliedSummary", { summary }), {
        kind: "success",
        action: { label: t("ai.undo"), run: () => editor.undo(), testId: "ai-toast-undo", undoes: true },
      });
      appliedToast = turnUndo ? id : undefined;
    }
  };
  // An agent's change can arrive before the AI panel ever opened: its words come with the AI catalog (a failed
  // download still tells, in English).
  const words = surfaceCatalogs(["ai"]);
  if (words) void words.catch(() => {}).then(tell);
  else tell();
  flashChanged(changed);
  if (reveal) revealChanged(changed, editor);
}

/** The panel opened: a toast for a change whose turn now carries the Undo goes. */
export function dismissAppliedToast(): void {
  if (appliedToast !== undefined) toast.dismiss(appliedToast);
  appliedToast = undefined;
}

const canvasWrap = () => document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');

/**
 * Lets the canvas's fit keep content clear of a floating panel that lives outside it (the AI panel
 * is portalled to <body>): an invisible stand-in with `data-canvas-overlay`, kept on the panel's
 * footprint. Returns the cleanup.
 */
export function shadowOverlay(panel: HTMLElement): () => void {
  const stand = document.createElement("div");
  stand.dataset.canvasOverlay = "";
  stand.setAttribute("aria-hidden", "true");
  Object.assign(stand.style, { position: "absolute", pointerEvents: "none", opacity: "0" });
  const update = () => {
    const wrap = canvasWrap();
    if (!wrap) return stand.remove();
    if (stand.parentElement !== wrap) wrap.appendChild(stand);
    const w = wrap.getBoundingClientRect();
    panel.style.right = `${Math.max(12, window.innerWidth - w.right + 12)}px`;
    panel.style.maxWidth = `${Math.max(0, w.width - 24)}px`;
    const p = panel.getBoundingClientRect();
    Object.assign(stand.style, {
      left: `${p.left - w.left}px`,
      top: `${p.top - w.top}px`,
      width: `${p.width}px`,
      height: `${p.height}px`,
    });
  };
  update();
  const ro = new ResizeObserver(update);
  ro.observe(panel);
  const wrap = canvasWrap();
  if (wrap) ro.observe(wrap);
  window.addEventListener("resize", update);
  // The canvas remounts when another diagram opens: follow it.
  const timer = setInterval(update, 1000);
  return () => {
    ro.disconnect();
    window.removeEventListener("resize", update);
    clearInterval(timer);
    stand.remove();
  };
}

type Box = { left: number; top: number; right: number; bottom: number };
const overlapsBox = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Fits the view (clear of floating panels) when a changed node is off screen or under one. */
export function revealChanged(ids: readonly string[], editor: EditorApi, tries = 12): void {
  if (typeof document === "undefined" || !ids.length) return;
  // New nodes are measured and placed a frame or two after they render: wait for their size.
  setTimeout(() => {
    const wrap = canvasWrap();
    if (!wrap) return;
    const view = wrap.getBoundingClientRect();
    const covers = [...wrap.querySelectorAll<HTMLElement>("[data-canvas-overlay]")].map((el) =>
      el.getBoundingClientRect(),
    );
    const rects = ids
      .map((id) => wrap.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`))
      .filter((el): el is HTMLElement => !!el)
      .map((el) => ({ rect: el.getBoundingClientRect(), shown: getComputedStyle(el).visibility !== "hidden" }));
    if (rects.some((r) => !r.shown || !r.rect.width) && tries > 0) return revealChanged(ids, editor, tries - 1);
    const hidden = rects.some(({ rect: r }) => {
      const outside = r.left < view.left || r.right > view.right || r.top < view.top || r.bottom > view.bottom;
      return outside || covers.some((c) => overlapsBox(r, c));
    });
    if (hidden) editor.fitView();
  }, 50);
}
