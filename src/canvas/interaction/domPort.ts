import type { InteractionPort, InteractionScheduler, Resolution } from "./controller";
import type { ElementHandle, FocusTarget, InteractionPhase } from "./types";
import { captureTypeAhead, dismissPendingTypeAheadModal } from "../typeAhead";

/** Marks the Live bar's control that opens its side panels, so a panel's Esc has somewhere to give focus back. */
export const PANEL_OPENER_ATTR = "data-live-panel-opener";

/** What has keyboard focus: null for nothing, or the page's body. */
export function domActive(): ElementHandle | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el && el !== document.body ? el : null;
}

/** The injection form's enabled, own-visible controls; null leaves ordinary Tab traversal to the browser. */
export function dialogTabTarget(panel: HTMLElement, backward: boolean): HTMLElement | null {
  const controls = Array.from(
    panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((control) => !control.hasAttribute("disabled") && !control.hidden);
  const first = controls[0] ?? panel;
  const last = controls.at(-1) ?? panel;
  const active = document.activeElement;
  if (backward && (active === first || active === panel)) return last;
  if (!backward && (active === last || active === panel)) return first;
  return null;
}

/** What the DOM port reads from the canvas (absent outside one: the Lab's Inspector). */
export interface DomCanvas {
  /** canvas-wrap. */
  root(): HTMLElement | null;
  /** Whether this node or connection is expected to mount. Deliberately hidden items return false. */
  hasNode?(id: string): boolean;
  hasEdge?(id: string): boolean;
  /** These node ids in Tab's order (the canvas's reading order), visible ones only. */
  order?(ids: readonly string[]): string[];
  /** Counts the diagram's committed changes. */
  version?(): number;
  publish?(phase: InteractionPhase): void;
}

const nodeSelector = (id: string) => `.react-flow__node[data-id="${CSS.escape(id)}"]`;
const edgeSelector = (id: string) => `.react-flow__edge[data-id="${CSS.escape(id)}"]`;

/** Panels whose fields scroll into view as they take focus. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const SCROLLS = '[data-testid="inspector"], [data-testid="palette-search"], [data-testid="capacity-panel"]';

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
    // Visibility wins even if React Flow's old wrapper hasn't unmounted yet.
    if (canvas.hasEdge && !canvas.hasEdge(id)) return { state: "gone" };
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
        const found = node(target.id);
        return found.state === "gone" ? edge(target.id) : found;
      }
      case "canvas": {
        const el = canvas.root();
        return el?.isConnected ? { state: "ready", el } : { state: "gone" };
      }
      case "selection": {
        // The first selected node in Tab's order, else the first selected connection; else nothing (the fallback).
        const first = (canvas.order?.(target.nodes) ?? target.nodes)[0];
        if (first) return node(first);
        const e = target.edges[0];
        return e ? edge(e) : { state: "gone" };
      }
      case "element": {
        const el = target.handle as Element;
        return el.isConnected ? { state: "ready", el } : { state: "gone" };
      }
      case "field": {
        // A cold field can remain parked after its owner was deleted by a peer.
        if (target.owner && canvas.hasNode?.(target.owner) === false && canvas.hasEdge?.(target.owner) === false)
          return { state: "gone" };
        // A request made while the Inspector is folded (or still shows the previous item) waits for it.
        const inspector = document.querySelector('[data-testid="inspector"]');
        if (!inspector || inspector.getAttribute("data-collapsed") === "1") return { state: "parked" };
        // The panel's code failed to download (Inspector.tsx): its fields won't come until Retry.
        const failed = inspector.querySelector("[data-panel-unavailable]")?.getAttribute("data-panel-unavailable");
        if (failed != null && (!target.owner || failed === target.owner)) return { state: "gone" };
        const el = inspector.querySelector(
          target.name === "autoscaling-target"
            ? '[data-testid="autoscaling-target"]'
            : `[data-testid="inspector-field-${target.name}"]`,
        );
        if (!el || (target.owner && el.getAttribute("data-name-field") !== target.owner)) return { state: "parked" };
        return { state: "ready", el };
      }
      case "inspectorToggle":
      case "paletteSearch": {
        const el = canvas
          .root()
          ?.parentElement?.querySelector(
            target.kind === "paletteSearch" ? '[data-testid="palette-search"]' : '[data-testid="inspector-toggle"]',
          );
        return el ? { state: "ready", el } : { state: "gone" };
      }
      case "panelOpener": {
        const el = document.querySelector(`[${PANEL_OPENER_ATTR}]`);
        return el ? { state: "ready", el } : { state: "gone" };
      }
      case "readout": {
        // Shown means placed: a card with no free slot is hidden rather than covering an action.
        const el = document.querySelector(`[data-live-readout="${target.item}"][data-item="${CSS.escape(target.id)}"]`);
        return el && shown(el) ? { state: "ready", el } : { state: "gone" };
      }
      case "panelField": {
        // The panel lists the field once its session catches up (a commit, see the panel's rendered()).
        const panel = document.querySelector(`[data-testid="${CSS.escape(target.panel)}"]`);
        if (!panel) return { state: "gone" };
        const el = panel.querySelector(`[data-testid="${CSS.escape(target.field)}"]`);
        return el ? { state: "ready", el } : { state: "parked" };
      }
    }
  };
  return {
    active: domActive,
    resolve,
    focus(handle, select) {
      const el = handle as HTMLElement;
      // The Inspector's fields, the stencil search and Live's panel fields scroll into their panel; the canvas and
      // its items never scroll (the camera reveals them), nor does a menu's invoker.
      const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (el.closest(SCROLLS)) el.focus();
      else el.focus({ preventScroll: true });
      if (text && select === "end") el.setSelectionRange(el.value.length, el.value.length);
      else if (text && select === "all") el.select();
      return document.activeElement === el;
    },
    connected: (handle) => (handle as Node).isConnected,
    holdKeys: (done, options) =>
      captureTypeAhead(
        () => options?.multiline ?? false,
        done,
        options?.respectEditable ?? true,
        "controller",
        undefined,
        options?.text ?? null,
      ),
    dismissPendingModal: dismissPendingTypeAheadModal,
    elsewhere(handle) {
      const el = handle as Element;
      return !canvas.root()?.contains(el) || el.matches(EDITABLE);
    },
    field(handle) {
      const el = handle as Element;
      // A name field says whose name it is (useNameFields); any other text field of the Inspector is a field.
      const named = el.getAttribute?.("data-name-field");
      if (named) return { target: named };
      if (!el.matches?.(EDITABLE)) return null;
      if (!el.closest('[data-testid="inspector"]')) return null;
      return { field: (el.getAttribute("data-testid") ?? "").replace(/^inspector-field-/, "") };
    },
    type(handle, text) {
      const el = handle as HTMLElement;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      // A controlled field hears a value set through its prototype's setter, then an input event, as typing.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.setSelectionRange(el.value.length, el.value.length);
    },
    version: () => canvas.version?.() ?? 0,
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
