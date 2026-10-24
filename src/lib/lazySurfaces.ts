/** Metadata stays separate from loaders: enumerating surfaces never downloads their chunks. */
import { flushSync } from "react-dom";
export const lazySurfaces = [
  ["canvas.menu", "MenuList", "components/MenuList", "skip"],
  ["canvas.presence", "PresenceLayer", "canvas/PresenceLayer", "skip"],
  ["canvas.node-tips", "NodeTooltip", "canvas/NodeTooltip", "skip"],
  ["canvas.grow", "GrowChip", "canvas/nodes/GrowChip", "skip"],
  ["inspector.node", "NodePanel", "canvas/inspector/NodePanel", "skip"],
  ["inspector.edge", "EdgePanel", "canvas/inspector/EdgePanel", "skip"],
  ["inspector.identity", "NodeIdentity", "canvas/inspector/NodeIdentity", "skip"],
  ["inspector.messages", "MessageFields", "canvas/inspector/MessageFields", "skip"],
  ["inspector.properties", "PropsEditor", "canvas/inspector/PropsEditor", "skip"],
  ["inspector.call", "CallWaitFields", "canvas/inspector/CallWaitFields", "skip"],
  ["inspector.advanced", "EdgeAdvanced", "canvas/inspector/EdgeAdvanced", "skip"],
  ["inspector.simulation", "SimulationFields", "canvas/inspector/SimulationFields", "skip"],
  ["inspector.edge-shell", "lazyEdgePanel", "canvas/inspector/lazyEdgePanel", "skip"],
  ["inspector.group", "GroupPanel", "canvas/inspector/GroupPanel", "skip"],
  ["inspector.annotation", "AnnotationPanel", "canvas/inspector/AnnotationPanel", "skip"],
  ["inspector.diagram", "DiagramPanel", "canvas/inspector/DiagramPanel", "skip"],
  ["inspector.multi", "MultiPanel", "canvas/inspector/MultiPanel", "skip"],
  ["live.sections", "NodeDetailSections", "live/NodeDetailSections", "skip"],
  ["live.timeline", "Timeline", "live/Timeline", "skip"],
  ["live.more", "LiveMoreItems", "live/LiveMoreItems", "skip"],
  ["live.slow-timeline", "SlowTimeline", "live/slowmo/SlowTimeline", "skip"],
  ["live.simulations", "SimPanel", "live/SimPanel", "skip"],
  ["live.capacity", "CapacityPanel", "live/CapacityPanel", "skip"],
  ["live.capacity-analysis", "CapacityAnalysis", "live/CapacityAnalysis", "await"],
  ["live.bottleneck", "BottleneckCallout", "live/BottleneckCallout", "skip"],
  ["live.calls", "CallPills", "live/CallPills", "await"],
  ["live.threads", "CallPills", "live/CallPills", "await"],
  ["live.node-details", "NodeDetails", "live/NodeDetails", "skip"],
  ["live.edge-details", "NodeDetails", "live/NodeDetails", "skip"],
  ["live.history", "HoverHistory", "live/HoverHistory", "skip"],
  ["live.session", "LiveSession", "live/LiveSession", "await"],
  ["live.edit-capacity", "EditCapacity", "live/session/EditCapacity", "skip"],
  ["live.trouble", "TroubleCallout", "live/TroubleCallout", "skip"],
  ["live.events", "EventLog", "live/EventLog", "skip"],
  ["live.inject", "InjectDialog", "live/InjectDialog", "skip"],
  ["live.note", "NoteCallout", "live/NoteCallout", "await"],
  ["live.trace", "TraceCard", "live/TraceCard", "skip"],
  ["edge.reader", "EdgeMessages", "canvas/edges/EdgeMessages", "skip"],
  ["edge.message-tip", "carriedTypes", "canvas/edges/carriedTypes", "skip"],
] as const;

export type LazySurfaceId = (typeof lazySurfaces)[number][0];
export interface SurfaceRuntime {
  id: LazySurfaceId;
  active(): boolean;
  ensureLoaded(): Promise<unknown>;
  getState(): string;
}

declare global {
  interface Window {
    __lazySurfaces?: {
      states(): Record<string, { state: string; active: boolean }>;
      ensureLoaded(): Promise<void>;
      pendingOutputs(): number;
    };
  }
}
if (typeof window !== "undefined" && import.meta.env.VITE_E2E === "1") {
  window.__lazySurfaces = {
    states: () =>
      Object.fromEntries(
        [...runtimes].map(([id, runtime]) => [id, { state: runtime.getState(), active: runtime.active() }]),
      ),
    ensureLoaded: () => Promise.resolve(ensureLazySurfacesLoaded()),
    pendingOutputs: () => pendingOutputs,
  };
}
const runtimes = new Map<LazySurfaceId, SurfaceRuntime>();
let pendingOutputs = 0;

export function registerLazySurface(surface: SurfaceRuntime) {
  if (runtimes.has(surface.id)) throw new Error(`Duplicate lazy surface: ${surface.id}`);
  runtimes.set(surface.id, surface);
}

/** Several visible surfaces can share a failed chunk; the surviving toast recovers all of them. */
export function retryLazySurfaces() {
  for (const runtime of runtimes.values())
    if (runtime.active() && runtime.getState() === "failed") void runtime.ensureLoaded().catch(() => {});
}

/** Used by export, image capture, print and recording. Only visible, output-bearing surfaces matter.
 * Recheck after each load: a loaded surface can mount another registered surface.
 */
export function ensureLazySurfacesLoaded(): Promise<void> | undefined {
  const pending = pendingSurfaces();
  if (pending.length) return waitForSurfaces(pending);
}

function pendingSurfaces() {
  return lazySurfaces.flatMap(([id, , , policy]) => {
    const runtime = runtimes.get(id);
    return policy === "await" && runtime?.active() && runtime.getState() !== "loaded" ? [runtime] : [];
  });
}

async function waitForSurfaces(pending: SurfaceRuntime[]): Promise<void> {
  if (import.meta.env.VITE_E2E === "1") pendingOutputs++;
  try {
    while (pending.length) {
      await Promise.all(pending.map((surface) => surface.ensureLoaded()));
      // Commit subscriber updates and discover nested surfaces without depending on a running clock.
      flushSync(() => {});
      pending = pendingSurfaces();
    }
  } finally {
    if (import.meta.env.VITE_E2E === "1") pendingOutputs--;
  }
}
