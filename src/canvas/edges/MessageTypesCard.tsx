import { useEffect } from "react";
import { useTooltip } from "../../components/useTooltip";
import { useReadableScale } from "../useReadableScale";

/** Loaded with carried types, only while their edge has keyboard focus. */
export function MessageTypesCard({ id, text, x, y }: { id: string; text: string; x: number; y: number }) {
  const { open } = useTooltip(true);
  const scale = useReadableScale();
  const tipId = `edge-messages-${id}`;
  useEffect(() => {
    if (!open) return;
    const wrapper = document.activeElement;
    if (wrapper?.getAttribute("data-id") !== id) return;
    const previous = wrapper.getAttribute("aria-describedby");
    wrapper.setAttribute("aria-describedby", [previous, tipId].filter(Boolean).join(" "));
    return () => {
      if (previous) wrapper.setAttribute("aria-describedby", previous);
      else wrapper.removeAttribute("aria-describedby");
    };
  }, [id, tipId, open]);
  if (!open) return null;
  return (
    <div
      className="fe-card nodrag nopan"
      role="tooltip"
      id={tipId}
      data-testid={tipId}
      style={{
        transformOrigin: "0 0",
        transform: `translate(${x}px, ${y - 12}px) scale(${scale}) translate(-50%, -100%)`,
      }}
    >
      {text}
    </div>
  );
}
