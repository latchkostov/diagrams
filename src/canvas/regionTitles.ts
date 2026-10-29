import { selectRoutes, type RouteOptions } from "./edges/useEdgeRoute";
import { TitleBands } from "./camera/frameEdges";
import type { Rect } from "./geometry/rect";
import type { ChipState } from "./lowZoom";
import { geometryPreparation } from "./geometryPreparation";

function titleObstacles(s: Parameters<typeof selectRoutes>[0], zoom: number, routing: RouteOptions): Rect[] {
  const obstacles: Rect[] = [...s.nodeLookup.values()]
    .filter(
      (n) =>
        n.type !== "boundary" && !(n.type === "annotation" && "kind" in n.data && n.data.kind === "zone") && !n.hidden,
    )
    .map((n) => ({
      x: n.internals.positionAbsolute.x * zoom,
      y: n.internals.positionAbsolute.y * zoom,
      width: (n.measured?.width ?? n.width ?? 0) * zoom,
      height: (n.measured?.height ?? n.height ?? 0) * zoom,
    }));
  // Below 60% a chip can reach past its card into free space: titles keep clear of what is drawn.
  for (const [id, chip] of (s as ChipState).ldChips?.nodes ?? []) {
    const at = s.nodeLookup.get(id)?.internals.positionAbsolute;
    if (at)
      obstacles.push({
        x: (at.x + chip.x) * zoom,
        y: (at.y + chip.y) * zoom,
        width: chip.width * zoom,
        height: chip.height * zoom,
      });
  }
  for (const route of selectRoutes(s, routing).values())
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      obstacles.push({
        x: Math.min(a.x, b.x) * zoom - 2,
        y: Math.min(a.y, b.y) * zoom - 2,
        width: Math.abs(a.x - b.x) * zoom + 4,
        height: Math.abs(a.y - b.y) * zoom + 4,
      });
    }
  return obstacles;
}
/** Both title renderers reserve in the same order, including during a held wheel zoom. */
export function placeRegionTitles(
  root: HTMLElement,
  s: Parameters<typeof selectRoutes>[0],
  routing: RouteOptions,
  camera?: { readonly moving: boolean; readonly phase: string } | null,
) {
  if (camera && (camera.moving || camera.phase !== "idle")) return;
  if (
    !s.nodes.some(
      (n) => n.type === "boundary" || (n.type === "annotation" && "kind" in n.data && n.data.kind === "zone"),
    )
  )
    return;
  const [tx, ty, zoom] = s.transform;
  const geometry = geometryPreparation(root);
  const appearance = [
    root.style.getPropertyValue("--rf-zoom-exact"),
    root.style.getPropertyValue("--rf-zoom"),
    root.dataset.lowZoom,
  ];
  let origin: DOMRect | undefined;
  const labels = [...root.querySelectorAll<HTMLElement>(".grp-label, .ann-zone-label:not(.is-empty)")].filter(
    (el) => !el.hasAttribute("data-detail-text-hidden") && !el.closest(".is-editing"),
  );
  for (const el of labels) el.style.removeProperty("translate");
  const reads = labels.flatMap((el) => {
    const n = s.nodeLookup.get(el.closest<HTMLElement>(".react-flow__node")?.dataset.id ?? "");
    if (!n) return [];
    const at = n.internals.positionAbsolute;
    const rect = geometry.measure(
      el,
      "region-label",
      [
        n.data,
        n.measured?.width,
        n.measured?.height,
        el.className,
        el.textContent,
        el.style.fontSize,
        zoom,
        ...appearance,
      ],
      () => {
        origin ??= root.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          x: rect.x - origin.x - tx - at.x * zoom,
          y: rect.y - origin.y - ty - at.y * zoom,
        };
      },
    );
    return [{ el, n, at, rect }];
  });
  // Region chips share this pass with the natural labels. Read every size before
  // assigning any transform; a per-chip read/write forced scene-wide style work.
  const chips = [...root.querySelectorAll<HTMLElement>(".detail-group-chip")].map((el) => ({
    el,
    size: geometry.measure(el, "region-chip", [el.textContent, el.className, ...appearance], () => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
    })),
  }));
  const placements = geometry.measure(
    root,
    "region-placement",
    [
      selectRoutes(s, routing),
      zoom,
      (s as ChipState).ldChips,
      ...reads.flatMap(({ el, n, at, rect }) => [el, n.data, at.x, at.y, n.measured?.width, rect]),
      ...chips.flatMap(({ el, size }) => [el, size]),
    ],
    () => {
      const bands = new TitleBands(titleObstacles(s, zoom, routing));
      const writes: { el: HTMLElement; property: "translate" | "transform"; value: string }[] = [];
      for (const { el, n, at, rect } of reads) {
        const title = bands.place(
          { x: at.x * zoom, y: at.y * zoom, width: (n.measured?.width ?? 0) * zoom, height: 0 },
          { width: rect.width, height: rect.height },
        );
        writes.push({
          el,
          property: "translate",
          value: `${(title.x - at.x * zoom - rect.x) / zoom}px ${(title.y - at.y * zoom - rect.y) / zoom}px`,
        });
      }
      for (const { el, size } of chips) {
        const n = s.nodeLookup.get(el.dataset.regionId ?? "");
        if (!n) continue;
        const at = n.internals.positionAbsolute;
        const title = bands.place(
          { x: at.x * zoom, y: at.y * zoom, width: (n.measured?.width ?? 0) * zoom, height: 0 },
          size,
        );
        const transform = `scale(calc(1 / var(--region-zoom, 1))) translate(${title.x - at.x * zoom}px, ${title.y - at.y * zoom}px)`;
        writes.push({ el, property: "transform", value: transform });
      }
      return writes;
    },
  );
  for (const { el, property, value } of placements) {
    if (property === "transform" && el.style.getPropertyValue("--region-zoom") !== String(zoom))
      el.style.setProperty("--region-zoom", String(zoom));
    if (el.style[property] !== value) el.style[property] = value;
  }
}
