import { useEffect, useState, type RefObject } from "react";
import { inCanvas } from "../../editor/useCanvasShortcuts";
import { isEditableTarget } from "../../editor/shortcuts";

export function usePanKeys(wrapper: RefObject<HTMLDivElement | null>, editGestures: boolean) {
  // ---------------------------------------------------------------- Space, Alt and the middle button (D4, D9)
  // Space held: a drag pans from anywhere, even starting on a node (nodes don't drag meanwhile), with a
  // grab cursor. Alt held over a selected node: the copy cursor (Alt-drag duplicates).
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const wrap = wrapper.current;
    if (!editGestures || !wrap) return;
    const setSpace = (on: boolean) => {
      wrap.classList.toggle("is-space-pan", on);
      setSpaceHeld(on);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") wrap.classList.toggle("is-alt", e.type === "keydown");
      if (e.code !== "Space") return;
      if (e.type === "keyup") return setSpace(false);
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      if (!(e.target === document.body || inCanvas(e.target))) return;
      // Not a page scroll, and not a key press on a focused node.
      e.preventDefault();
      setSpace(true);
    };
    const reset = () => {
      wrap.classList.remove("is-alt");
      setSpace(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", reset);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
  }, [editGestures]);

  // The middle button pans (everywhere); it never starts the browser's autoscroll.
  useEffect(() => {
    const wrap = wrapper.current;
    const noAutoscroll = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    wrap?.addEventListener("mousedown", noAutoscroll);
    return () => wrap?.removeEventListener("mousedown", noAutoscroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wrapper is CanvasView's stable lifetime ref; preserve the original dependencies
  }, []);

  return spaceHeld;
}
