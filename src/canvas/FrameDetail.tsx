import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ViewportPortal, useStore, useStoreApi } from "@xyflow/react";
import type { RefObject } from "react";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { useCameraController } from "./camera/useCameraCore";
import { selectRoutes, routeInputFromStore, useRoutingOptions, type RouteOptions } from "./edges/useEdgeRoute";
import { registerFrameCapture } from "./camera/frameCapture";
import {
  cullLabel,
  contains,
  frameCardBounds,
  edgeInFrame,
  frameCrossing,
  innerFrame,
  visibleCanvas,
  oneHop,
  placeFrameLabel,
  pinRow,
  routeToPin,
  placeTextFloor,
  frameLanes,
  frameObstacles,
  clipFrameRoute,
  stackPins,
  titleBand,
  type FrameEnd,
  type FramePin,
} from "./camera/frameEdges";
import type { Rect } from "./geometry/rect";
import { inflate, union } from "./geometry/rect";
import { SpatialGrid } from "./geometry/spatial";
import { roundedPath } from "./geometry/path";
import { FAR_ZOOM, textDetail } from "./detail";
import { overviewConnection } from "./overview";
import { t, useLocale } from "../i18n";
import "../styles/canvas/detail.css";
import { IdentityDetail } from "./IdentityDetail";

type Chip = { id: string; name: string; x: number; y: number; width: number };

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
type Drawing = { pins: FramePin[]; chips: Chip[]; hint: boolean };
const empty: Drawing = { pins: [], chips: [], hint: false };

/** Screen-space detail after a settled move. It changes presentation only, never the document or viewport. */
export const FrameDetail = memo(function FrameDetail({
  host,
  routing,
  decorate,
}: {
  host: RefObject<HTMLElement | null>;
  routing: RouteOptions;
  decorate: boolean;
}) {
  return (
    <>
      <IdentityDetail host={host} />
      {decorate && <FrameDecoration host={host} routing={routing} />}
    </>
  );
});

