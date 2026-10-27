import { memo, useEffect, useRef, useState } from "react";
import { useStore, useStoreApi } from "@xyflow/react";
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
  type FrameEnd,
  type FramePin,
} from "./camera/frameEdges";
import type { Rect } from "./geometry/rect";
import { roundedPath } from "./geometry/path";
import { FAR_ZOOM, textDetail } from "./detail";
import { iconDetail, titleText } from "./identity";
import { overviewConnection, overviewLayout, type OverviewHeader, type OverviewItem } from "./overview";
import { t, useLocale } from "../i18n";
import "../styles/canvas/detail.css";

type Chip = { id: string; name: string; x: number; y: number };
type Drawing = {
  pins: FramePin[];
  chips: Chip[];
  hint: boolean;
  headers: OverviewHeader[];
};
const empty: Drawing = { pins: [], chips: [], hint: false, headers: [] };

/** Screen-space detail after a settled move. It changes presentation only, never the document or viewport. */
export const FrameDetail = memo(
  function FrameDetail({ host, routing }: { host: RefObject<HTMLElement | null>; routing: RouteOptions }) {
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
        if (disposed || suspended || !fontsReady || camera.phase !== "idle" || camera.interacting) return;
        const s = store.getState();
        const [tx, ty, zoom] = s.transform;
        const edges = new Map(s.edges.map((e) => [e.id, e]));
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
        if (root.querySelector("[data-live-spotlight]"))
          for (const node of root.querySelectorAll<HTMLElement>(
            ".react-flow__node-diagram[data-id]:not([data-live-dim])",
          ))
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
        const flagged = new Set(
          [...root.querySelectorAll<HTMLElement>('[data-testid^="check-marker-"]')].map((el) =>
            el.dataset.testid!.slice("check-marker-".length),
          ),
        );
        const cards = new Map<string, HTMLElement>();
        const states = new Map<string, FrameEnd>();
        const blockers: Rect[] = [];
        const chips: Chip[] = [];
        const zone = new Set<string>(camera.state.zone ? [camera.state.zone] : []);
        const children = new Map<string, string[]>();
        for (const node of s.nodeLookup.values())
          if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
        const pending = [...zone];
        for (let parent = pending.pop(); parent; parent = pending.pop())
          for (const id of children.get(parent) ?? [])
            if (!zone.has(id)) {
              zone.add(id);
              pending.push(id);
            }
        const frameNodes = [...root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")].flatMap((el) => {
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
                const original =
                  fonts.get(text) ??
                  (text.classList.contains("nb-label")
                    ? parseFloat(getComputedStyle(text).getPropertyValue("--title-font")) || 13.5
                    : undefined);
                if (text.classList.contains("nb-label")) text.style.removeProperty("font-size");
                else if (original) text.style.fontSize = `${original}px`;
              }
              widths.push({ body, key });
            }
          }
        }
        for (const { body, key } of widths) cardWidths.set(body, { key, width: body.offsetWidth });
        for (const { body, n } of frameNodes)
          if (body && n.type === "diagram") {
            body.style.width = `${cardWidths.get(body)!.width}px`;
            body.style.removeProperty("--rf-zoom-exact");
          }
        // Whole labels/pills disappear together; text runs counter-scale without touching the viewport transform.
        for (const el of root.querySelectorAll<HTMLElement>(
          ".nb-label, .nb-title, .nb-sub, .nb-kind, .grp-label, .fe-label-text, .lv-metric, .lv-alert, .lv-outcome, .lv-call-pill, .ann-text, .ann-note .ann-content, .ann-shape .ann-content, .ann-zone-label",
        )) {
          if (!fonts.has(el)) {
            const cs = getComputedStyle(el);
            fonts.set(
              el,
              el.classList.contains("nb-label")
                ? parseFloat(cs.getPropertyValue("--title-font")) || 13.5
                : parseFloat(cs.fontSize),
            );
          }
          const node = el.closest<HTMLElement>(".react-flow__node[data-id], [data-testid^='node-badge-']");
          const id = node?.dataset.id ?? node?.dataset.testid?.slice("node-badge-".length);
          const edgeLabel = el.closest<HTMLElement>('[data-testid^="edge-label-"], [data-call-edge]');
          const edge =
            edgeLabel &&
            edges.get(edgeLabel.dataset.callEdge ?? edgeLabel.dataset.testid?.slice("edge-label-".length) ?? "");
          const isActive = !!(id && active.has(id)) || !!(edge && (active.has(edge.source) || active.has(edge.target)));
          const title = el.classList.contains("nb-label") || el.classList.contains("grp-label");
          const detail =
            el.classList.contains("lv-alert") && id && lit.has(id)
              ? { show: true, scale: Math.max(1, 11 / (fonts.get(el)! * zoom)) }
              : textDetail(fonts.get(el)!, zoom, title || isActive, view, el.classList.contains("nb-label"));
          const whole = el.closest<HTMLElement>(".fe-label, .lv-metric, .lv-alert, .lv-outcome, .lv-call-pill") ?? el;
          whole.toggleAttribute("data-detail-text-hidden", !detail.show);
          if (!el.classList.contains("nb-label")) el.style.fontSize = `${fonts.get(el)! * detail.scale}px`;
        }
        // Counter-scaling must not turn a naturally single-line subtitle into a growing card.
        // Reserve two lines only when the original text needs them at the card's measured width.
        for (const { id, el, body } of frameNodes) {
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
          if (el.hasAttribute("data-detail-wrapped") !== wrapped) {
            el.toggleAttribute("data-detail-wrapped", wrapped);
          }
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
          if (n.type === "boundary" && far && !overview)
            chips.push({ id, name: "label" in n.data ? n.data.label : "", x: card.x + 10, y: card.y + 8 });
        }
        if (measure) measure.font = `500 10.5px ${getComputedStyle(root).fontFamily}`;
        const overviewNodes: OverviewItem[] = [];
        const overviewZones: OverviewItem[] = [];
        if (overview)
          for (const { id, n } of frameNodes) {
            const item = {
              id,
              name: "label" in n.data ? n.data.label : "text" in n.data ? n.data.text : "",
              box: cardBoxes.get(id)!,
              group: n.data.group ? `group:${n.data.group}` : undefined,
              spotlight: selected.has(id) || lit.has(id) || zone.has(id),
            };
            if (n.type === "diagram") overviewNodes.push(item);
            if (n.type === "boundary" || (n.type === "annotation" && "kind" in n.data && n.data.kind === "zone"))
              overviewZones.push(item);
          }
        const overviewDrawing = overviewLayout(
          overviewNodes,
          overviewZones,
          (text) => measure?.measureText(text).width ?? text.length * 7,
        );
        // Fit names inside their own text column after counter-scaling the font.
        for (const { n, body } of frameNodes) {
          const title = body?.querySelector<HTMLElement>('[data-testid="card-title"]');
          if (!title || !measure || !("label" in n.data)) continue;
          const icon = body?.querySelector<HTMLElement>(".stencil-icon");
          if (icon && body)
            icon.style.height = `${iconDetail(body.classList.contains("nb-compact") ? 18 : body.classList.contains("nb-icon") ? 34 : 26, body.offsetHeight, zoom)}px`;
          const cs = getComputedStyle(title);
          measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          measure.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
          const label = titleText(n.data.label, title.clientWidth, (text) => measure.measureText(text).width);
          if (title.textContent !== label) title.textContent = label;
          title.title = n.data.label;
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
            for (const e of s.edges) {
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
        const pins = [
          ...stackPins(
            candidates.filter((p) => p.side !== "bottom" && p.side !== "top"),
            reserved.routes,
            pinHeight,
            pinBlockers,
          ),
          ...stackPins(
            candidates.filter((p) => p.side === "top"),
            reserved.top,
            pinHeight,
            pinBlockers,
          ),
          ...stackPins(
            candidates.filter((p) => p.side === "bottom"),
            reserved.row,
            pinHeight,
            pinBlockers,
          ),
        ];
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
          const pin = pins.find((p) => p.id === edge.source || p.id === edge.target);
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
        for (const [id, card] of cards) {
          if (!active.has(id) || states.get(id) !== "in") continue;
          const subtitle = card.querySelector<HTMLElement>(".nb-sub");
          if (!subtitle || subtitle.hasAttribute("data-detail-text-hidden")) continue;
          const current = parseFloat(subtitle.style.fontSize);
          if (current * zoom >= 11) continue;
          const before = subtitle.style.fontSize;
          const cardBox = cardBoxes.get(id)!;
          subtitle.style.fontSize = `${Math.ceil((11 / zoom) * 1000) / 1000}px`;
          const enlarged = box(subtitle, origin);
          const after = box(card, origin);
          if (
            after.width !== cardBox.width ||
            after.height !== cardBox.height ||
            !placeTextFloor(enlarged, cardBox, [], [...lanes.values()])
          )
            subtitle.style.fontSize = before;
        }
        for (const badge of root.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"]')) {
          const id = badge.dataset.testid!.slice("node-badge-".length);
          if (!far && states.get(id) === "in")
            for (const chip of badge.querySelectorAll<HTMLElement>(".lv-metric, .lv-alert")) {
              const rect = box(chip, origin);
              if (rect.width && rect.height) blockers.push(rect);
            }
        }
        const edgeLabels = new Map(
          [...root.querySelectorAll<HTMLElement>('[data-testid^="edge-label-"]')].map((el) => [
            el.dataset.testid!.slice("edge-label-".length),
            el,
          ]),
        );
        // Test enlarged ink against labels that have not been placed yet too.
        // In Overview/Custom a rejected neighbour keeps its original position.
        const originalLabels = new Map<string, Rect>();
        for (const [id, label] of edgeLabels) {
          label.style.removeProperty("translate");
          if (fonts.has(label)) label.style.removeProperty("font-size");
          label.style.removeProperty("width");
          label.style.removeProperty("height");
          label.style.removeProperty("line-height");
          // Keep the dependency text's counter-scaled font from textDetail above.
          originalLabels.set(id, box(label, origin));
        }
        for (const el of root.querySelectorAll<HTMLElement | SVGElement>(".react-flow__edge[data-id]")) {
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
          const pin = pins.find((p) => (p.id === edge.source || p.id === edge.target) && states.get(p.id) === "pinned");
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
          if (!label) continue;
          label.style.removeProperty("translate");
          const text =
            label.querySelector<HTMLElement>(".fe-label-text") ??
            (!label.classList.contains("fe-chip") && !label.classList.contains("is-dot") ? label : null);
          if (text === label) {
            if (!fonts.has(text)) fonts.set(text, parseFloat(getComputedStyle(text).fontSize));
            text.style.removeProperty("font-size");
          }
          const baseline = text?.style.fontSize;
          const baselineFont = text ? (fonts.get(text) ?? parseFloat(getComputedStyle(text).fontSize)) : 0;
          let floorPlacement: Rect | null = null;
          if (!far && text && (active.has(edge.source) || active.has(edge.target)) && baselineFont * zoom < 11) {
            const enlargedFont = Math.ceil((11 / zoom) * 1000) / 1000;
            const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
            text.style.fontSize = `${enlargedFont}px`;
            // Measure the complete enlarged text in a natural-size pill, rather
            // than the router's fixed --fe-w/--fe-h box that clips its ink.
            label.style.width = "max-content";
            label.style.height = "auto";
            const ink = document.createRange();
            ink.selectNodeContents(text);
            let inkHeight = lineHeight * (enlargedFont / baselineFont);
            for (const rect of ink.getClientRects()) inkHeight = Math.max(inkHeight, rect.height / zoom);
            // Reserve leading past the measured ink, including transform rounding.
            label.style.lineHeight = `${Math.round(inkHeight) + 1}px`;
            floorPlacement = placeTextFloor(
              box(label, origin),
              inner,
              [...blockers, ...[...originalLabels].filter(([id]) => id !== edge.id).map(([, box]) => box)],
              [...lanes].filter(([id]) => id !== edge.id).map(([, points]) => points),
              lanes.get(edge.id),
            );
            if (!floorPlacement) {
              text.style.fontSize = baseline!;
              label.style.removeProperty("width");
              label.style.removeProperty("height");
              label.style.removeProperty("line-height");
            }
          }
          const b = box(label, origin);
          const path = lanes.get(edge.id);
          const homes = [...originalLabels].filter(([id]) => id !== edge.id).map(([, home]) => home);
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
          setHidden(label, hidden);
          if (!hidden && placed) {
            if ((cropped || floorPlacement) && (Math.abs(placed.x - b.x) > 0.01 || Math.abs(placed.y - b.y) > 0.01))
              label.style.translate = `${(placed.x - b.x) / zoom}px ${(placed.y - b.y) / zoom}px`;
            blockers.push(placed);
          }
        }
        // Call annotations belong to their edge too; a pinned caller must not leave a clipped pill.
        for (const pill of root.querySelectorAll<HTMLElement>("[data-call-edge]")) {
          const edge = edges.get(pill.dataset.callEdge ?? "");
          if (!edge) continue;
          pill.style.removeProperty("translate");
          const ends = edgeInFrame(
            states.get(edge.source) ?? "out",
            states.get(edge.target) ?? "out",
            active.has(edge.source) || active.has(edge.target),
          );
          const b = box(pill, origin);
          const path = routes.get(edge.id)?.points;
          let placed = cropped && ends.pill && path?.length ? placeFrameLabel(b, path.map(screen), inner, blockers) : b;
          if (phone && cropped && ends.pill) {
            const subject = cards.get(states.get(edge.source) === "in" ? edge.source : edge.target);
            if (subject) {
              const card = box(subject, origin);
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
        for (const badge of root.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"], [data-node-id]')) {
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
          headers: overviewDrawing.headers,
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
      };
      const schedule = () => {
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
      const uncam = camera.subscribe(schedule);
      const observer = new MutationObserver((records) => {
        // Rate ranking changes at the UI clock. Only flip edge ink here: traffic
        // must never remeasure a settled frame or rebuild its labels and routes.
        if (records.every((record) => record.attributeName === "data-live-main")) {
          if (root.hasAttribute("data-detail-overview"))
            for (const record of records)
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
        attributeFilter: ["data-live-spotlight", "data-live-dim", "data-live-main", "data-detail-measure"],
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
        ))
          text.style.removeProperty("font-size");
        for (const body of root.querySelectorAll<HTMLElement>(".nb")) body.style.removeProperty("width");
        for (const icon of root.querySelectorAll<HTMLElement>(".nb .stencil-icon")) icon.style.removeProperty("height");
        for (const label of root.querySelectorAll<HTMLElement>(".fe-label, [data-call-edge]")) {
          label.style.removeProperty("translate");
          if (fonts.has(label)) label.style.removeProperty("font-size");
          label.style.removeProperty("width");
          label.style.removeProperty("height");
          label.style.removeProperty("line-height");
        }
        for (const n of store.getState().nodes) {
          if (!("label" in n.data)) continue;
          const title = root.querySelector<HTMLElement>(
            `[data-testid="node-${CSS.escape(n.id)}"] [data-testid="card-title"]`,
          );
          if (title) title.textContent = n.data.label;
        }
        delete root.dataset.detailView;
        root.removeAttribute("data-detail-far");
        root.removeAttribute("data-detail-overview");
        root.removeAttribute("data-detail-dock");
        root.removeAttribute("data-detail-single-selection");
      };
      const unregister = viewport
        ? registerFrameCapture(viewport, () => {
            suspended = true;
            // Capture replaces the viewport transform with scale(1). Identity ink uses that same scale.
            const scale = viewport.style.getPropertyValue("--rf-zoom-exact");
            viewport.style.setProperty("--rf-zoom-exact", "1");
            reset();
            return () => {
              if (scale) viewport.style.setProperty("--rf-zoom-exact", scale);
              else viewport.style.removeProperty("--rf-zoom-exact");
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
        {drawing.headers.map((header) => (
          <button
            key={header.id}
            className="overview-zone-header"
            data-testid={`zone-focus-${header.id.replace(/^group:/, "")}`}
            data-overview-count={header.count}
            style={{ left: header.box.x, top: header.box.y, width: header.box.width, height: header.box.height }}
            onClick={() => camera?.dispatch({ type: "view.requested", view: "focus", zone: header.id })}
          >
            {header.lines.join("\n")}
          </button>
        ))}
        {drawing.chips.map((chip) => (
          <button
            key={chip.id}
            className="detail-group-chip"
            data-testid={`zone-focus-${chip.id.replace(/^group:/, "")}`}
            style={{ left: chip.x, top: chip.y }}
            onClick={() => camera?.dispatch({ type: "view.requested", view: "focus", zone: chip.id })}
          >
            <FrameTitle id={chip.id} fallback={chip.name} />
          </button>
        ))}
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

/** Authored words update in the same store commit as the card and inspector. */
const FrameTitle = memo(function FrameTitle({ id, fallback }: { id: string; fallback: string }) {
  return useStore((state) => {
    const label = state.nodeLookup.get(id)?.data.label;
    return typeof label === "string" ? label : fallback;
  });
});
