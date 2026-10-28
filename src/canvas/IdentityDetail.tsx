import { memo, useEffect, type RefObject } from "react";
import { useStoreApi } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { iconDetail, titleText } from "./identity";
import { registerFrameCapture } from "./camera/frameCapture";
import { useCameraController } from "./camera/useCameraCore";
import { FAR_ZOOM } from "./detail";
import { mountIdentityZoom } from "./identityZoom";
import { mountChips } from "./mountChips";
import { useRoutingOptions } from "./edges/useEdgeRoute";
import { useInteraction } from "./interaction/context";
import "../styles/canvas/chips.css";

/** Identity belongs to every canvas, including presentation, embeds and offline viewers. */
export const IdentityDetail = memo(function IdentityDetail({
  host,
  chips = true,
}: {
  host: RefObject<HTMLElement | null>;
  chips?: boolean;
}) {
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const camera = useCameraController();
  const interaction = useInteraction();
  const { style, direction, captions, hideDependencies } = useRoutingOptions();
  useEffect(() => {
    const root = host.current;
    if (root && chips)
      return mountChips(root, store, camera, { style, direction, captions, hideDependencies }, interaction);
  }, [host, chips, store, camera, style, direction, captions, hideDependencies, interaction]);
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const unzoom = mountIdentityZoom(root, store, camera);
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return unzoom;
    let frame = 0;
    let ready = false;
    let suspended = false;
    let disposed = false;
    let fittedNodes: FlowNode[] | undefined;
    let fittedScale = "";
    let fittedFar = false;
    let dirty = true;
    const update = () => {
      frame = 0;
      if (
        !ready ||
        suspended ||
        disposed ||
        (camera && (camera.phase !== "idle" || camera.interacting) && !root.hasAttribute("data-viewport-moving"))
      )
        return;
      if (root.hasAttribute("data-low-zoom")) return;
      const { nodes, transform } = store.getState();
      // Counter-scaled titles outgrow their natural row: secondary card text keeps the far-zoom
      // floor in every view, including presentation, embeds and the offline viewer.
      const scale = root.style.getPropertyValue("--rf-zoom-exact");
      const far = Math.min(transform[2], Number(scale) || transform[2]) < FAR_ZOOM;
      if (!dirty && nodes === fittedNodes && scale === fittedScale && far === fittedFar) return;
      dirty = false;
      fittedNodes = nodes;
      fittedScale = scale;
      fittedFar = far;
      // One query indexes every title: a per-node selector search scans the whole canvas each time.
      const titles = new Map<string, HTMLElement>();
      for (const title of root.querySelectorAll<HTMLElement>('[data-testid="card-title"]')) {
        const id = title.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id;
        if (id) titles.set(id, title);
      }
      // Read the whole canvas before writing: interleaving clientWidth and icon
      // mutations forces one complete layout per card.
      const identity = nodes.flatMap((n) => {
        if (n.type !== "diagram") return [];
        const title = titles.get(n.id);
        const body = title?.closest<HTMLElement>(".nb");
        if (!title || !body) return [];
        const icon = body.querySelector<HTMLElement>(".stencil-icon");
        const height = iconDetail(
          body.classList.contains("nb-compact") ? 18 : body.classList.contains("nb-icon") ? 34 : 26,
          body.offsetHeight,
          Number(scale) || transform[2],
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
      // This pass already saw the current DOM; its own title writes must not schedule another.
      observer.takeRecords();
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
      ) {
        dirty = true;
        schedule();
      }
    });
    // Never a whole-canvas subtree observer (an idle canvas keeps none): the decoration's refit signal
    // is an attribute on the root itself, and titles are only ever replaced inside the viewport.
    observer.observe(root, { attributes: true, attributeFilter: ["data-detail-zoom", "data-viewport-moving"] });
    const viewport = root.querySelector<HTMLElement>(".react-flow__viewport");
    if (viewport) observer.observe(viewport, { childList: true, subtree: true });
    const reset = () => {
      // The full name lives in data-label; textContent may hold this frame's abbreviation.
      for (const title of root.querySelectorAll<HTMLElement>('[data-testid="card-title"]'))
        if (title.dataset.label !== undefined && title.textContent !== title.dataset.label)
          title.textContent = title.dataset.label;
      for (const icon of root.querySelectorAll<HTMLElement>(".nb .stencil-icon")) icon.style.removeProperty("height");
      for (const body of root.querySelectorAll<HTMLElement>(".nb[data-identity-far]"))
        body.removeAttribute("data-identity-far");
    };
    const unregister = viewport
      ? registerFrameCapture(viewport, () => {
          suspended = true;
          // suspendFrameCapture itself normalizes the identity scale to the capture's scale(1).
          reset();
          return () => {
            suspended = false;
            dirty = true;
            schedule();
          };
        })
      : () => {};
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      unzoom();
      uncam?.();
      observer.disconnect();
      unregister();
      reset();
    };
  }, [host, store, camera]);
  return null;
});
