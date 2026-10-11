import type { SimRole } from "../model/types";

/** Display metadata for simulation roles. The hue is reused later for the live-view legend. */
export const simRoleMeta: Record<SimRole, { label: string; hue: string; hint: string }> = {
  source: { label: "source", hue: "#22a06b", hint: "Emits messages" },
  topic: { label: "topic", hue: "#8b5cf6", hint: "Pub/sub: every subscriber gets a copy" },
  queue: { label: "queue", hue: "#e5a00d", hint: "Point-to-point: one consumer per message" },
  stream: { label: "stream", hue: "#0ea5b7", hint: "Ordered, partitioned log" },
  processor: { label: "processor", hue: "#3b82f6", hint: "Receives, transforms, forwards" },
  gateway: { label: "gateway", hue: "#14b8a6", hint: "Routes or passes requests through" },
  store: { label: "store", hue: "#a1785c", hint: "Persists data" },
  sink: { label: "sink", hue: "#e5484d", hint: "Terminal consumer" },
  none: { label: "decorative", hue: "#8a94a6", hint: "Not part of the flow" },
};