const FrameDecoration = memo(
  function FrameDecoration({ host, routing }: { host: RefObject<HTMLElement | null>; routing: RouteOptions }) {
    const locale = useLocale();
    const { style, direction, captions, hideDependencies } = useRoutingOptions(routing);
    const camera = useCameraController();
    const store = useStoreApi<FlowNode, DiagramFlowEdge>();
    const [drawing, setDrawing] = useState(empty);
    const dismissed = useRef(false);
    useEffect(() => {
      const root = host.current;
      if (!root || !camera) return;
      let frame = 0;
      let suspended = false;
      let disposed = false;
      let fontsReady = false;
      void document.fonts.ready.then(() => {
        fontsReady = true;
        schedule();
      });
      let lastDrawing = "";
      let dirty = true;
      const fonts = new WeakMap<Element, number>();
      const cardWidths = new WeakMap<HTMLElement, { key: FlowNode["data"]; width: number }>();
      const wrapCache = new WeakMap<HTMLElement, { text: string; width: number; wrapped: boolean }>();
      const measure = document.createElement("canvas").getContext("2d");
      const box = (el: Element, origin: DOMRect): Rect => {
        const r = el.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
      };
      const setHidden = (el: HTMLElement | SVGElement, hidden: boolean) => {
        el.toggleAttribute("data-detail-hidden", hidden);
      };
      const update = () => {
        frame = 0;
        if (
          disposed ||
          suspended ||
          !fontsReady ||
          camera.phase !== "idle" ||
          camera.interacting ||
          root.hasAttribute("data-viewport-moving")
        )
          return;
        if (!dirty) return;
        dirty = false;
        const s = store.getState();
        // One root traversal; classify each element once rather than rescan the
        // canvas for every kind of decoration.
        const nodeElements: HTMLElement[] = [],
          textElements: HTMLElement[] = [],
          badges: HTMLElement[] = [],
          nodeBadges: HTMLElement[] = [],
          pills: HTMLElement[] = [];
        const edgeElements: (HTMLElement | SVGElement)[] = [];
        const edgeLabels = new Map<string, HTMLElement>();
        const flagged = new Set<string>();
        let spotlight = false;
        for (const el of root.querySelectorAll<HTMLElement | SVGElement>(
          '.react-flow__node[data-id],.react-flow__edge[data-id],[data-testid^="edge-label-"],[data-testid^="node-badge-"],[data-testid^="check-marker-"],[data-call-edge],[data-node-id],[data-live-spotlight],.nb-title,.nb-sub,.nb-kind,.grp-label,.fe-label-text,.lv-metric,.lv-alert,.lv-outcome,.lv-call-pill,.ann-text,.ann-note .ann-content,.ann-shape .ann-content,.ann-zone-label',
        )) {
          const classes = el.classList;
          const testid = el.dataset.testid ?? "";
          if (classes.contains("react-flow__node")) nodeElements.push(el as HTMLElement);
          else if (classes.contains("react-flow__edge")) edgeElements.push(el);
          else {
            const element = el as HTMLElement;
            if (testid.startsWith("edge-label-")) edgeLabels.set(testid.slice(11), element);
            if (testid.startsWith("check-marker-")) flagged.add(testid.slice(13));
            if (testid.startsWith("node-badge-")) nodeBadges.push(element);
            if (testid.startsWith("node-badge-") || el.hasAttribute("data-node-id")) badges.push(element);
            if (el.hasAttribute("data-call-edge")) pills.push(element);
            if (
              classes.contains("nb-title") ||
              classes.contains("nb-sub") ||
              classes.contains("nb-kind") ||
              classes.contains("grp-label") ||
              classes.contains("fe-label-text") ||
              classes.contains("lv-metric") ||
              classes.contains("lv-alert") ||
              classes.contains("lv-outcome") ||
              classes.contains("lv-call-pill") ||
              classes.contains("ann-text") ||
              classes.contains("ann-content") ||
              classes.contains("ann-zone-label")
            )
              textElements.push(element);
          }
          if (el.hasAttribute("data-live-spotlight")) spotlight = true;
        }
        const [tx, ty, zoom] = s.transform;
        const edges = new Map(s.edges.map((e) => [e.id, e]));
        const incident = new Map<string, DiagramFlowEdge[]>();
        for (const edge of s.edges)
          for (const id of [edge.source, edge.target]) {
            let list = incident.get(id);
            if (!list) incident.set(id, (list = []));
            list.push(edge);
          }
        // A subset can make the mode readout say Focus without requesting a new frame.
        // Cull only for a camera-owned Focus/Follow, never merely because selecting opened a dock.
        const view = camera.state.view;
        const far = zoom < FAR_ZOOM;
        const overview = far && view === "overview" && camera.state.mode === "live";
        const origin = root.getBoundingClientRect();
        const phone = window.innerWidth < 640;
        if (!origin.width || !origin.height) return;
        const frameBox = visibleCanvas(root);
        const cropped = view === "focus" || view === "follow";
        const dock = !!root.closest(".canvas-column")?.parentElement?.querySelector('[data-testid="inspector"]');
        const rtl = getComputedStyle(root).direction === "rtl";
        const padding = cropped
          ? innerFrame(frameBox.width, frameBox.height, view, dock, rtl, phone)
          : { x: 0, y: 0, width: frameBox.width, height: frameBox.height };
        const inner = { ...padding, x: padding.x + frameBox.x, y: padding.y + frameBox.y };
        const pinHeight = phone ? 44 : 28;
        const reserved = pinRow(inner, pinHeight);
        const selected = new Set(s.nodes.filter((n) => n.selected && n.type !== "boundary").map((n) => n.id));
        const lit = new Set(camera.state.live.focus);
        if (spotlight)
          for (const node of nodeElements)
            if (node.classList.contains("react-flow__node-diagram") && !node.hasAttribute("data-live-dim"))
              lit.add(node.dataset.id!);
        const subject = camera.state.live.subject ?? camera.state.live.focus[0];
        const fallback =
          camera.state.focus?.[0] ??
          root.dataset.detailHover ??
          [...s.nodeLookup.values()].find((n) => n.type === "diagram" && !n.hidden)?.id;
        const subjects =
          view === "follow" && subject
            ? new Set([...lit, subject])
            : selected.size
              ? selected
              : new Set(fallback ? [fallback] : []);
        const pinnedSet = oneHop(s.edges, subjects);
        if (view === "follow") for (const id of lit) pinnedSet.add(id);
        const active = oneHop(s.edges, new Set([...selected, ...lit]));
        if (selected.size || camera.state.zone) dismissed.current = true;
        root.dataset.detailView = view;
        root.toggleAttribute("data-detail-far", far);
        root.toggleAttribute("data-detail-overview", overview);
        root.toggleAttribute("data-detail-dock", dock);
        const cards = new Map<string, HTMLElement>();
        const states = new Map<string, FrameEnd>();
        const blockers: Rect[] = [];
        const chips: Chip[] = [];
        const zone = new Set<string>(camera.state.zone ? [camera.state.zone] : []);
        const children = new Map<string, string[]>();
        for (const node of s.nodeLookup.values())
          if (node.parentId) {
            let ids = children.get(node.parentId);
            if (!ids) children.set(node.parentId, (ids = []));
            ids.push(node.id);
          }
        const pending = [...zone];
        for (let parent = pending.pop(); parent; parent = pending.pop())
          for (const id of children.get(parent) ?? [])
            if (!zone.has(id)) {
              zone.add(id);
              pending.push(id);
            }
        const frameNodes = nodeElements.flatMap((el) => {
          const id = el.dataset.id!;
          const n = s.nodeLookup.get(id);
          return !n || n.hidden ? [] : [{ id, el, n, body: el.querySelector<HTMLElement>(".nb") }];
        });
        const widths: { body: HTMLElement; key: FlowNode["data"] }[] = [];
        // Reset every changed card before measuring any of them. Alternating a width
        // write with offsetWidth forced one whole-canvas layout per node on imports.
        for (const { id, el, n, body } of frameNodes) {
          const expanded = selected.has(id) || lit.has(id) || flagged.has(id);
          if (n.type === "diagram" && el.hasAttribute("data-detail-expanded") !== expanded) {
            el.toggleAttribute("data-detail-expanded", expanded);
          }
          if (body && n.type === "diagram") {
            const key = n.data;
            if (cardWidths.get(body)?.key !== key) {
              body.style.removeProperty("width");
              body.style.setProperty("--rf-zoom-exact", "1");
              for (const text of body.querySelectorAll<HTMLElement>(".nb-label,.nb-sub,.nb-kind")) {
                const original = fonts.get(text);
                if (text.classList.contains("nb-label")) {
                  text.style.removeProperty("font-size");
                  // A data-only edit must measure the full name, not the prior frame's abbreviation.
                  if ("label" in n.data && text.textContent !== n.data.label) text.textContent = n.data.label;
                } else if (original) text.style.fontSize = `${original}px`;
              }
              widths.push({ body, key });
            }
          }
        }
        for (const { body, key } of widths) cardWidths.set(body, { key, width: body.offsetWidth });
        for (const { body, n } of frameNodes)
          if (body && n.type === "diagram") {
            const width = `${cardWidths.get(body)!.width}px`;
            if (body.style.width !== width) body.style.width = width;
            body.style.removeProperty("--rf-zoom-exact");
          }
        // Whole labels/pills disappear together; text runs counter-scale without touching the viewport transform.
        // Card titles are not secondary text: the `.nb-label` rule in app-shared.css alone sizes them.
        const textChanges = textElements.map((el) => {
          if (!fonts.has(el)) fonts.set(el, parseFloat(getComputedStyle(el).fontSize));
          const node = el.closest<HTMLElement>(".react-flow__node[data-id], [data-testid^='node-badge-']");
          const id = node?.dataset.id ?? node?.dataset.testid?.slice("node-badge-".length);
          const edgeLabel = el.closest<HTMLElement>('[data-testid^="edge-label-"], [data-call-edge]');
          const edge =
            edgeLabel &&
            edges.get(edgeLabel.dataset.callEdge ?? edgeLabel.dataset.testid?.slice("edge-label-".length) ?? "");
          const isActive = !!(id && active.has(id)) || !!(edge && (active.has(edge.source) || active.has(edge.target)));
          const title = el.classList.contains("grp-label");
          const detail =
            title || el.classList.contains("ann-zone-label")
              ? { show: !title || !far, scale: 1 }
              : el.classList.contains("lv-alert") && id && lit.has(id)
                ? { show: true, scale: Math.max(1, 11 / (fonts.get(el)! * zoom)) }
                : textDetail(fonts.get(el)!, zoom, title || isActive, view);
          const whole = el.closest<HTMLElement>(".fe-label, .lv-metric, .lv-alert, .lv-outcome, .lv-call-pill") ?? el;
          return { el, whole, detail };
        });
        for (const { el, whole, detail } of textChanges) {
          whole.toggleAttribute("data-detail-text-hidden", !detail.show);
          el.style.fontSize = `${fonts.get(el)! * detail.scale}px`;
        }
        const titleBlockers = textElements.some(
          (el) => el.classList.contains("grp-label") || el.classList.contains("ann-zone-label"),
        )
          ? titleObstacles(s, zoom, { style, direction, captions, hideDependencies })
          : [];
        for (const el of textElements) {
          if (
            (!el.classList.contains("grp-label") && !el.classList.contains("ann-zone-label")) ||
            el.hasAttribute("data-detail-text-hidden")
          )
            continue;
          el.style.removeProperty("translate");
          const n = s.nodeLookup.get(el.closest<HTMLElement>(".react-flow__node")?.dataset.id ?? "");
          if (!n) continue;
          const at = n.internals.positionAbsolute;
          const r = el.getBoundingClientRect();
          const title = titleBand(
            { x: at.x * zoom, y: at.y * zoom, width: (n.measured?.width ?? 0) * zoom, height: 0 },
            { width: r.width, height: r.height },
            titleBlockers,
          );
          titleBlockers.push(title);
          el.style.translate = `${(title.x - (r.x - origin.x - tx)) / zoom}px ${(title.y - (r.y - origin.y - ty)) / zoom}px`;
        }
        // Counter-scaling must not turn a naturally single-line subtitle into a growing card.
        // Reserve two lines only when the original text needs them at the card's measured width.
        const wraps = frameNodes.map(({ id, el, body }) => {
          const expanded = selected.has(id) || lit.has(id) || flagged.has(id);
          const canWrap = expanded && (cropped || selected.size === 1);
          const subtitle = canWrap ? body?.querySelector<HTMLElement>(".nb-sub") : null;
          let wrapped = false;
          if (subtitle && measure) {
            const text = subtitle.textContent ?? "";
            const width = subtitle.clientWidth;
            let cached = wrapCache.get(subtitle);
            if (!cached || cached.text !== text || cached.width !== width) {
              const cs = getComputedStyle(subtitle);
              measure.font = `${cs.fontWeight} ${fonts.get(subtitle)}px ${cs.fontFamily}`;
              measure.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
              cached = { text, width, wrapped: measure.measureText(text).width > width };
              wrapCache.set(subtitle, cached);
            }
            wrapped = cached.wrapped;
          }
          return { el, wrapped };
        });
        for (const { el, wrapped } of wraps)
          if (el.hasAttribute("data-detail-wrapped") !== wrapped) {
            el.toggleAttribute("data-detail-wrapped", wrapped);
          }
        const cardBoxes = new Map(frameNodes.map(({ id, el }) => [id, box(el, origin)]));
        for (const { id, el, n } of frameNodes) {
          const card = cardBoxes.get(id)!;
          const painted = !cropped || contains(inner, frameCardBounds(card));
          const hidden =
            (n.type === "diagram" && !painted && cropped) ||
            (n.type === "annotation" &&
              camera.state.mode === "live" &&
              far &&
              "kind" in n.data &&
              n.data.kind === "note") ||
            (n.type === "boundary" && camera.state.mode === "live" && cropped && !contains(inner, card));
          setHidden(el, hidden);
          states.set(id, hidden ? (pinnedSet.has(id) ? "pinned" : "out") : "in");
          if (n.type === "diagram") {
            cards.set(id, el);
            if (!hidden) blockers.push(card);
          }
          if (n.type === "boundary" && far)
            chips.push({
              id,
              name: "label" in n.data ? n.data.label : "",
              ...n.internals.positionAbsolute,
              width: n.measured?.width ?? 0,
            });
        }
        // React Flow's ResizeObserver measures the resized wrappers once. An explicit
        // updateNodeInternals here schedules a second forced measurement of the same cards.
        const routes = selectRoutes(s, { style, direction, captions, hideDependencies });
        const screen = (p: { x: number; y: number }) => ({ x: p.x * zoom + tx, y: p.y * zoom + ty });
        const candidates: Omit<FramePin, "box">[] = [];
        if (cropped)
          for (const id of pinnedSet) {
            if (states.get(id) !== "pinned") continue;
            const node = s.nodeLookup.get(id);
            if (!node || node.type !== "diagram") continue;
            let crossing: ReturnType<typeof frameCrossing> = null;
            for (const e of incident.get(id) ?? []) {
              if ((e.source !== id && e.target !== id) || states.get(e.source === id ? e.target : e.source) !== "in")
                continue;
              const points = routes.get(e.id)?.points;
              if (points?.length)
                crossing = frameCrossing((e.source === id ? [...points].reverse() : points).map(screen), inner, true);
              if (crossing) break;
            }
            if (!crossing) {
              const target = node.internals.positionAbsolute;
              crossing = frameCrossing(
                [{ x: inner.x + inner.width / 2, y: inner.y + inner.height / 2 }, screen(target)],
                inner,
              );
            }
            if (crossing)
              candidates.push({
                id,
                name: "label" in node.data ? node.data.label : "",
                crossing: crossing.point,
                side: crossing.side,
                width: Math.min(200, Math.max(80, ("label" in node.data ? node.data.label : "").length * 7 + 28)),
                spotlit: lit.has(id),
              });
          }
        // Keep inline-end pins above the credit; stack from their own route crossing toward the centre.
        const pinBlockers = blockers.map((card) => ({
          x: card.x - 8,
          y: card.y - 16,
          width: card.width + 16,
          height: card.height + 48,
        }));
        const sidePins = stackPins(
          candidates.filter((p) => p.side !== "bottom" && p.side !== "top"),
          reserved.routes,
          pinHeight,
          pinBlockers,
        );
        const missing = (placed: FramePin[]) =>
          candidates.filter((p) => lit.has(p.id) && !placed.some((pin) => pin.id === p.id));
        const topPins = stackPins(
          [
            ...missing(sidePins).map((p) => ({ ...p, side: "top" as const })),
            ...candidates.filter((p) => p.side === "top" && !lit.has(p.id)),
          ],
          reserved.top,
          pinHeight,
          pinBlockers,
        );
        const pins = [
          ...sidePins,
          ...topPins,
          ...stackPins(
            [
              ...missing([...sidePins, ...topPins]).map((p) => ({ ...p, side: "bottom" as const })),
              ...candidates.filter((p) => p.side === "bottom" && !lit.has(p.id)),
            ],
            reserved.row,
            pinHeight,
            pinBlockers,
          ),
        ];
        const pinsById = new Map(pins.map((pin) => [pin.id, pin]));
        const edgePins = new Map(
          s.edges.map((edge) => [edge.id, pinsById.get(edge.source) ?? pinsById.get(edge.target)]),
        );
        const retained = new Set(pins.map((pin) => pin.id));
        for (const [id, state] of states) if (state === "pinned" && !retained.has(id)) states.set(id, "out");
        blockers.push(...pins.map((pin) => pin.box));
        // Space lanes in screen pixels, including after clipping to pins. This
        // presentation pass never changes authored routes or exported geometry.
        const screenRoutes = new Map<string, { x: number; y: number }[]>();
        const routeObstacles = frameObstacles(
          routeInputFromStore(
            [...s.nodeLookup.values()].filter((n) => states.get(n.id) === "in"),
            [],
            { style, direction, captions, hideDependencies },
          ),
          screen,
        );
        // Expanded cards can paint beyond their measured routing bounds.
        routeObstacles.push(
          ...[...cards.keys()].filter((id) => states.get(id) === "in").map((id) => cardBoxes.get(id)!),
        );
        routeObstacles.push(...pins.map((p) => p.box));
        for (const edge of s.edges) {
          const route = routes.get(edge.id);
          if (!route) continue;
          const ends = edgeInFrame(states.get(edge.source) ?? "out", states.get(edge.target) ?? "out", true);
          if (cropped && !ends.draw) continue;
          const pin = edgePins.get(edge.id);
          let points = route.points.map(screen);
          if (cropped && pin) {
            if (pin.id === edge.source) points.reverse();
            points = routeToPin(points, reserved.routes, pin, routeObstacles);
            if (pin.id === edge.source) points.reverse();
          } else if (cropped && (states.get(edge.source) !== "in" || states.get(edge.target) !== "in")) {
            const reverse = states.get(edge.source) !== "in";
            if (reverse) points.reverse();
            points = clipFrameRoute(points, reserved.routes);
            if (reverse) points.reverse();
          }
          screenRoutes.set(edge.id, points);
        }
        const fixed = new Set([...routes].filter(([, route]) => route.custom).map(([id]) => id));
        const lanes =
          cropped && style === "smoothstep" ? frameLanes(screenRoutes, routeObstacles, fixed) : screenRoutes;
        // Subtitle ink may grow inside its existing slot, never its card. A
        // rejected candidate restores exactly the current detail behaviour.
        const subtitleFloors: { subtitle: HTMLElement; card: HTMLElement; cardBox: Rect; before: string }[] = [];
        for (const [id, card] of cards) {
          if (!active.has(id) || states.get(id) !== "in") continue;
          const subtitle = card.querySelector<HTMLElement>(".nb-sub");
          if (!subtitle || subtitle.hasAttribute("data-detail-text-hidden")) continue;
          const current = parseFloat(subtitle.style.fontSize);
          if (current * zoom >= 11) continue;
          subtitleFloors.push({ subtitle, card, cardBox: cardBoxes.get(id)!, before: subtitle.style.fontSize });
        }
        for (const { subtitle } of subtitleFloors)
          subtitle.style.fontSize = `${Math.ceil((11 / zoom) * 1000) / 1000}px`;
        const floorReads = subtitleFloors.map((floor) => ({
          ...floor,
          enlarged: box(floor.subtitle, origin),
          after: box(floor.card, origin),
        }));
        for (const { subtitle, cardBox, before, enlarged, after } of floorReads) {
          if (
            after.width !== cardBox.width ||
            after.height !== cardBox.height ||
            !placeTextFloor(enlarged, cardBox, [], [...lanes.values()])
          )
            subtitle.style.fontSize = before;
        }
        for (const badge of nodeBadges) {
          const id = badge.dataset.testid!.slice("node-badge-".length);
          if (!far && states.get(id) === "in")
            for (const chip of badge.querySelectorAll<HTMLElement>(".lv-metric, .lv-alert")) {
              const rect = box(chip, origin);
              if (rect.width && rect.height) blockers.push(rect);
            }
        }
        // Test enlarged ink against labels that have not been placed yet too.
        // In Overview/Custom a rejected neighbour keeps its original position.
        const originalLabels = new Map<string, Rect>();
        for (const label of edgeLabels.values()) {
          label.style.removeProperty("translate");
          if (fonts.has(label)) label.style.removeProperty("font-size");
          label.style.removeProperty("width");
          label.style.removeProperty("height");
          label.style.removeProperty("line-height");
          // Keep the dependency text's counter-scaled font from textDetail above.
          if (far) setHidden(label, true);
        }
        // Far labels are hidden entirely; retain the batched reads only for visible detail.
        if (!far) for (const [id, label] of edgeLabels) originalLabels.set(id, box(label, origin));
        const labelIndex = new SpatialGrid<string>();
        for (const [id, rect] of originalLabels) labelIndex.insert(rect, id);
        const pathIndex = new SpatialGrid<string>();
        if (!far)
          for (const [id, points] of lanes) {
            const bounds = union(points.map((p) => ({ ...p, width: 0, height: 0 })));
            if (bounds) pathIndex.insert(bounds, id);
          }
        const nearby = (id: string, b: Rect) => {
          const area = inflate(
            union([b, ...(lanes.get(id) ?? []).map((p) => ({ ...p, width: 0, height: 0 }))])!,
            Math.max(b.width, b.height),
          );
          return {
            homes: labelIndex
              .query(area)
              .filter((e) => e.item !== id)
              .map((e) => e.rect),
            paths: pathIndex
              .query(area)
              .filter((e) => e.item !== id)
              .map((e) => lanes.get(e.item)!),
          };
        };
        const labelReads = [...(far ? [] : edgeLabels)].map(([id, label]) => {
          const edge = edges.get(id);
          const text =
            label.querySelector<HTMLElement>(".fe-label-text") ??
            (!label.classList.contains("fe-chip") && !label.classList.contains("is-dot") ? label : null);
          if (text && !fonts.has(text)) fonts.set(text, parseFloat(getComputedStyle(text).fontSize));
          const baselineFont = text ? fonts.get(text)! : 0;
          const enlarge = !!(
            !far &&
            text &&
            edge &&
            (active.has(edge.source) || active.has(edge.target)) &&
            baselineFont * zoom < 11
          );
          return {
            id,
            label,
            text,
            baseline: text?.style.fontSize,
            baselineFont,
            enlarge,
            lineHeight: enlarge ? parseFloat(getComputedStyle(label).lineHeight) : 0,
          };
        });
        const enlargedFont = Math.ceil((11 / zoom) * 1000) / 1000;
        for (const { label, text, enlarge } of labelReads)
          if (enlarge && text) {
            text.style.fontSize = `${enlargedFont}px`;
            label.style.width = "max-content";
            label.style.height = "auto";
          }
        const inkReads = labelReads
          .filter((r) => r.enlarge)
          .map((r) => {
            const ink = document.createRange();
            ink.selectNodeContents(r.text!);
            let height = r.lineHeight * (enlargedFont / r.baselineFont);
            for (const rect of ink.getClientRects()) height = Math.max(height, rect.height / zoom);
            return { ...r, height };
          });
        for (const { label, height } of inkReads) label.style.lineHeight = `${Math.round(height) + 1}px`;
        const enlargedBoxes = new Map(inkReads.map(({ id, label }) => [id, box(label, origin)]));
        const labelsById = new Map(labelReads.map((r) => [r.id, r]));
        const labelWrites: (() => void)[] = [];
        for (const el of edgeElements) {
          const edge = edges.get(el.dataset.id ?? "");
          if (!edge) continue;
          const near = lit.has(edge.source) || lit.has(edge.target);
          el.toggleAttribute("data-live-near", !!lit.size && near);
          el.toggleAttribute("data-detail-selected-edge", selected.has(edge.source) || selected.has(edge.target));
          const ends = edgeInFrame(
            states.get(edge.source) ?? "out",
            states.get(edge.target) ?? "out",
            active.has(edge.source) || active.has(edge.target),
          );
          setHidden(
            el,
            (cropped && !ends.draw) ||
              (overview &&
                camera.state.mode === "live" &&
                !overviewConnection(near, el.hasAttribute("data-live-main"))),
          );
          el.toggleAttribute("data-detail-no-arrow", cropped && !ends.arrow);
          const pin = edgePins.get(edge.id);
          const route = routes.get(edge.id);
          const stroke = el.querySelector<SVGPathElement>(".fe-path");
          if (stroke && route) {
            let path = route.path;
            const points = lanes.get(edge.id);
            if (cropped && points?.length && (style === "smoothstep" || pin)) {
              path = roundedPath(
                points.map((p) => ({ x: (p.x - tx) / zoom, y: (p.y - ty) / zoom })),
                pin ? 0 : 10,
              );
              if (pin && ends.draw) el.removeAttribute("data-detail-no-arrow");
            }
            if (stroke.getAttribute("d") !== path) stroke.setAttribute("d", path);
          }

          const label = edgeLabels.get(edge.id);
          if (!label || far) continue;
          const reading = labelsById.get(edge.id)!;
          const enlarged = enlargedBoxes.get(edge.id);
          let floorPlacement: Rect | null = null;
          if (enlarged) {
            const { homes, paths } = nearby(edge.id, enlarged);
            floorPlacement = placeTextFloor(enlarged, inner, [...blockers, ...homes], paths, lanes.get(edge.id));
          }
          const b = floorPlacement ? enlarged! : originalLabels.get(edge.id)!;
          if (enlarged && !floorPlacement)
            labelWrites.push(() => {
              reading.text!.style.fontSize = reading.baseline!;
              label.style.removeProperty("width");
              label.style.removeProperty("height");
              label.style.removeProperty("line-height");
            });
          const path = lanes.get(edge.id);
          const homes = cropped ? nearby(edge.id, b).homes : [];
          const placed =
            floorPlacement ??
            (cropped && ends.pill && path?.length ? placeFrameLabel(b, path, inner, blockers, undefined, homes) : b);
          const hidden =
            far ||
            (cropped &&
              (!ends.pill ||
                (pin && label.classList.contains("fe-chip")) ||
                (view === "follow" && lit.size > 0 && !near) ||
                cullLabel(placed ?? b, frameBox, inner) ||
                !placed));
          labelWrites.push(() => {
            setHidden(label, !!hidden);
            if (
              !hidden &&
              placed &&
              (cropped || floorPlacement) &&
              (Math.abs(placed.x - b.x) > 0.01 || Math.abs(placed.y - b.y) > 0.01)
            )
              label.style.translate = `${(placed.x - b.x) / zoom}px ${(placed.y - b.y) / zoom}px`;
          });
          if (!hidden && placed) blockers.push(placed);
        }
        for (const write of labelWrites) write();
        // Call annotations belong to their edge too; a pinned caller must not leave a clipped pill.
        for (const pill of pills) pill.style.removeProperty("translate");
        const pillBoxes = new Map(pills.map((pill) => [pill, box(pill, origin)]));
        for (const pill of pills) {
          const edge = edges.get(pill.dataset.callEdge ?? "");
          if (!edge) continue;
          const ends = edgeInFrame(
            states.get(edge.source) ?? "out",
            states.get(edge.target) ?? "out",
            active.has(edge.source) || active.has(edge.target),
          );
          const b = pillBoxes.get(pill)!;
          const path = routes.get(edge.id)?.points;
          let placed = cropped && ends.pill && path?.length ? placeFrameLabel(b, path.map(screen), inner, blockers) : b;
          if (phone && cropped && ends.pill) {
            const subject = cards.get(states.get(edge.source) === "in" ? edge.source : edge.target);
            if (subject) {
              const card = cardBoxes.get(states.get(edge.source) === "in" ? edge.source : edge.target)!;
              placed = {
                ...b,
                x: Math.max(inner.x, Math.min(card.x, inner.x + inner.width - b.width)),
                y: card.y - b.height - 18,
              };
            }
          }
          const hidden = far || (cropped && (!ends.pill || !placed || !contains(inner, placed)));
          setHidden(pill, hidden);
          if (!hidden && placed) {
            if (cropped) pill.style.translate = `${(placed.x - b.x) / zoom}px ${(placed.y - b.y) / zoom}px`;
            blockers.push(placed);
          }
        }
        for (const badge of badges) {
          const id = badge.dataset.nodeId ?? badge.dataset.testid?.slice("node-badge-".length);
          if (id && states.has(id)) {
            setHidden(badge, states.get(id) !== "in" || far);
            badge.toggleAttribute("data-detail-dim", !!lit.size && !active.has(id));
          }
        }
        const next = {
          pins,
          chips,
          hint: far && !dismissed.current,
        };
        // Names subscribe with the editor commit; only frame geometry needs a deferred commit.
        const key = JSON.stringify({
          ...next,
          chips: chips.map(({ name: _name, ...layout }) => layout),
          pins: pins.map(({ name: _name, ...layout }) => layout),
        });
        if (key !== lastDrawing) {
          lastDrawing = key;
          setDrawing(next);
        }
        // Identity refits on this signal: publish it only when the zoom or a card's measured width changed,
        // never on a translation-only pan.
        if (widths.length || root.dataset.detailZoom !== String(zoom)) root.dataset.detailZoom = String(zoom);
        // Our own text/decoration commits are already represented by this pass.
        observer.takeRecords();
      };
      const schedule = () => {
        dirty = true;
        if (!disposed && !suspended && !frame) frame = requestAnimationFrame(update);
      };
      const selectionStyle = () => {
        const selected = store.getState().nodes.filter((n) => n.selected && n.type !== "boundary");
        root.toggleAttribute("data-detail-single-selection", selected.length === 1);
      };
      // Selection styling must commit before layout samples its geometry, even
      // while the camera is pending. Frame cropping itself still waits for idle.
      selectionStyle();
      const unstore = store.subscribe((s, old) => {
        if (s.nodes !== old.nodes) selectionStyle();
        if (
          s.transform !== old.transform ||
          s.nodes !== old.nodes ||
          s.edges !== old.edges ||
          s.width !== old.width ||
          s.height !== old.height
        )
          schedule();
      });
      const cameraKey = () => {
        const state = camera.state;
        return [state.view, state.mode, state.focus, state.zone, state.live.focus, state.live.subject];
      };
      let cameraInputs = cameraKey();
      const uncam = camera.subscribe(() => {
        const next = cameraKey();
        if (next.some((value, i) => value !== cameraInputs[i])) {
          cameraInputs = next;
          dirty = true;
        }
        if (dirty && !frame) frame = requestAnimationFrame(update);
      });
      const observer = new MutationObserver((records) => {
        // Our own title commits and hidden Overview readouts do not change geometry.
        // Filter individually so a mixed batch still handles traffic ink without a layout pass.
        const relevant = records.filter(
          (record) =>
            !(
              record.type === "childList" &&
              record.target instanceof Element &&
              (record.target.matches('[data-testid="card-title"]') ||
                (root.hasAttribute("data-detail-far") && record.target.closest('[data-testid^="node-badge-"]')))
            ),
        );
        if (!relevant.length) return;
        // Rate ranking changes at the UI clock. Only flip edge ink here: traffic
        // must never remeasure a settled frame or rebuild its labels and routes.
        if (relevant.every((record) => record.attributeName === "data-live-main")) {
          if (root.hasAttribute("data-detail-overview"))
            for (const record of relevant)
              if (record.target instanceof SVGElement)
                setHidden(
                  record.target,
                  !overviewConnection(
                    record.target.hasAttribute("data-live-near"),
                    record.target.hasAttribute("data-live-main"),
                  ),
                );
          return;
        }
        schedule();
      });
      observer.observe(root, {
        subtree: true,
        attributes: true,
        attributeFilter: [
          "data-live-spotlight",
          "data-live-dim",
          "data-live-main",
          "data-detail-measure",
          "data-viewport-moving",
        ],
      });
      const viewport = root.querySelector<HTMLElement>(".react-flow__viewport");
      if (viewport) observer.observe(viewport, { subtree: true, childList: true });
      const key = (e: KeyboardEvent) => {
        if (e.key === "Escape" && camera.state.zone) camera.dispatch({ type: "view.requested", view: "overview" });
        if (
          (e.code === "Digit3" || e.key === "3") &&
          e.shiftKey &&
          camera.state.mode === "live" &&
          !(e.target instanceof HTMLElement && e.target.closest("input,textarea,[contenteditable]"))
        ) {
          e.preventDefault();
          camera.dispatch({ type: "view.requested", view: "follow" });
        }
      };
      window.addEventListener("keydown", key);
      const reset = () => {
        const routes = selectRoutes(store.getState(), { style, direction, captions, hideDependencies });
        for (const el of root.querySelectorAll<SVGElement>(".react-flow__edge[data-id]")) {
          const path = routes.get(el.dataset.id ?? "")?.path;
          if (path) el.querySelector(".fe-path")?.setAttribute("d", path);
          el.removeAttribute("data-live-near");
          el.removeAttribute("data-detail-selected-edge");
        }
        for (const el of root.querySelectorAll<HTMLElement>(
          "[data-detail-hidden], [data-detail-text-hidden], [data-detail-no-arrow], [data-detail-expanded], [data-detail-wrapped], [data-detail-dim]",
        )) {
          el.removeAttribute("data-detail-hidden");
          el.removeAttribute("data-detail-text-hidden");
          el.removeAttribute("data-detail-no-arrow");
          el.removeAttribute("data-detail-expanded");
          el.removeAttribute("data-detail-wrapped");
          el.removeAttribute("data-detail-dim");
        }
        for (const text of root.querySelectorAll<HTMLElement>(
          ".nb-label,.nb-title,.nb-sub,.nb-kind,.grp-label,.fe-label-text,.lv-metric,.lv-alert,.lv-outcome,.lv-call-pill,.ann-text,.ann-note .ann-content,.ann-shape .ann-content,.ann-zone-label",
        )) {
          text.style.removeProperty("font-size");
          if (text.classList.contains("grp-label") || text.classList.contains("ann-zone-label"))
            text.style.removeProperty("translate");
        }
        for (const body of root.querySelectorAll<HTMLElement>(".nb")) body.style.removeProperty("width");
        for (const label of root.querySelectorAll<HTMLElement>(".fe-label, [data-call-edge]")) {
          label.style.removeProperty("translate");
          if (fonts.has(label)) label.style.removeProperty("font-size");
          label.style.removeProperty("width");
          label.style.removeProperty("height");
          label.style.removeProperty("line-height");
        }
        delete root.dataset.detailView;
        delete root.dataset.detailZoom;
        root.removeAttribute("data-detail-far");
        root.removeAttribute("data-detail-overview");
        root.removeAttribute("data-detail-dock");
        root.removeAttribute("data-detail-single-selection");
      };
      const unregister = viewport
        ? registerFrameCapture(viewport, () => {
            suspended = true;
            // suspendFrameCapture normalizes the identity scale for capture in every view.
            reset();
            return () => {
              suspended = false;
              selectionStyle();
              schedule();
            };
          })
        : () => {};
      schedule();
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        unstore();
        uncam();
        observer.disconnect();
        window.removeEventListener("keydown", key);
        unregister();
        reset();
      };
    }, [camera, host, store, style, direction, captions, hideDependencies, locale]);
    return (
      <div className="frame-detail" data-testid="frame-detail" data-export="skip">
        {drawing.hint && (
          <div className="overview-dig-hint" data-testid="overview-dig-hint">
            {t("camera.dig")}
          </div>
        )}
        {drawing.chips.length > 0 && <FrameChips chips={drawing.chips} routing={routing} />}
        {drawing.pins.map((pin) => (
          <button
            key={pin.id}
            className={`frame-pin${pin.spotlit ? " is-spotlit" : ""}`}
            data-testid={`focus-offscreen-${pin.id}`}
            style={{ left: pin.box.x, top: pin.box.y, width: pin.box.width }}
            onClick={() => camera?.goTo(pin.id)}
          >
            <span aria-hidden>
              {pin.side === "left" ? "‹" : pin.side === "right" ? "›" : pin.side === "top" ? "↑" : "↓"}
            </span>
            <FrameTitle id={pin.id} fallback={pin.name} />
          </button>
        ))}
      </div>
    );
  },
  (a, b) =>
    a.host === b.host &&
    (["style", "direction", "captions", "hideDependencies"] as const).every((key) => a.routing[key] === b.routing[key]),
);

