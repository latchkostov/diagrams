import { useLayoutEffect, useRef } from "react";
import { avoidedBars, toastBottom } from "../interop/ui/toastStack";

/** A quiet status in the pane's notification stack; action toasts stack above it. */
export function CopyNotice({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const node = ref.current;
      if (!node) return;
      // Measure before opting into avoidance, so the notice never stacks above itself.
      node.removeAttribute("data-toast-avoid");
      const area = node.parentElement!.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const bottom = toastBottom(rect, avoidedBars(), window.innerHeight);
      node.style.bottom = `${bottom - (window.innerHeight - area.bottom)}px`;
      node.setAttribute("data-toast-avoid", "");
    };
    place();
    const timer = setInterval(place, 250);
    window.addEventListener("resize", place);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", place);
    };
  }, []);
  return (
    <div className="example-copy-notice" role="status" data-testid="example-copy-notice" ref={ref} data-editor-overlay>
      {text}
    </div>
  );
}
