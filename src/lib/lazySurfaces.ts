/** Metadata stays separate from loaders: enumerating surfaces never downloads their chunks. */
import { flushSync } from "react-dom";
declare const __LAZY_SURFACE_METADATA__: boolean | undefined;
// Node-side browser test discovery imports this file directly, without Vite's compile-time flag.
const names = typeof __LAZY_SURFACE_METADATA__ === "undefined" || __LAZY_SURFACE_METADATA__;
export const lazySurfaces = [
  ["canvas.presence", names ? "CanvasReadouts" : "", names ? "canvas/CanvasReadouts" : "", "skip"],
  ["canvas.node-tips", names ? "CanvasReadouts" : "", names ? "canvas/CanvasReadouts" : "", "skip"],
  ["canvas.check-markers", names ? "ChecksMarkers" : "", names ? "canvas/checks/ChecksMarkers" : "", "skip"],
  ["inspector.node-settings", names ? "NodeSettings" : "", names ? "canvas/inspector/NodeSettings" : "", "skip"],
  ["inspector.identity", names ? "NodeIdentity" : "", names ? "canvas/inspector/NodeIdentity" : "", "skip"],
  ["inspector.edge", names ? "EdgePanel" : "", names ? "canvas/inspector/EdgePanel" : "", "skip"],
  ["inspector.messages", names ? "MessageFields" : "", names ? "canvas/inspector/MessageFields" : "", "skip"],
  ["inspector.properties", names ? "PropsEditor" : "", names ? "canvas/inspector/PropsEditor" : "", "skip"],
  ["inspector.call", names ? "CallWaitFields" : "", names ? "canvas/inspector/CallWaitFields" : "", "skip"],
  ["inspector.advanced", names ? "EdgeAdvanced" : "", names ? "canvas/inspector/EdgeAdvanced" : "", "skip"],
  ["inspector.simulation", names ? "SimulationFields" : "", names ? "canvas/inspector/SimulationFields" : "", "skip"],
  ["inspector.edge-shell", names ? "lazyEdgePanel" : "", names ? "canvas/inspector/lazyEdgePanel" : "", "skip"],
  ["inspector.group", names ? "GroupPanel" : "", names ? "canvas/inspector/GroupPanel" : "", "skip"],
  ["inspector.annotation", names ? "AnnotationPanel" : "", names ? "canvas/inspector/AnnotationPanel" : "", "skip"],
  ["inspector.diagram", names ? "DiagramPanel" : "", names ? "canvas/inspector/DiagramPanel" : "", "skip"],
  ["inspector.multi", names ? "MultiPanel" : "", names ? "canvas/inspector/MultiPanel" : "", "skip"],
  ["live.sections", names ? "NodeDetailSections" : "", names ? "live/NodeDetailSections" : "", "skip"],
  ["live.timeline", names ? "Timeline" : "", names ? "live/Timeline" : "", "skip"],
  ["live.more", names ? "LiveMoreItems" : "", names ? "live/LiveMoreItems" : "", "skip"],
  ["live.slow-timeline", names ? "SlowTimeline" : "", names ? "live/slowmo/SlowTimeline" : "", "skip"],
  ["live.simulations", names ? "SimPanel" : "", names ? "live/SimPanel" : "", "skip"],
  ["live.capacity", names ? "CapacityPanel" : "", names ? "live/CapacityPanel" : "", "skip"],
  ["live.capacity-analysis", names ? "CapacityAnalysis" : "", names ? "live/CapacityAnalysis" : "", "await"],
  ["live.bottleneck", names ? "BottleneckCallout" : "", names ? "live/BottleneckCallout" : "", "skip"],
  ["live.calls", names ? "CallPills" : "", names ? "live/CallPills" : "", "await"],
  ["live.threads", names ? "CallPills" : "", names ? "live/CallPills" : "", "await"],
  ["live.node-details", names ? "NodeDetails" : "", names ? "live/NodeDetails" : "", "skip"],
  ["live.edge-details", names ? "NodeDetails" : "", names ? "live/NodeDetails" : "", "skip"],
  ["live.history", names ? "HoverHistory" : "", names ? "live/HoverHistory" : "", "skip"],
  ["live.session", names ? "LiveSession" : "", names ? "live/LiveSession" : "", "await"],
  ["live.edit-capacity", names ? "EditCapacity" : "", names ? "live/session/EditCapacity" : "", "skip"],
  ["live.trouble", names ? "TroubleCallout" : "", names ? "live/TroubleCallout" : "", "skip"],
  ["live.events", names ? "EventLog" : "", names ? "live/EventLog" : "", "skip"],
  ["live.inject", names ? "InjectDialog" : "", names ? "live/InjectDialog" : "", "skip"],
  ["live.note", names ? "NoteCallout" : "", names ? "live/NoteCallout" : "", "await"],
  ["live.trace", names ? "TraceCard" : "", names ? "live/TraceCard" : "", "skip"],
  ["edge.shaping", names ? "EdgeRouteHandles" : "", names ? "canvas/edges/EdgeRouteHandles" : "", "skip"],
  ["edge.reader", names ? "EdgeMessages" : "", names ? "canvas/edges/EdgeMessages" : "", "skip"],
  ["edge.message-tip", names ? "carriedTypes" : "", names ? "canvas/edges/carriedTypes" : "", "skip"],
  ["tutorial.app", names ? "TutorialApp" : "", names ? "tutorials/TutorialApp" : "", "skip"],
  ["tutorial.list", names ? "TutorialsView" : "", names ? "tutorials/TutorialsView" : "", "skip"],
] as const;