/** Flow-space anchors pan with the viewport for free; zoom changes only their paint transform. */
const FrameChips = memo(function FrameChips({ chips, routing }: { chips: Chip[]; routing: RouteOptions }) {
  const host = useRef<HTMLDivElement>(null);
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const camera = useCameraController();
  useLayoutEffect(() => {
    const elements = host.current?.querySelectorAll<HTMLElement>(".detail-group-chip") ?? [];
    const update = () => {
      const state = store.getState();
      const zoom = state.transform[2];
      const obstacles = titleObstacles(state, zoom, routing);
      for (const [i, el] of [...elements].entries()) {
        const chip = chips[i];
        const box = titleBand(
          { x: chip.x * zoom, y: chip.y * zoom, width: chip.width * zoom, height: 0 },
          { width: el.offsetWidth, height: el.offsetHeight },
          obstacles,
        );
        obstacles.push(box);
        el.style.transform = `scale(${1 / zoom}) translate(${box.x - chip.x * zoom}px, ${box.y - chip.y * zoom}px)`;
      }
    };
    update();
    const sizes = new ResizeObserver(update);
    for (const el of elements) sizes.observe(el);
    const unsubscribe = store.subscribe((s, old) => {
      if (s.transform[2] !== old.transform[2] || s.nodes !== old.nodes || s.edges !== old.edges) update();
    });
    return () => {
      sizes.disconnect();
      unsubscribe();
    };
  }, [chips, store, routing]);
  return (
    <ViewportPortal>
      <div ref={host} className="detail-group-chips" data-testid="zone-chip-layer" data-export="skip">
        {chips.map((chip) => (
          <button
            key={chip.id}
            className="detail-group-chip nopan nodrag"
            data-testid={`zone-focus-${chip.id.replace(/^group:/, "")}`}
            style={{ left: chip.x, top: chip.y }}
            onClick={() => camera?.dispatch({ type: "view.requested", view: "focus", zone: chip.id })}
          >
            <FrameTitle id={chip.id} fallback={chip.name} />
          </button>
        ))}
      </div>
    </ViewportPortal>
  );
});

/** Authored words update in the same store commit as the card and inspector. */
const FrameTitle = memo(function FrameTitle({ id, fallback }: { id: string; fallback: string }) {
  return useStore((state) => {
    const label = state.nodeLookup.get(id)?.data.label;
    return typeof label === "string" ? label : fallback;
  });
});
