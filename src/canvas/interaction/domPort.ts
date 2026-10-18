import type { InteractionPort, InteractionScheduler, Resolution } from "./controller";
import type { ElementHandle, FocusTarget, InteractionPhase } from "./types";

/** What has keyboard focus: null for nothing, or the page's body. */
export function domActive(): ElementHandle | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el && el !== document.body ? el : null;
}

/** What the DOM port reads from the canvas (absent outside one: the Lab's Inspector). */
export interface DomCanvas {
  /** canvas-wrap. */
  root(): HTMLElement | null;
  /** Whether the diagram still has this node (shown) or connection: one that's gone never takes focus. */
  hasNode?(id: string): boolean;
  hasEdge?(id: string): boolean;
  /** These node ids in Tab's order (the canvas's reading order), visible ones only. */
  order?(ids: readonly string[]): string[];
  publish?(phase: InteractionPhase): void;
}

const nodeSelector = (id: string) => `.react-flow__node[data-id="${CSS.escape(id)}"]`;
const edgeSelector = (id: string) => `.react-flow__edge[data-id="${CSS.escape(id)}"]`;

/** React Flow keeps a node it hasn't measured yet hidden, and a hidden element can't take focus. */
const shown = (el: Element) => !(el instanceof HTMLElement) || el.style.visibility !== "hidden";

/** The DOM behind the interaction controller: the only code in the canvas that moves keyboard focus. */
export function createDomPort(canvas: DomCanvas): InteractionPort {
  const scope = (): ParentNode => canvas.root() ?? document;
  const node = (id: string): Resolution => {
    const el = scope().querySelector(nodeSelector(id));
    if (el && shown(el)) return { state: "ready", el, node: id };
    const known = canvas.hasNode ? canvas.hasNode(id) : !!el;
    return known ? { state: "waiting", node: id } : { state: "gone" };
  };
  const edge = (id: string): Resolution => {
    const el = scope().querySelector(edgeSelector(id));
    if (el) return { state: "ready", el };
    const known = canvas.hasEdge ? canvas.hasEdge(id) : false;
    return known ? { state: "waiting" } : { state: "gone" };
  };
  const resolve = (target: FocusTarget): Resolution => {
    switch (target.kind) {
      case "node":
        return node(target.id);
      case "edge":
        return edge(target.id);
      case "item": {
        const el = document.querySelector(`${nodeSelector(target.id)}, ${edgeSelector(target.id)}`);
        return el ? { state: "ready", el } : { state: "gone" };
      }
      case "canvas": {
        const el = canvas.root();
        return el?.isConnected ? { state: "ready", el } : { state: "gone" };
      }
      case "selection": {
        // The first selected node in Tab's order, else the first selected connection; else nothing (the fallback).
        const first = (canvas.order ? canvas.order(target.nodes) : [...target.nodes])[0];
        if (first) return node(first);
        const e = target.edges[0];
        return e ? edge(e) : { state: "gone" };
      }
      case "element": {
        const el = target.handle as Element;
        return el.isConnected ? { state: "ready", el } : { state: "gone" };
      }
      case "field": {
        // A request made while the Inspector is folded (or still shows the previous item) waits for it.
        const inspector = document.querySelector('[data-testid="inspector"]');
        if (!inspector || inspector.getAttribute("data-collapsed") === "1") return { state: "parked" };
        const el = inspector.querySelector(`[data-testid="inspector-field-${target.name}"]`);
        if (!el || (target.owner && el.getAttribute("data-name-field") !== target.owner)) return { state: "parked" };
        return { state: "ready", el };
      }
      case "paletteSearch": {
        const el = canvas.root()?.parentElement?.querySelector('[data-testid="palette-search"]');
        return el ? { state: "ready", el } : { state: "gone" };
      }
    }
  };
  return {
    active: domActive,
    resolve,
    focus(handle, select) {
      const el = handle as HTMLElement;
      // The Inspector's fields and the stencil search scroll into their panel; the canvas and its items never
      // scroll (the camera reveals them), nor does a menu's invoker.
      const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (el.closest('[data-testid="inspector"], [data-testid="palette-search"]')) el.focus();
      else el.focus({ preventScroll: true });
      if (text && select === "end") el.setSelectionRange(el.value.length, el.value.length);
      else if (text && select === "all") el.select();
      return document.activeElement === el;
    },
    connected: (handle) => (handle as Node).isConnected,
    publish: (phase) => canvas.publish?.(phase),
  };
}

/** Frames from the browser; microtasks after the current task's own work. */
export const domScheduler: InteractionScheduler = {
  frame(run) {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  },
  microtask: (run) => queueMicrotask(run),
};
