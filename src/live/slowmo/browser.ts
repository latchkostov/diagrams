// Browser ports for the lazy replay: screen geometry and published painter readouts.
import { stencilRole } from "../../stencils/roles";
import type { MessageTrace } from "../../sim/types";
import type { DiagramLike } from "../../trace/journey";
import type { PaintedLabel } from "./overlay";
import type { SlowMotion } from "./session";
import { buildScript, type SlowScript } from "./script";

/** Builds the screen-paced script after replay code has arrived. */
export function screenScript(o: {
  trace: MessageTrace;
  diagram: DiagramLike;
  reduced: boolean;
  waiting?: { lag(nodeId: string): number | undefined };
  root: ParentNode | null;
  zoom: number;
}): SlowScript {
  const stencils = new Map(o.diagram.nodes.map((n) => [n.id, n.stencil]));
  return buildScript({
    trace: o.trace,
    diagram: o.diagram,
    reduced: o.reduced,
    waiting: o.waiting,
    roleOf: (id) => stencilRole(stencils.get(id) ?? ""),
    edgeLength: (id) => {
      const path = o.root?.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${CSS.escape(id)}"] path.react-flow__edge-path`,
      );
      const length = path?.getTotalLength?.() ?? 0;
      return length > 0 ? length * o.zoom : 260;
    },
  });
}

/** Publishes the replay painter's readout and dims badges outside its path. */
export function publishReplay(
  canvas: HTMLCanvasElement,
  labels: readonly PaintedLabel[],
  root: HTMLElement | null,
  session: Pick<SlowMotion, "getState" | "publish" | "frame">,
  mode: string,
  reset: () => void,
) {
  const s = session.getState();
  if (s.status === "on") {
    if (s.playing) session.publish();
    const f = session.frame();
    canvas.dataset.slowmo = s.playing ? "playing" : "paused";
    canvas.dataset.slowmoCamera = mode;
    canvas.dataset.slowmoProgress = String(s.script ? Math.round((s.t / Math.max(1, s.script.duration)) * 1000) : 0);
    canvas.dataset.slowmoBeat = String(f?.beat ?? -1);
    canvas.dataset.slowmoDots = String(f?.moving ?? 0);
    canvas.dataset.slowmoCaptions = JSON.stringify(labels);
    root?.setAttribute("data-live-slowmo", "on");
    // Badges off the path step back with their nodes.
    const path = new Set(s.script?.nodes ?? []);
    for (const el of root?.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"]') ?? []) {
      const off = !path.has(el.dataset.testid!.slice("node-badge-".length));
      if (off !== el.hasAttribute("data-slowmo-off")) el.toggleAttribute("data-slowmo-off", off);
    }
  } else if (canvas.dataset.slowmo) {
    for (const a of [
      "data-slowmo",
      "data-slowmo-camera",
      "data-slowmo-progress",
      "data-slowmo-beat",
      "data-slowmo-dots",
      "data-slowmo-captions",
    ])
      canvas.removeAttribute(a);
    root?.removeAttribute("data-live-slowmo");
    for (const el of root?.querySelectorAll("[data-slowmo-off]") ?? []) el.removeAttribute("data-slowmo-off");
    reset();
  }
}
