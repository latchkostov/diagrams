import { useEffect, useLayoutEffect, useRef } from "react";
import { makePayload, parsePayload } from "./clipboard";
import { isEditableTarget, shortcutFor } from "./shortcuts";
import { typeAheadActive } from "../canvas/typeAhead";
import type { EditorApi } from "./types";
import type { Toward } from "../canvas/placement";

const TOWARD: Record<string, Toward> = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };

/** Keyboard selection between nodes (D14): Tab, Shift+Tab, Ctrl+Alt+arrows, and Ctrl+Alt+] / [ to a node's edges. */
export type NavStep = "next" | "prev" | Toward | "edge-out" | "edge-in";

/** On a node or an edge of the canvas (or the canvas itself): where Tab steps between nodes. */
const onCanvasItem = (t: EventTarget | null) =>
  t instanceof Element &&
  !!t.closest('[data-testid="canvas-wrap"]') &&
  (t.matches('[data-testid="canvas-wrap"]') || !!t.closest(".react-flow__node, .react-flow__edge")) &&
  !isEditableTarget(t);

/** If no `paste` event follows Ctrl+V within this time, paste the internal clipboard. */
const PASTE_FALLBACK_MS = 120;

const inOverlay = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-editor-overlay]");
const hasTextSelection = () => !!window.getSelection()?.toString();

// React Flow owns focusable node wrappers; all other interactive descendants are controls.
export const inCanvas = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('[data-testid="canvas-wrap"]') &&
  !target.closest(
    'button, input, textarea, select, a, [contenteditable="true"], [role="button"], [role="radio"], [role="slider"], [role="menu"], [role="menuitem"], [role="combobox"], [role="listbox"], [role="switch"], [role="checkbox"], [role="spinbutton"], [role="tab"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], summary',
  );
const SELECTION_SHORTCUTS = new Set([
  "delete",
  "copy",
  "cut",
  "paste",
  "duplicate",
  "group",
  "select-all",
  "nudge",
  "nudge-far",
  "rename",
]);

/**
 * Global canvas shortcuts (window, capture phase — so arrow keys beat React Flow's own node
 * nudging and group contents move along). Ignored while typing or inside menus / dialogs.
 */
