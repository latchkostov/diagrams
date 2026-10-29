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
import "../styles/canvas/chips.css";
import { viewportParts } from "./viewportParts";
import { geometryPreparation } from "./geometryPreparation";

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
  const { style, direction, captions, hideDependencies } = useRoutingOptions();
  useEffect(() => {
    const root = host.current;
    if (root && chips) return mountChips(root, store, camera, { style, direction, captions, hideDependencies });
  }, [host, chips, store, camera, style, direction, captions, hideDependencies]);
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const geometry = geometryPreparation(root);
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
    let fittedTransform: number[] | undefined;
    let dirty = true;
    let panQueued = false;
    const inViewport = viewportParts();
    const fitted = new WeakMap<
      HTMLElement,
      { data: FlowNode["data"]; scale: string; far: boolean; revision: number }
    >();
    let revision = 0;
    let titles: Map<string, HTMLElement> | undefined;
    const update = () => {
      frame = 0;
      if (
        !ready ||
        suspended ||
        disposed ||
        (camera &&
          (camera.phase !== "idle" || (camera.interacting && !panQueued)) &&
          !root.hasAttribute("data-viewport-moving"))
      )
        return;
      panQueued = false;
      if (root.hasAttribute("data-low-zoom")) return;
      const state = store.getState();
      const { nodes, transform } = state;
      // Counter-scaled titles outgrow their natural row: secondary card text keeps the far-zoom
      // floor in every view, including presentation, embeds and the offline viewer.
      const scale = root.style.getPropertyValue("--rf-zoom-exact");
      const far = Math.min(transform[2], Number(scale) || transform[2]) < FAR_ZOOM;
      if (
        !dirty &&
        nodes === fittedNodes &&
        scale === fittedScale &&
        far === fittedFar &&
        transform === fittedTransform
      )
        return;
      if (dirty) revision++;
      dirty = false;
      fittedNodes = nodes;
      fittedScale = scale;
      fittedFar = far;
      fittedTransform = transform;
      geometry.sync(state);
      geometry.count("identity");
      const visible =
        nodes.length > 128
          ? inViewport(state, [
              document.activeElement?.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id,
              state.connection?.fromNode?.id,
              state.connection?.toNode?.id,
              ...(camera?.state.focus ?? []),
              ...(camera?.state.live?.focus ?? []),
              camera?.state.live?.subject,
            ])
          : null;
      // One query indexes every title: a per-node selector search scans the whole canvas each time.
      if (!titles) {
        titles = new Map();
        for (const title of root.querySelectorAll<HTMLElement>('[data-testid="card-title"]')) {
          const id = title.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id;
          if (id) titles.set(id, title);
        }
      }
      // Read the whole canvas before writing: interleaving clientWidth and icon
      // mutations forces one complete layout per card.
      const identity = nodes.flatMap((n) => {
        if (n.type !== "diagram") return [];
        if (visible && !visible.has(n.id)) return [];
        const title = titles!.get(n.id);
        const body = title?.closest<HTMLElement>(".nb");
        if (!title || !body) return [];
        const old = fitted.get(title);
        if (old?.data === n.data && old.scale === scale && old.far === far && old.revision === revision) return [];
        fitted.set(title, { data: n.data, scale, far, revision });
        const icon = body.querySelector<HTMLElement>(".stencil-icon");
        const wrapper = body.closest<HTMLElement>(".react-flow__node");
        const metrics = geometry.measure(
          n.id,
          "identity",
          [
            n.data,
            scale,
            far,
            body.style.width,
            body.className,
            title.className,
            wrapper?.hasAttribute("data-detail-expanded"),
            wrapper?.hasAttribute("data-detail-wrapped"),
            root.dataset.detailView,
            root.hasAttribute("data-detail-single-selection"),
          ],
          () => {
            const cs = getComputedStyle(title);
            return {
              height: body.offsetHeight,
              width: title.clientWidth,
              font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
              letterSpacing: cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing,
            };
          },
        );
        const height = iconDetail(
          body.classList.contains("nb-compact") ? 18 : body.classList.contains("nb-icon") ? 34 : 26,
          metrics.height,
          Number(scale) || transform[2],
        );
        measure.font = metrics.font;
        measure.letterSpacing = metrics.letterSpacing;
        return [
          {
            body,
            title,
            icon,
            height,
            label: titleText(n.data.label, metrics.width, (s) => measure.measureText(s).width),
          },
        ];
      });
      for (const { body, title, icon, height, label } of identity) {
        if (body.hasAttribute("data-identity-far") !== far) body.toggleAttribute("data-identity-far", far);
        if (icon && icon.style.height !== `${height}px`) icon.style.height = `${height}px`;
        if (title.textContent !== label) title.textContent = label;
      }
      // This pass already saw the current DOM; its own title writes must not schedule another.
      observer.takeRecords();
      geometry.report();
    };
    const schedule = () => {
      if (!disposed && !suspended && !frame) frame = requestAnimationFrame(update);
    };
    const fontsChanged = () => {
      geometry.clear();
      dirty = true;
      schedule();
    };
    document.fonts.addEventListener?.("loadingdone", fontsChanged);
    document.fonts.addEventListener?.("loadingerror", fontsChanged);
    void document.fonts.ready.then(() => {
      ready = true;
      schedule();
    });
    const unsubscribe = store.subscribe((s, old) => {
      // Fit entrants before this frame paints, after the input handler. Never force layout in a pan handler.
      if (s.transform !== old.transform && s.transform[2] === old.transform[2]) {
        panQueued =
          !camera || camera.phase === "idle" || (camera.state.owner === "manual" && camera.state.view === "custom");
        // Camera-owned fits already run outside input and include fitting in their completion boundary.
        if (panQueued) schedule();
        else update();
      } else if (
        s.transform !== old.transform ||
        s.nodes !== old.nodes ||
        s.width !== old.width ||
        s.height !== old.height ||
        s.connection !== old.connection
      ) {
        if (s.transform !== old.transform) panQueued = false;
        fittedTransform = undefined;
        schedule();
      }
    });
    const focus = () => {
      fittedTransform = undefined;
      update();
    };
    root.addEventListener("focusin", focus);
    const uncam = camera?.subscribe(() => {
      fittedTransform = undefined;
      if (camera.phase === "idle" && !panQueued) update();
      else schedule();
    });
    // FrameDetail may resize cards after our store notification. React may also
    // replace a node variant or its title without changing the graph.
    const observer = new MutationObserver((records) => {
      // Translation and text changes keep the title elements. Remounts invalidate the membership cache.
      if (
        records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element))
      )
        titles = undefined;
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
        for (const record of records) {
          const node = record.target instanceof Element ? record.target.closest(".react-flow__node") : null;
          if (node) for (const title of node.querySelectorAll('[data-testid="card-title"]')) geometry.forget(title);
        }
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
          geometry.clear();
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
      root.removeEventListener("focusin", focus);
      unzoom();
      uncam?.();
      observer.disconnect();
      document.fonts.removeEventListener?.("loadingdone", fontsChanged);
      document.fonts.removeEventListener?.("loadingerror", fontsChanged);
      unregister();
      reset();
    };
  }, [host, store, camera]);
  return null;
});
