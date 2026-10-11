// Shared contract for the diagram app. Saved files, stencils, the canvas and
// (later) the live simulation all speak these types — change with care.

/** How a node behaves when messages are simulated flowing through the diagram. */
export type SimRole =
  | "source" // emits messages (clients, producers, schedulers, CDC sources)
  | "topic" // pub/sub: every outgoing edge gets a copy (Kafka topic, SB topic, SNS, Event Grid)
  | "queue" // point-to-point: each message goes to ONE outgoing edge (SB queue, SQS, Storage Queue)
  | "stream" // partitioned log, behaves like topic but ordered (Event Hubs, Kinesis)
  | "processor" // receives, transforms, forwards to all outgoing edges (services, functions)
  | "gateway" // routes / passes through (API gateways, load balancers, CDN)
  | "store" // terminal persistence (databases, blob storage, caches)
  | "sink" // terminal consumer with no persistence semantics (observability, email, external)
  | "none"; // decorative / not part of the flow

export type StencilCategory =
  | "messaging"
  | "compute"
  | "data"
  | "network"
  | "observability"
  | "security"
  | "clients"
  | "generic";

export interface Stencil {
  /** Stable id persisted in saved diagrams, e.g. "kafka.topic". Never rename once shipped. */
  id: string;
  /** Display name, e.g. "Kafka Topic". */
  label: string;
  category: StencilCategory;
  /** Vendor / product family for grouping & filtering, e.g. "Azure", "Apache Kafka", "AWS". */
  vendor: string;
  /** Icon file name (without .svg) in src/stencils/icons/. */
  icon: string;
  /** Brand / accent colour (hex) used for the node's tint, edge highlights and sim particles. */
  accent: string;
  simRole: SimRole;
  /** One-line description shown in the gallery and as a tooltip. */
  description: string;
  /** Default sublabel when a node is created from this stencil, e.g. "topic". */
  defaultSublabel?: string;
}

export const DIAGRAM_FORMAT = "diagrams/v1" as const;

/** The saved / imported file format. Plain JSON. */
export interface DiagramFile {
  format: typeof DIAGRAM_FORMAT;
  title: string;
  description?: string;
  /** Primary flow direction, used for auto-layout and handle placement. Default "LR". */
  direction?: "LR" | "TB";
  groups?: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramNode {
  id: string;
  /** Stencil id; unknown ids render with a generic fallback rather than failing. */
  stencil: string;
  label: string;
  /** Secondary line, e.g. topic name "orders.created" or "consumer group: billing". */
  sublabel?: string;
  /** Top-left position in canvas pixels (absolute, not relative to group). */
  x: number;
  y: number;
  /** Optional id of a group this node visually sits inside. */
  group?: string;
  /** Free-form properties for the simulation / future features (partitions, rate, etc.). */
  props?: Record<string, unknown>;
}

export interface DiagramEdge {
  id: string;
  /** Message / request flows from `from` to `to`. */
  from: string;
  to: string;
  label?: string;
  /** "async" = message-based (dashed, animated in sim); "sync" = request/response (solid). Default "async". */
  kind?: "async" | "sync";
  /** Which side of each node the edge attaches to. Omitted = chosen automatically from node positions. */
  sourceSide?: Side;
  targetSide?: Side;
  props?: Record<string, unknown>;
}

export type Side = "top" | "right" | "bottom" | "left";

export interface DiagramGroup {
  id: string;
  label: string;
  /** Visual tone of the boundary box. */
  tone?: "azure" | "aws" | "gcp" | "k8s" | "onprem" | "neutral";
  x: number;
  y: number;
  width: number;
  height: number;
}
