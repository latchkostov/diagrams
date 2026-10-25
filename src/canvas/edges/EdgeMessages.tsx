import { defineLazySurface } from "../../lib/lazySurface";
import { EdgeLabelRenderer, useStore } from "@xyflow/react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { DiagramFile } from "../../model/types";
import { pointAlong } from "../geometry/path";
import { useEdgeRoute, useRoutingOptions } from "./useEdgeRoute";

// The carried-types reader loads on intent (the first hover or focus on a flow) without the inspector's pickers,
// which a read-only canvas, an exported file's included, never shows.
const MessageTip = defineLazySurface({
  id: "edge.message-tip",
  load: () => import("./carriedTypes").then((m) => m.MessageTip),
  placeholder: { size: {}, testId: "edge.message-tip-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});

type Meta = Pick<DiagramFile, "simulations" | "planning">;

/** A flow edge's id from its line (the React Flow wrapper or anything in it) or its text label; else undefined. */
function flowEdgeAt(root: HTMLElement, target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  if (target.closest(".react-flow") !== root) return undefined;
  const label = target.closest<HTMLElement>(".fe-label[data-edge]");
  if (label) return label.dataset.dependency ? undefined : label.dataset.edge;
  const wrapper = target.closest(".react-flow__edge");
  // Dependencies (data-relation) open their own settings card, and carry no messages.
  return wrapper?.querySelector(":scope > g.fe:not([data-relation])")
    ? (wrapper.getAttribute("data-id") ?? undefined)
    : undefined;
}

/** The flow edge whose own wrapper holds focus (any focus: the reader tells keyboard focus apart). */
const focusedEdge = (root: HTMLElement) => {
  const el = document.activeElement;
  return el?.matches(".react-flow__edge") ? flowEdgeAt(root, el) : undefined;
};

/**
 * Carried message types on flow edges, for the whole canvas: one listener set instead of per-edge hooks, loaded after
 * the first view. While a flow edge is hovered (a short leave delay bridges its line and label) or focused, its
 * reader shows the types in the line's and label's titles, and in a readable card while it has keyboard focus.
 */
export function EdgeMessages({ meta }: { meta: Meta }) {
  const root = useStore((state) => state.domNode);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  useEffect(() => {
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hover = (id: string | undefined) => {
      clearTimeout(timer);
      if (id) setHovered(id);
      else timer = setTimeout(() => setHovered(undefined), 150);
    };
    const over = (e: PointerEvent) => hover(flowEdgeAt(root, e.target));
    // Leaving the window: no pointerover follows.
    const out = (e: PointerEvent) => {
      if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) hover(undefined);
    };
    const focus = () => setFocused(focusedEdge(root));
    // Whatever the pointer and focus were on while this loaded counts too.
    const under = root.querySelectorAll(":hover");
    hover(flowEdgeAt(root, under[under.length - 1] ?? null));
    focus();
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", focus);
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", focus);
    };
  }, [root]);
  return [...new Set([hovered, focused])].map(
    (id) =>
      id &&
      root && <EdgeReader key={id} root={root} id={id} meta={meta} hovered={id === hovered} focused={id === focused} />,
  );
}

function EdgeReader({
  root,
  id,
  meta,
  hovered,
  focused,
}: {
  root: HTMLElement;
  id: string;
  meta: Meta;
  hovered: boolean;
  focused: boolean;
}) {
  const route = useEdgeRoute(id, useRoutingOptions());
  const [tip, setTip] = useState<string>();
  // The titles FlowEdge renders stay its own: the types are added to them while read, and taken off after, unless
  // FlowEdge has rendered a new title meanwhile. Rerun as the route changes (a zoom can change the label's mode).
  useLayoutEffect(() => {
    if (!tip) return;
    const label = root.querySelector<HTMLElement>(`.fe-label[data-edge="${CSS.escape(id)}"]`);
    const base = label?.getAttribute("title");
    const text = [base, tip].filter(Boolean).join("\n");
    label?.setAttribute("title", text);
    // The line's own <title> (a deny rule's) wins; otherwise one is added for the types.
    const line = root.querySelector(`.react-flow__edge[data-id="${CSS.escape(id)}"] > g.fe`);
    const title =
      line && !line.querySelector(":scope > title") ? document.createElementNS(line.namespaceURI, "title") : null;
    if (title) {
      title.textContent = tip;
      line!.append(title);
    }
    return () => {
      title?.remove();
      if (label?.getAttribute("title") !== text) return;
      if (base == null) label.removeAttribute("title");
      else label.setAttribute("title", base);
    };
  }, [root, id, tip, route]);
  if (!route) return null;
  const mid = route.label ?? pointAlong(route.points, 0.5).point;
  return (
    <EdgeLabelRenderer>
      <MessageTip id={id} meta={meta} focused={focused} hovered={hovered} x={mid.x} y={mid.y} onTip={setTip} />
    </EdgeLabelRenderer>
  );
}
