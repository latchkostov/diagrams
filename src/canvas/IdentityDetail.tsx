import { memo, useEffect, type RefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { iconDetail, titleText } from "./identity";
import { registerFrameCapture } from "./camera/frameCapture";
import { useCameraController } from "./camera/useCameraCore";
import { FAR_ZOOM } from "./detail";

/** Identity belongs to every canvas, including presentation, embeds and offline viewers. */
export const IdentityDetail = memo(function IdentityDetail({ host }: { host: RefObject<HTMLElement | null> }) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const camera = useCameraController();
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    let frame = 0;
    let ready = false;
    let suspended = false;
    let disposed = false;
    const update = () => {
      frame = 0;
      if (!ready || suspended || disposed || (camera && (camera.phase !== "idle" || camera.interacting))) return;
      const { nodes, transform } = store.getState();
      // Counter-scaled titles outgrow their natural row: secondary card text keeps the far-zoom
      // floor in every view, including presentation, embeds and the offline viewer.
      const far = transform[2] < FAR_ZOOM;
      // Read the whole canvas before writing: interleaving clientWidth and icon
      // mutations forces one complete layout per card.
      const identity = nodes.flatMap((n) => {
        if (n.type !== "diagram") return [];
        const title = root.querySelector<HTMLElement>(
          `[data-testid="node-${CSS.escape(n.id)}"] [data-testid="card-title"]`,
        );
        const body = title?.closest<HTMLElement>(".nb");
        if (!title || !body) return [];
        const icon = body.querySelector<HTMLElement>(".stencil-icon");
        const height = iconDetail(
          body.classList.contains("nb-compact") ? 18 : body.classList.contains("nb-icon") ? 34 : 26,
          body.offsetHeight,
          transform[2],
        );
        const cs = getComputedStyle(title);
        measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        measure.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
        return [
          {
            body,
            title,
            icon,
            height,
            label: titleText(n.data.label, title.clientWidth, (s) => measure.measureText(s).width),
          },
        ];
      });
      for (const { body, title, icon, height, label } of identity) {
        if (body.hasAttribute("data-identity-far") !== far) body.toggleAttribute("data-identity-far", far);
        if (icon) icon.style.height = `${height}px`;
        if (title.textContent !== label) title.textContent = label;
      }
    };
    const schedule = () => {
      if (!disposed && !suspended && !frame) frame = requestAnimationFrame(update);
    };
    void document.fonts.ready.then(() => {
      ready = true;
      schedule();
    });
    const unsubscribe = store.subscribe((s, old) => {
      // Panning moves the frame without changing any fitting input.
      if (s.transform[2] !== old.transform[2] || s.nodes !== old.nodes) schedule();
    });
    const uncam = camera?.subscribe(schedule);
    // FrameDetail may resize cards after our store notification. React may also
    // replace a node variant or its title without changing the graph.
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === "attributes" ||
            (record.target instanceof Element && record.target.matches('[data-testid="card-title"]')) ||
            [...record.addedNodes].some(
              (node) =>
                node instanceof Element &&
                (node.matches('[data-testid="card-title"]') || node.querySelector('[data-testid="card-title"]')),
            ),
        )
      )
        schedule();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-detail-zoom"], childList: true, subtree: true });
    const reset = () => {
      for (const title of root.querySelectorAll<HTMLElement>('[data-testid="card-title"]'))
        title.textContent = title.title;
      for (const icon of root.querySelectorAll<HTMLElement>(".nb .stencil-icon")) icon.style.removeProperty("height");
      for (const body of root.querySelectorAll<HTMLElement>(".nb[data-identity-far]"))
        body.removeAttribute("data-identity-far");
    };
    const viewport = root.querySelector<HTMLElement>(".react-flow__viewport");
    const unregister = viewport
      ? registerFrameCapture(viewport, () => {
          suspended = true;
          // suspendFrameCapture itself normalizes the identity scale to the capture's scale(1).
          reset();
          return () => {
            suspended = false;
            schedule();
          };
        })
      : () => {};
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      uncam?.();
      observer.disconnect();
      unregister();
      reset();
    };
  }, [host, store, camera]);
  return null;
});
