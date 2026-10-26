import { useEffect, useRef, useState } from "react";
import { useStoreApi } from "@xyflow/react";
import type { RefObject } from "react";
import type { DiagramFlowEdge, FlowNode } from "./types";
import { useCameraController } from "./camera/useCameraCore";
import { selectRoutes, type RouteOptions } from "./edges/useEdgeRoute";
import {
  cullLabel,
  contains,
  edgeInFrame,
  frameCrossing,
  innerFrame,
  oneHop,
  placeFrameLabel,
  stackPins,
  type FrameEnd,
  type FramePin,
} from "./camera/frameEdges";
import type { Rect } from "./geometry/rect";
import { drawTile, FAR_ZOOM, textDetail } from "./detail";
import { t, useLocale } from "../i18n";
import "../styles/canvas/detail.css";

type Chip = { id: string; name: string; x: number; y: number; group: boolean };
type Drawing = { pins: FramePin[]; chips: Chip[]; hint: boolean };
const empty: Drawing = { pins: [], chips: [], hint: false };

/** Screen-space detail after a settled move. It changes presentation only, never the document or viewport. */
export function FrameDetail({ host, routing }: { host: RefObject<HTMLElement | null>; routing: RouteOptions }) {
  const locale = useLocale();
  const { style, direction, captions, hideDependencies } = routing;
  const camera = useCameraController();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  const [drawing, setDrawing] = useState(empty);
  const dismissed = useRef(false);
  useEffect(() => {
    const root = host.current;
    if (!root || !camera) return;
    let frame = 0;
    let fontsReady = false;
    void document.fonts.ready.then(() => {
      fontsReady = true;
      schedule();
    });
    let lastDrawing = "";
    const fonts = new WeakMap<Element, number>();
    const cardWidths = new WeakMap<HTMLElement, { key: FlowNode["data"]; width: number }>();
    const box = (el: Element, origin: DOMRect): Rect => {
      const r = el.getBoundingClientRect();
      return { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
    };
    const setHidden = (el: HTMLElement | SVGElement, hidden: boolean) => {
      el.toggleAttribute("data-detail-hidden", hidden);
    };
    const update = () => {
      frame = 0;
      if (!fontsReady || camera.phase !== "idle" || camera.interacting) return;
      const s = store.getState();
      const [tx, ty, zoom] = s.transform;
      const edges = new Map(s.edges.map((e) => [e.id, e]));
      const view = camera.state.view;
      const far = zoom < FAR_ZOOM;
      const origin = root.getBoundingClientRect();
      if (!origin.width || !origin.height) return;
      const frameBox = { x: 0, y: 0, width: origin.width, height: origin.height };
      const cropped = view === "focus" || view === "follow";
      const dock = !!root.closest(".canvas-column")?.parentElement?.querySelector('[data-testid="inspector"]');
      const rtl = getComputedStyle(root).direction === "rtl";
      const inner = cropped ? innerFrame(origin.width, origin.height, view, dock, rtl) : frameBox;
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
          ? new Set([subject])
          : selected.size
            ? selected
            : new Set(fallback ? [fallback] : []);
      const pinnedSet = oneHop(s.edges, subjects);
      if (view === "follow") for (const id of lit) pinnedSet.add(id);
      const active = oneHop(s.edges, new Set([...selected, ...lit]));
      if (selected.size || camera.state.zone) dismissed.current = true;
      root.dataset.detailView = view;
      root.toggleAttribute("data-detail-far", far);
      root.toggleAttribute("data-detail-dock", dock);
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
      for (const el of root.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")) {
        const id = el.dataset.id!;
        const n = s.nodeLookup.get(id);
        if (!n || n.hidden) continue;
        const title = el.querySelector<HTMLElement>(".nb-label, .nb-title, .grp-label");
        const body = el.querySelector<HTMLElement>(".nb-card, .nb-compact");
        if (body && n.type === "diagram") {
          const key = n.data;
          if (cardWidths.get(body)?.key !== key) {
            body.style.removeProperty("width");
            for (const text of body.querySelectorAll<HTMLElement>(".nb-label,.nb-sub,.nb-kind")) {
              const original = fonts.get(text);
              if (original) text.style.fontSize = `${original}px`;
            }
            cardWidths.set(body, { key, width: body.offsetWidth });
          }
          body.style.width = `${cardWidths.get(body)!.width}px`;
        }
        const card = box(el, origin);
        const titleBox = title ? box(title, origin) : card;
        const painted = !cropped || contains(inner, titleBox);
        const tile = n.type !== "diagram" || drawTile(card.height, 1, lit.has(id));
        const hidden = n.type === "diagram" && ((!painted && cropped) || (far && !tile));
        setHidden(el, hidden);
        states.set(id, hidden ? (pinnedSet.has(id) ? "pinned" : "out") : "in");
        if (n.type === "diagram") {
          cards.set(id, el);
          if (!hidden) blockers.push(card);
          if (far && !hidden && (selected.has(id) || lit.has(id) || zone.has(id)))
            chips.push({
              id,
              name: "label" in n.data ? n.data.label : "",
              x: card.x + card.width / 2,
              y: card.y - 8,
              group: false,
            });
        }
        if (n.type === "boundary" && far)
          chips.push({ id, name: "label" in n.data ? n.data.label : "", x: card.x + 10, y: card.y + 8, group: true });
      }
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
      const phone = window.innerWidth < 640;
      const pins = stackPins(
        candidates,
        {
          ...inner,
          ...(phone ? { x: 8, width: origin.width - 16 } : {}),
          height: Math.max(28, inner.height - (view === "follow" ? 14 : 0)),
        },
        phone ? 44 : 28,
      );
      blockers.push(...pins.map((pin) => pin.box));
      for (const el of root.querySelectorAll<HTMLElement | SVGElement>(".react-flow__edge[data-id]")) {
        const edge = edges.get(el.dataset.id ?? "");
        if (!edge) continue;
        const near = lit.has(edge.source) || lit.has(edge.target);
        el.toggleAttribute("data-live-near", !!lit.size && near);
        const ends = edgeInFrame(states.get(edge.source) ?? "out", states.get(edge.target) ?? "out", near);
        setHidden(el, cropped && !ends.draw);
        el.toggleAttribute("data-detail-no-arrow", cropped && !ends.arrow);
        const label = root.querySelector<HTMLElement>(`[data-testid="edge-label-${CSS.escape(edge.id)}"]`);
        if (!label) continue;
        label.style.removeProperty("translate");
        const b = box(label, origin);
        const path = routes.get(edge.id)?.points;
        const placed = cropped && ends.pill && path?.length ? placeFrameLabel(b, path.map(screen), inner, blockers) : b;
        const hidden = far || (cropped && (!ends.pill || cullLabel(placed ?? b, frameBox, inner) || !placed));
        setHidden(label, hidden);
        if (!hidden && placed) {
          if (cropped && (Math.abs(placed.x - b.x) > 0.01 || Math.abs(placed.y - b.y) > 0.01))
            label.style.translate = `${(placed.x - b.x) / zoom}px ${(placed.y - b.y) / zoom}px`;
          blockers.push(placed);
        }
      }
      for (const badge of root.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"], [data-node-id]')) {
        const id = badge.dataset.nodeId ?? badge.dataset.testid?.slice("node-badge-".length);
        if (id && states.has(id)) {
          setHidden(badge, !lit.has(id) && (states.get(id) !== "in" || far));
          badge.toggleAttribute("data-detail-dim", !!lit.size && !active.has(id));
        }
      }
      // Whole labels/pills disappear together; text runs counter-scale without touching the viewport transform.
      for (const el of root.querySelectorAll<HTMLElement>(
        ".nb-label, .nb-title, .nb-sub, .nb-kind, .grp-label, .fe-label-text, .lv-metric, .lv-alert, .lv-outcome, .call-pill, .ann-text, .ann-note .ann-content, .ann-shape .ann-content, .ann-zone-label",
      )) {
        if (!fonts.has(el)) fonts.set(el, parseFloat(getComputedStyle(el).fontSize));
        const node = el.closest<HTMLElement>(".react-flow__node[data-id], [data-testid^='node-badge-']");
        const id = node?.dataset.id ?? node?.dataset.testid?.slice("node-badge-".length);
        const edgeLabel = el.closest<HTMLElement>('[data-testid^="edge-label-"]');
        const edge = edgeLabel && edges.get(edgeLabel.dataset.testid?.slice("edge-label-".length) ?? "");
        const isActive = !!(id && active.has(id)) || !!(edge && (active.has(edge.source) || active.has(edge.target)));
        const title = el.classList.contains("nb-label") || el.classList.contains("grp-label");
        const detail = textDetail(fonts.get(el)!, zoom, title || isActive, view);
        const whole = el.closest<HTMLElement>(".fe-label, .lv-metric, .lv-alert, .lv-outcome, .call-pill") ?? el;
        whole.toggleAttribute("data-detail-text-hidden", !detail.show);
        el.style.fontSize = `${fonts.get(el)! * detail.scale}px`;
      }
      const next = { pins, chips, hint: far && !dismissed.current };
      const key = JSON.stringify(next);
      if (key !== lastDrawing) {
        lastDrawing = key;
        setDrawing(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const unstore = store.subscribe((s, old) => {
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
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-live-spotlight", "data-live-dim"],
    });
    const viewport = root.querySelector(".react-flow__viewport");
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
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      unstore();
      uncam();
      observer.disconnect();
      window.removeEventListener("keydown", key);
      for (const el of root.querySelectorAll<HTMLElement>(
        "[data-detail-hidden], [data-detail-text-hidden], [data-detail-no-arrow]",
      )) {
        el.removeAttribute("data-detail-hidden");
        el.removeAttribute("data-detail-text-hidden");
        el.removeAttribute("data-detail-no-arrow");
      }
      for (const text of root.querySelectorAll<HTMLElement>(
        ".nb-label,.nb-title,.nb-sub,.nb-kind,.grp-label,.fe-label-text,.lv-metric,.lv-alert,.lv-outcome,.call-pill,.ann-text,.ann-note .ann-content,.ann-shape .ann-content,.ann-zone-label",
      ))
        text.style.removeProperty("font-size");
      for (const body of root.querySelectorAll<HTMLElement>(".nb-card,.nb-compact")) body.style.removeProperty("width");
      for (const label of root.querySelectorAll<HTMLElement>(".fe-label")) label.style.removeProperty("translate");
      delete root.dataset.detailView;
      root.removeAttribute("data-detail-far");
      root.removeAttribute("data-detail-dock");
    };
  }, [camera, host, store, style, direction, captions, hideDependencies, locale]);
  return (
    <div className="frame-detail" data-testid="frame-detail" data-export="skip">
      {drawing.hint && (
        <div className="overview-dig-hint" data-testid="overview-dig-hint">
          {t("camera.dig")}
        </div>
      )}
      {drawing.chips.map((chip) =>
        chip.group ? (
          <button
            key={chip.id}
            className="detail-group-chip"
            data-testid={`zone-focus-${chip.id.replace(/^group:/, "")}`}
            style={{ left: chip.x, top: chip.y }}
            onClick={() => camera?.dispatch({ type: "view.requested", view: "focus", zone: chip.id })}
          >
            {chip.name}
          </button>
        ) : (
          <span key={chip.id} className="detail-title-chip" style={{ left: chip.x, top: chip.y }}>
            {chip.name}
          </span>
        ),
      )}
      <svg className="frame-pin-leaders" aria-hidden>
        {drawing.pins
          .filter(
            (pin) => Math.hypot(pin.box.x + pin.box.width / 2 - pin.crossing.x, pin.box.y + 14 - pin.crossing.y) > 8,
          )
          .map((pin) => (
            <line
              key={pin.id}
              x1={pin.crossing.x}
              y1={pin.crossing.y}
              x2={pin.box.x + pin.box.width / 2}
              y2={pin.box.y + pin.box.height / 2}
            />
          ))}
      </svg>
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
          {pin.name}
        </button>
      ))}
    </div>
  );
}
