import type { SimRole } from "../model/types";

/** What each simulation role does, in the words shown in the stencil details drawer. */
export const roleExplained: Record<SimRole, string> = {
  source: "Starts messages. Simulated traffic begins here: users, devices, schedulers and producers.",
  topic: "Pub/sub. Every outgoing connection receives its own copy of each message.",
  queue: "Point-to-point. Each message goes to exactly one outgoing connection, so consumers compete for work.",
  stream: "An ordered, partitioned log. Like a topic, every consumer gets every message, in order within a partition.",
  processor: "Receives a message, does its work, then forwards the result to every outgoing connection.",
  gateway: "Passes requests through to whatever sits behind it, without holding on to them.",
  store: "Persists what arrives. Messages end their journey here.",
  sink: "A terminal consumer. Messages end here without being stored, like email delivery or monitoring.",
  none: "Decorative. It isn't part of the message flow, so the simulation passes over it.",
};

export interface IconSource {
  source: string;
  licence: string;
}

/** Where a stencil's icon comes from, condensed from docs/ICONS.md. */
export function iconSource(icon: string): IconSource {
  if (icon.startsWith("azure-")) return { source: "Microsoft Azure Architecture Icons V24", licence: "Microsoft icon terms: use in architecture diagrams, unaltered" };
  if (icon.startsWith("aws-")) return { source: "AWS Architecture Icons (2026-07)", licence: "AWS icon terms: use in architecture diagrams, unaltered" };
  if (icon.startsWith("gcp-")) return { source: "Google Cloud icons", licence: "Apache-2.0" };
  if (icon.startsWith("k8s-")) return { source: "Kubernetes community icons", licence: "Apache-2.0 or CC BY 4.0" };
  if (icon === "entra-id") return { source: "selfh.st icons", licence: "CC BY 4.0, attribution required" };
  if (icon === "sqlserver") return { source: "theSVG", licence: "MIT" };
  if (icon.startsWith("client-") || icon.startsWith("generic-")) return { source: "Lucide", licence: "ISC" };
  return { source: "gilbarbara/logos", licence: "CC0 artwork; the logo is its owner's trademark" };
}
