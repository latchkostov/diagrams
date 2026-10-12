import { useLayoutEffect, useRef, useState } from "react";
import { Handle, useStore, useUpdateNodeInternals } from "@xyflow/react";
import type { Side } from "../../model/types";
import { CHIP_ORDER, freeSide, type Rect } from "./chipPlacement";
import { sidePosition } from "../edges/routing";
import { useDiagram } from "../DiagramContext";
import { formatCombo } from "../../editor/shortcuts";

/**
 * The "+" on a single selected node (D3): a click opens quick-add for the next node, connected downstream;
 * a drag is a connect gesture (D1). It's a handle, so dragging it connects like any other. It sits on the
 * downstream side, or the first free side when a neighbour or an edge label is there.
 */
export function GrowChip({ id, x, y }: { id: string; x: number; y: number }) {
  const { direction, grow } = useDiagram();
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<Side | "corner">(CHIP_ORDER[direction][0]);
  const update = useUpdateNodeInternals();
  // React Flow learns a handle's place when its node is measured: tell it about the chip as it moves.
  // On screen the chip keeps its size at any zoom, so in flow terms it moves as the zoom does.
  const zoomStep = useStore((s) => Math.floor(s.transform[2] * 50));
  useLayoutEffect(() => update(id), [id, side, zoomStep, update]);
  // Where the edges' labels are: they move when edges change (an insert, a reconnect) or reroute.
  const edges = useStore((s) => s.edges);
  useLayoutEffect(() => {
    const place = () => {
      const node = ref.current?.closest(".react-flow__node");
      const flow = node?.closest(".react-flow");
      if (!node || !flow) return;
      const card = (node.querySelector(".nb") ?? node).getBoundingClientRect();
      const taken: Rect[] = [];
      for (const el of flow.querySelectorAll(".react-flow__node, .fe-label")) {
        // Backdrops (boundaries, zones) are behind everything: a chip may sit on them.
        if (el === node || el.matches(".react-flow__node-boundary") || el.querySelector(".ann-zone")) continue;
        taken.push(el.getBoundingClientRect());
      }
      setSide(freeSide(card, taken, CHIP_ORDER[direction]));
    };
    place();
    // Again once the routes and their labels (and the zoom's CSS) have caught up with this change.
    const id = requestAnimationFrame(() => requestAnimationFrame(place));
    return () => cancelAnimationFrame(id);
  }, [x, y, direction, edges, zoomStep]);
  const combo = formatCombo(direction === "TB" ? "Alt+ArrowDown" : "Alt+ArrowRight");
  return (
    <Handle
      ref={ref}
      id="grow"
      type="source"
      position={sidePosition[side === "corner" ? CHIP_ORDER[direction][0] : side]}
      className="grow-chip"
      data-side={side}
      data-testid={`grow-chip-${id}`}
      title={`Add the next node (${combo}). Drag to connect`}
      // The keyboard way is Alt+arrow (the node's own keys); the chip is for the pointer.
      aria-hidden
      onClick={(e) => {
        e.stopPropagation();
        grow?.(id);
      }}
    >
      <svg viewBox="0 0 20 20" aria-hidden>
        <path d="M10 5.5v9M5.5 10h9" />
      </svg>
    </Handle>
  );
}
