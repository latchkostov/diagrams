import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { t, useLocale } from "../i18n";
import { readSheetWidth, saveSheetWidth, sheetBounds, sheetWidth, SHEET_NARROW } from "./sheetWidth";

/** Owns only DOM geometry: pointer frames never publish React or diagram state. */
export function SheetResizeHandle({ onResize }: { onResize?: () => void }) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const notify = useEffectEvent(() => onResize?.());
  useLayoutEffect(() => {
    const handle = ref.current!;
    const sheet = handle.parentElement!;
    const host = sheet.parentElement!;
    let preferred = readSheetWidth();
    let shown = 0;
    let frame = 0;
    let drag: { id: number; x: number; width: number; pending: number } | null = null;
    const available = () =>
      host.clientWidth -
      Array.from(host.children).reduce(
        (sum, child) =>
          sum + (child === sheet || child.classList.contains("canvas-wrap") ? 0 : child.getBoundingClientRect().width),
        0,
      );
    const paint = (width: number | null) => {
      const room = available();
      const bounds = sheetBounds(window.innerWidth, room);
      shown = sheetWidth(window.innerWidth, room, width);
      sheet.style.setProperty("--sheet-width", `${shown}px`);
      handle.hidden = bounds.min === bounds.max;
      handle.setAttribute("aria-valuenow", String(shown));
      handle.setAttribute("aria-valuemin", String(Math.round(bounds.min)));
      handle.setAttribute("aria-valuemax", String(Math.round(bounds.max)));
    };
    const clearDrag = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      const id = drag?.id;
      drag = null;
      sheet.removeAttribute("data-resizing");
      document.documentElement.removeAttribute("data-sheet-resizing");
      if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    };
    const reset = () => {
      clearDrag();
      preferred = null;
      saveSheetWidth(null);
      paint(null);
      notify();
    };
    const rtl = () => getComputedStyle(sheet).direction === "rtl";
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || handle.hidden || window.innerWidth <= SHEET_NARROW) return;
      e.preventDefault();
      e.stopPropagation();
      handle.focus({ preventScroll: true });
      handle.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, width: shown, pending: shown };
      sheet.setAttribute("data-resizing", "");
      document.documentElement.setAttribute("data-sheet-resizing", "");
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      e.stopPropagation();
      drag.pending = drag.width + (e.clientX - drag.x) * (rtl() ? 1 : -1);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (drag) paint(drag.pending);
      });
    };
    const up = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      move(e);
      paint(drag.pending);
      preferred = shown;
      saveSheetWidth(preferred);
      clearDrag();
      frame = 0;
      notify();
    };
    const cancel = () => {
      if (!drag) return;
      clearDrag();
      frame = 0;
      paint(preferred);
    };
    const key = (e: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Enter") return reset();
      const bounds = sheetBounds(window.innerWidth, available());
      const delta = (e.shiftKey ? 64 : 16) * ((e.key === "ArrowLeft") !== rtl() ? 1 : -1);
      paint(e.key === "Home" ? bounds.min : e.key === "End" ? bounds.max : shown + delta);
      preferred = shown;
      saveSheetWidth(preferred);
      notify();
    };
    const resize = () => {
      const before = shown;
      cancel();
      paint(preferred);
      if (shown !== before) notify();
    };
    paint(preferred);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    for (const child of host.children)
      if (child !== sheet && !child.classList.contains("canvas-wrap")) observer.observe(child);
    window.addEventListener("resize", resize);
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    handle.addEventListener("keydown", key);
    handle.addEventListener("dblclick", reset);
    return () => {
      clearDrag();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      handle.removeEventListener("keydown", key);
      handle.removeEventListener("dblclick", reset);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="sheet-resize"
      data-testid="inspector-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("inspector.resize")}
      title={t("inspector.resizeHint")}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
    />
  );
}
