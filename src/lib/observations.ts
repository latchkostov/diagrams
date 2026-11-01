import type { CheckResult } from "../checks/types";
import type { FormatId } from "../interop/formats";
import type { DetailView } from "../canvas/detail";

export type ExportFormat = "native" | "png" | "svg" | "drawio" | "mermaid" | "html" | "video" | "other";

/** Product facts only. Subscribers are optional; publishers never know about tutorials or test hooks. */
export function createObservationPort<T>() {
  const listeners = new Set<(event: T) => void>();
  let latest: T | undefined;
  return {
    get: () => latest,
    publish(event: T) {
      latest = event;
      for (const listener of listeners) listener(event);
    },
    subscribe(listener: (event: T) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Identity changes on document replacement, but survives ordinary edits and Undo. */
export interface ObservationSource {
  documentId: string;
  identity: object;
  revision?: number;
}
export interface ProductObservations {
  navigation: ObservationSource & { nodeId: string };
  tools: ObservationSource & { query: string; stencils: readonly string[] };
  gallery: ObservationSource & { feature: string; slugs: readonly string[] };
  history: ObservationSource & { action: "undo" | "redo" };
  copied: ObservationSource & { slug: string };
  library: ObservationSource & { slugs: readonly string[] };
  camera: ObservationSource & { view: "overview" | "focus" | "follow" | "custom" };
  importReport: ObservationSource & { source: string; guesses: number; unread: number; privacy: boolean };
  dock: ObservationSource & {
    tab: "closed" | "properties" | "checks" | "ai";
    snap: "peek" | "half" | "full";
    live: boolean;
    presenting: boolean;
    view?: DetailView;
  };
  checks: ObservationSource & {
    status: "running" | "done" | "failed" | "cancelled" | "stale";
    result?: CheckResult | null;
    /** Completed, current saved-run evidence; absent during static checks. */
    simulations?: readonly { id: string; playedMs: number; capped: boolean }[];
  };
  planning: ObservationSource & {
    nodeId: string;
    constraint: "cpu" | "threads" | "unknown";
    capacity: number;
    offered: number;
  };
  sequence: ObservationSource & { traceId: number; open: boolean; arrows: number };
  sequenceExport: ObservationSource & { traceId: number; format: "svg" | "mermaid" | "png"; bytes: number };
  exports: ObservationSource & { format: ExportFormat; bytes: number };
  imports: ObservationSource & { format: FormatId; source?: string };
  ai: ObservationSource & {
    kind: "change" | "explain" | "revert" | "undo" | "context";
    copiedBytes?: number;
    changed: readonly string[];
  };
  collaboration: ObservationSource & {
    status: "joining" | "joined" | "left";
    role?: "creator" | "joiner";
    practice?: {
      phase: "join" | "edit" | "watch" | "leave";
      viewerRefused?: boolean;
      converged?: boolean;
      run?: string;
      recovery?: boolean;
    };
  };
}
export const observationPorts: {
  [K in keyof ProductObservations]: ReturnType<typeof createObservationPort<ProductObservations[K]>>;
} = {
  planning: createObservationPort<ProductObservations["planning"]>(),
  sequence: createObservationPort<ProductObservations["sequence"]>(),
  sequenceExport: createObservationPort<ProductObservations["sequenceExport"]>(),
  navigation: createObservationPort<ProductObservations["navigation"]>(),
  tools: createObservationPort<ProductObservations["tools"]>(),
  gallery: createObservationPort<ProductObservations["gallery"]>(),
  history: createObservationPort<ProductObservations["history"]>(),
  copied: createObservationPort<ProductObservations["copied"]>(),
  library: createObservationPort<ProductObservations["library"]>(),
  camera: createObservationPort<ProductObservations["camera"]>(),
  importReport: createObservationPort<ProductObservations["importReport"]>(),
  dock: createObservationPort<ProductObservations["dock"]>(),
  checks: createObservationPort<ProductObservations["checks"]>(),
  exports: createObservationPort<ProductObservations["exports"]>(),
  imports: createObservationPort<ProductObservations["imports"]>(),
  ai: createObservationPort<ProductObservations["ai"]>(),
  collaboration: createObservationPort<ProductObservations["collaboration"]>(),
};

export const sameObservationSource = (a: ObservationSource, b: ObservationSource) =>
  a.documentId === b.documentId && a.identity === b.identity;

const pending = new Set<{ source: ObservationSource; controller: AbortController }>();
// Diagnostics must distinguish a cancellation request from the operation's eventual finally block.
const settling = import.meta.env.DEV || import.meta.env.VITE_E2E === "1" ? new Set<object>() : undefined;
export const unsettledObservedWork = () => settling?.size ?? 0;

/** A file operation belongs to the document that started it, including while its lazy writer loads. */
export function beginObservedWork(source: ObservationSource | undefined) {
  const controller = new AbortController();
  const job = source && { source, controller };
  if (job) pending.add(job);
  const ticket = {};
  settling?.add(ticket);
  return {
    signal: controller.signal,
    finish() {
      if (job) pending.delete(job);
      settling?.delete(ticket);
    },
  };
}

/** Restart/Exit/replacement cancel pending product work for this sandbox, never another document. */
export function cancelObservedWork(source: ObservationSource) {
  for (const job of pending) {
    if (!sameObservationSource(job.source, source)) continue;
    pending.delete(job);
    job.controller.abort();
  }
}
