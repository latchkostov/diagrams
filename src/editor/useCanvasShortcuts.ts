import { useEffect, useRef } from "react";
import { makePayload, parsePayload } from "./clipboard";
import { isEditableTarget, shortcutFor } from "./shortcuts";
import type { EditorApi } from "./types";

/** If no `paste` event follows Ctrl+V within this time, paste the internal clipboard. */
const PASTE_FALLBACK_MS = 120;

const inOverlay = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-editor-overlay]");
const hasTextSelection = () => !!window.getSelection()?.toString();

/**
 * Global canvas shortcuts (window, capture phase — so arrow keys beat React Flow's own node
 * nudging and group contents move along). Ignored while typing or inside menus / dialogs.
 */
export function useCanvasShortcuts(editor: EditorApi, opts: { enabled: boolean; onEscape: () => void }) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let pasteFallback: number | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!optsRef.current.enabled || e.defaultPrevented || e.isComposing) return;
      if (isEditableTarget(e.target) || inOverlay(e.target)) return;
      const id = shortcutFor(e);
      if (!id) return;
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
          if (sel.nodeIds.length) editor.groupNodes(sel.nodeIds);
          break;
        case "select-all":
          handled();
          editor.selectAll();
          break;
        case "nudge":
        case "nudge-far": {
          if (!hasNodes) return;
          handled();
          const step = id === "nudge-far" ? 10 : 1;
          const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key] ?? [0, 0];
          editor.moveSelection(d[0] * step, d[1] * step);
          break;
        }
        case "rename": {
          const total = sel.nodeIds.length + sel.groupIds.length + sel.edgeIds.length;
          if (total !== 1) return;
          handled();
          if (sel.nodeIds[0]) editor.startEditing({ kind: "node", id: sel.nodeIds[0], field: "label" });
          else if (sel.edgeIds[0]) editor.startEditing({ kind: "edge", id: sel.edgeIds[0] });
          else editor.startEditing({ kind: "group", id: sel.groupIds[0] });
          break;
        }
        case "escape":
          // Don't stop propagation: the app also uses Esc to leave presentation mode.
          optsRef.current.onEscape();
          if (hasAny) editor.clearSelection();
          break;
        case "fit-view":
          handled();
          editor.fitView();
          break;
        case "zoom-100":
          handled();
          editor.zoomTo100();
          break;
        case "shortcuts":
          handled();
          editor.showShortcuts();
          break;
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      if (!optsRef.current.enabled || isEditableTarget(e.target) || inOverlay(e.target) || hasTextSelection()) return;
      const sel = editor.getSelection();
      if (!sel.nodeIds.length && !sel.groupIds.length) return;
      const payload = makePayload(editor.getDiagram(), sel.nodeIds, sel.groupIds);
      if (!payload) return;
      e.clipboardData?.setData("text/plain", JSON.stringify(payload, null, 2));
      e.preventDefault();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!optsRef.current.enabled || isEditableTarget(e.target) || inOverlay(e.target)) return;
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