export function useCanvasShortcuts(
  editor: EditorApi,
  opts: {
    enabled: boolean;
    onEscape: () => void;
    /** Live view: no new annotations mid-run. */
    live?: boolean;
    /** Use the canvas's inspector capability before consuming a naming shortcut. */
    canRename?: boolean;
    /** A waiting live narration owns Enter before inspector naming. */
    canRenameEnter?: () => boolean;
    /** Alt+arrow from `from`: quick-add the next node that way; with Shift, a connected copy (D3). */
    onGrow?: (from: string, toward: Toward, clone: boolean) => void;
    /**
     * Moves the selection (and focus) between nodes from the keyboard (D14). False when there's nowhere to go:
     * Tab past the last node then leaves the canvas, as Tab does.
     */
    onNavigate?: (step: NavStep, from: EventTarget | null) => boolean;
    /**
     * Esc cleared the selection on `from` (a node or an edge): keep focus on it once React Flow has blurred it.
     * The canvas's focus controller does this; without one, it's done here.
     */
    keepFocus?: (from: HTMLElement | null) => void;
  },
) {
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  useEffect(() => {
    let pasteFallback: number | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!optsRef.current.enabled || e.defaultPrevented || e.isComposing) return;
      if (isEditableTarget(e.target) || inOverlay(e.target)) return;
      // Keys typed for a new node's name before its editor opens (T must not add a text).
      if (typeAheadActive()) return;
      const id = shortcutFor(e);
      if (!id) return;
      if (SELECTION_SHORTCUTS.has(id) && !inCanvas(e.target)) return;
      const sel = editor.getSelection();
      const hasNodes = sel.nodeIds.length + sel.groupIds.length > 0;
      const hasAny = hasNodes || sel.edgeIds.length > 0;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      switch (id) {
        case "undo":
          handled();
          editor.undo();
          break;
        case "redo":
          handled();
          editor.redo();
          break;
        case "delete":
          if (!hasAny) return;
          handled();
          editor.deleteElements(sel);
          break;
        case "copy":
          if (!hasNodes || hasTextSelection()) return;
          // No preventDefault: the native `copy` event below also fills the system clipboard.
          editor.copy(sel);
          break;
        case "cut":
          if (!hasNodes || hasTextSelection()) return;
          handled();
          editor.cut(sel);
          break;
        case "paste":
          window.clearTimeout(pasteFallback);
          pasteFallback = window.setTimeout(() => void editor.paste(), PASTE_FALLBACK_MS);
          break;
        case "duplicate":
          handled();
          if (hasNodes) editor.duplicate(sel);
          break;
        case "group":
          handled();
          if (hasNodes) editor.groupNodes([...sel.nodeIds, ...sel.groupIds]);
          break;
        case "select-all":
          handled();
          editor.selectAll();
          break;
        case "nudge":
        case "nudge-far": {
          if (!hasNodes) return;
          handled();
          const d = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as const)[
            e.key as "ArrowUp"
          ] ?? [0, 0];
          // Grid-true with Snapping on (10 px, Shift 50 px, onto the grid); 1 px and 10 px with it off.
          editor.nudge(d[0], d[1], id === "nudge-far");
          break;
        }
        case "add-next":
        case "clone-next": {
          const grow = optsRef.current.onGrow;
          if (optsRef.current.live || !grow) return;
          if (!(inCanvas(e.target) || e.target === document.body)) return;
          // On the canvas Alt+arrows are ours, selection or not: never the browser's Back or Forward.
          handled();
          const from = editor.stencilAnchor();
          if (e.repeat || !from) return;
          grow(from, TOWARD[e.key], id === "clone-next");
          break;
        }
        case "select-next":
        case "select-prev": {
          // Tab steps between nodes only from a node, an edge or the canvas; elsewhere it's the page's.
          const nav = optsRef.current.onNavigate;
          if (!nav || !onCanvasItem(e.target)) return;
          // Enter an annotation's link surface before stepping to the next canvas item.
          // This runs in window capture, before any link's own keyboard handler.
          const target = e.target instanceof HTMLElement ? e.target : null;
          const node = target?.closest<HTMLElement>(".react-flow__node");
          const links = Array.from(node?.querySelectorAll<HTMLAnchorElement>("[data-caption-root] a[href]") ?? []);
          const current = target ? links.indexOf(target as HTMLAnchorElement) : -1;
          const backwards = id === "select-prev";
          if (current >= 0) {
            const next = links[current + (backwards ? -1 : 1)];
            if (next) {
              handled();
              next.focus();
              return;
            }
            if (backwards && node) {
              handled();
              node.focus();
              return;
            }
          } else if (!backwards && links[0]) {
            handled();
            links[0].focus();
            return;
          }
          if (nav(backwards ? "prev" : "next", e.target)) handled();
          break;
        }
        case "select-toward":
        case "select-edge-out":
        case "select-edge-in": {
          const nav = optsRef.current.onNavigate;
          if (!nav || !(inCanvas(e.target) || e.target === document.body)) return;
          // Ours on the canvas even when there's nothing that way (an announcement says so).
          handled();
          nav(id === "select-toward" ? TOWARD[e.key] : id === "select-edge-out" ? "edge-out" : "edge-in", e.target);
          break;
        }
        case "add-text":
          if (optsRef.current.live || e.repeat) return;
          handled();
          editor.addAnnotation("text", { atPointer: true });
          break;
        case "rename": {
          if (optsRef.current.canRename === false) return;
          if (optsRef.current.live && sel.nodeIds[0] && editor.getAnnotation(sel.nodeIds[0])) return;
          const total = sel.nodeIds.length + sel.groupIds.length + sel.edgeIds.length;
          if (total !== 1) return;
          if (e.key === "Enter") {
            // A key held down doesn't reopen the inspector.
            if (e.repeat || optsRef.current.canRenameEnter?.() === false) return;
            // A focused node or edge that isn't selected: Enter selects it (React Flow's keyboard rule).
            const item = e.target instanceof Element ? e.target.closest(".react-flow__node, .react-flow__edge") : null;
            if (item && !item.classList.contains("selected")) return;
          }
          handled();
          if (sel.nodeIds[0] && editor.getAnnotation(sel.nodeIds[0]))
            editor.startEditing({ kind: "annotation", id: sel.nodeIds[0] });
          else if (sel.nodeIds[0]) editor.startEditing({ kind: "node", id: sel.nodeIds[0], field: "label" });
          else if (sel.edgeIds[0]) editor.startEditing({ kind: "edge", id: sel.edgeIds[0] });
          else editor.startEditing({ kind: "group", id: sel.groupIds[0] });
          break;
        }
        case "escape": {
          // Don't stop propagation: the app also uses Esc to leave presentation mode.
          optsRef.current.onEscape();
          // Cleared after React Flow's own Esc handler on a focused node or edge. Cleared before it, the
          // node read as unselected and React Flow selected it again, so Esc never cleared a clicked node.
          // On a focused node that isn't selected, React Flow's own Esc selects it: clear that too (Esc never selects).
          const onNode = e.target instanceof Element && !!e.target.closest(".react-flow__node");
          if ((hasAny || onNode) && inCanvas(e.target)) {
            window.setTimeout(() => editor.clearSelection(), 0);
            // React Flow blurs the node it unselects a frame later, which left focus on the page: Tab then started
            // from the top. Focus stays on the node (now unselected), the canvas's tab stop.
            const was = e.target instanceof HTMLElement ? e.target : null;
            if (optsRef.current.keepFocus) optsRef.current.keepFocus(was);
            else
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  if (was?.isConnected && document.activeElement === document.body) was.focus({ preventScroll: true });
                }),
              );
          }
          break;
        }
        case "fit-view":
          handled();
          editor.fitView();
          break;
        case "zoom-100":
          handled();
          editor.zoomTo100();
          break;
        case "zoom-selection":
          if (editor.zoomToSelection()) handled();
          break;
        case "shortcuts":
          handled();
          editor.showShortcuts();
          break;
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      if (
        !optsRef.current.enabled ||
        !inCanvas(e.target) ||
        isEditableTarget(e.target) ||
        inOverlay(e.target) ||
        hasTextSelection()
      )
        return;
      const sel = editor.getSelection();
      if (!sel.nodeIds.length && !sel.groupIds.length) return;
      const payload = makePayload(editor.getDiagram(), sel.nodeIds, sel.groupIds, editor.isPrivate?.());
      if (!payload) return;
      e.clipboardData?.setData("text/plain", JSON.stringify(payload, null, 2));
      e.preventDefault();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!optsRef.current.enabled || !inCanvas(e.target) || isEditableTarget(e.target) || inOverlay(e.target)) return;
      window.clearTimeout(pasteFallback);
      const payload = parsePayload(e.clipboardData?.getData("text/plain") ?? "");
      e.preventDefault();
      if (payload) editor.pastePayload(payload);
      else void editor.paste();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.clearTimeout(pasteFallback);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  }, [editor]);
}