export type LazySurfaceId = (typeof lazySurfaces)[number][0];
export interface SurfaceRuntime {
  id: LazySurfaceId;
  active(): boolean;
  ensureLoaded(): Promise<unknown>;
  getState(): string;
}

export interface SurfaceOwner {
  /** Vite preserves this object across evaluations of the same module. */
  data: object;
  dispose(cleanup: () => void): void;
}
interface Registry {
  runtimes: Map<LazySurfaceId, SurfaceRuntime>;
  owners: Map<LazySurfaceId, SurfaceOwner>;
  retired: Set<SurfaceRuntime>;
  disposed: WeakSet<SurfaceOwner>;
}
const hotRegistry: Registry | undefined = import.meta.env?.DEV
  ? (import.meta.hot?.data?.lazySurfaces ?? {
      runtimes: new Map(),
      owners: new Map(),
      retired: new Set(),
      disposed: new WeakSet(),
    })
  : undefined;
if (import.meta.env?.DEV && import.meta.hot?.data) import.meta.hot.data.lazySurfaces = hotRegistry;
const runtimes: Map<LazySurfaceId, SurfaceRuntime> = hotRegistry?.runtimes ?? new Map();
let pendingOutputs = 0;
let currentOwner: SurfaceOwner | undefined;

/** Scoped to synchronous module declarations; nested definitions restore their caller's ownership. */
export function withLazySurfaceOwner<T>(owner: SurfaceOwner, define: () => T): T {
  const previous = currentOwner;
  currentOwner = owner;
  try {
    return define();
  } finally {
    currentOwner = previous;
  }
}

function pruneDisposed() {
  if (!hotRegistry) return;
  for (const surface of hotRegistry.retired) if (!surface.active()) hotRegistry.retired.delete(surface);
  for (const [id, owner] of hotRegistry.owners)
    if (hotRegistry.disposed.has(owner) && !runtimes.get(id)?.active()) {
      runtimes.delete(id);
      hotRegistry.owners.delete(id);
    }
}

function registeredSurfaces(): Iterable<SurfaceRuntime> {
  if (!hotRegistry) return runtimes.values();
  pruneDisposed();
  return [...runtimes.values(), ...hotRegistry.retired];
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
export function registerLazySurface(surface: SurfaceRuntime) {
  if (import.meta.env?.DEV && currentOwner && hotRegistry) {
    pruneDisposed();
    const owner = currentOwner;
    const previous = runtimes.get(surface.id);
    const previousOwner = hotRegistry.owners.get(surface.id);
    if (previous && (!previousOwner || previousOwner.data !== owner.data || previousOwner === owner))
      throw new Error(`Duplicate lazy surface: ${surface.id}`);
    // Mounted old consumers still participate in readiness until React replaces/unmounts them.
    if (previous?.active()) hotRegistry.retired.add(previous);
    runtimes.set(surface.id, surface);
    hotRegistry.owners.set(surface.id, owner);
    owner.dispose(() => {
      hotRegistry.disposed.add(owner);
      if (runtimes.get(surface.id) === surface && !surface.active()) {
        runtimes.delete(surface.id);
        hotRegistry.owners.delete(surface.id);
      }
      if (!surface.active()) hotRegistry.retired.delete(surface);
    });
    return;
  }
  if (runtimes.has(surface.id)) throw new Error(`Duplicate lazy surface: ${surface.id}`);
  runtimes.set(surface.id, surface);
}

/** Several visible surfaces can share a failed chunk; the surviving toast recovers all of them. */
export function retryLazySurfaces() {
  for (const runtime of import.meta.env?.DEV ? registeredSurfaces() : runtimes.values())
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
  if (import.meta.env?.DEV)
    return [...registeredSurfaces()].filter(
      (runtime) =>
        lazySurfaces.find(([id]) => id === runtime.id)?.[3] === "await" &&
        runtime.active() &&
        runtime.getState() !== "loaded",
    );
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
