import type { StencilCategory } from "../model/types";

export const CATEGORY_ORDER: StencilCategory[] = [
  "messaging",
  "compute",
  "data",
  "network",
  "observability",
  "security",
  "clients",
  "generic",
];

export const categoryLabel: Record<StencilCategory, string> = {
  messaging: "Messaging",
  compute: "Compute",
  data: "Data",
  network: "Network",
  observability: "Observability",
  security: "Security & config",
  clients: "Clients",
  generic: "Generic",
};

export const categoryBlurb: Record<StencilCategory, string> = {
  messaging: "Brokers, topics, queues and streams that carry messages between services.",
  compute: "Where code runs: services, functions, containers and orchestrators.",
  data: "Databases, caches, object storage and analytics platforms.",
  network: "Gateways, load balancers and edge networks in front of services.",
  observability: "Metrics, logs and traces.",
  security: "Identity, secrets and configuration stores.",
  clients: "People, devices and external systems at the edge of the diagram.",
  generic: "Vendor-neutral shapes for anything else.",
};
