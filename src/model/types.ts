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
  "messaging" | "compute" | "data" | "network" | "observability" | "security" | "clients" | "generic";

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
  /** Saved live-view simulations: who sends what, when things break, and what should hold true. */
  simulations?: Simulation[];
  /**
   * Free text, sticky notes, zones and plain shapes. Documentation only: the simulation, capacity
   * analysis and auto-layout never see them. Ids share the node namespace, because an edge may end
   * on a shape (for documentation; it carries no traffic).
   */
  annotations?: DiagramAnnotation[];
}

// ---------- Annotations ----------

/**
 * - text: plain words on the canvas (titles, captions), no chrome.
 * - note: a tinted sticky-note card.
 * - zone: a labelled, dashed region drawn behind nodes. Unlike a boundary it groups nothing: nodes
 *   don't belong to it and don't move with it.
 * - shape: a plain outline (see AnnotationShape) for when no stencil fits. The only connectable kind.
 */
export type AnnotationKind = "text" | "note" | "zone" | "shape";
export type AnnotationShape = "rect" | "rounded" | "ellipse" | "diamond" | "cylinder";
/** A small curated palette that reads well in both themes. */
export type AnnotationColor = "neutral" | "yellow" | "green" | "blue" | "purple" | "red";
export type AnnotationTextSize = "s" | "m" | "l" | "xl";

export interface DiagramAnnotation {
  id: string;
  kind: AnnotationKind;
  /** Multi-line text ("\n" separates lines). A zone's text is its label. */
  text: string;
  /** Top-left position and size in canvas pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Kind "shape" only. Default "rect". */
  shape?: AnnotationShape;
  /** Default per kind: note yellow, zone blue, text and shape neutral. */
  color?: AnnotationColor;
  /** Default "m"; text uses "xl" for titles. */
  textSize?: AnnotationTextSize;
}

// ---------- Simulations (docs/SIMULATIONS.md) ----------
// Traffic shapes follow load-testing tools (k6 / Gatling); timeline + expectations follow chaos
// experiments (actions + steady-state hypothesis). Times are simulation ms from the start.

export interface Simulation {
  id: string;
  title: string;
  description?: string;
  /** PRNG seed so a simulation replays identically. */
  seed?: number;
  /** Real messages represented by each simulated message ("1 dot = N"). Rates, counters and throughput
   *  are entered and shown in real units; the engine simulates rate ÷ scale. Default 1. */
  scale?: number;
  /** Global what-if multipliers: traffic rates × traffic, replicas × capacity. Default 1. */
  multipliers?: { traffic?: number; capacity?: number };
  /** Auto-stop after this many ms. Default: when traffic and timeline are done and the system drains. */
  durationMs?: number;
  /** Node status / prop overrides applied before t=0 (e.g. a consumer already slow). */
  setup?: {
    status?: Record<string, "up" | "paused" | "down">;
    props?: Record<string, Record<string, unknown>>;
  };
  traffic: TrafficProfile[];
  timeline?: TimelineStep[];
  expectations?: Expectation[];
}

export interface TrafficProfile {
  id: string;
  /** Node where messages start (any node; usually a source, a producer or a topic). */
  node: string;
  /** Message type, e.g. "MemberJoined". Default: the node's messageType. */
  messageType?: string;
  /** Optional display name, e.g. "New member storm". */
  label?: string;
  shape: TrafficShape;
}

export type TrafficShape =
  /** `count` messages at `atMs`, spread evenly over `spreadMs` (a storm / batch). */
  | { kind: "burst"; count: number; atMs?: number; spreadMs?: number }
  /** Steady `ratePerSec` from `fromMs` for `durationMs`. */
  | { kind: "constant"; ratePerSec: number; fromMs?: number; durationMs: number }
  /** k6-style stages: linear change from the previous rate to `targetRate` over each stage. */
  | { kind: "ramp"; fromMs?: number; startRate?: number; stages: { durationMs: number; targetRate: number }[] }
  /** `baseRate` throughout, jumping to `peakRate` for `peakMs` starting at `atMs`. */
  | { kind: "spike"; baseRate: number; peakRate: number; atMs: number; peakMs: number; durationMs: number };

export interface TimelineStep {
  atMs: number;
  action: TimelineAction;
}

export type TimelineAction =
  | { do: "status"; node: string; status: "up" | "paused" | "down" }
  | { do: "props"; node: string; props: Record<string, unknown> }
  | { do: "inject"; node: string; count: number; messageType?: string; spreadMs?: number }
  /** Narration for presenting: a callout, optionally highlighting nodes and pausing playback. */
  | { do: "note"; text: string; focus?: string[]; pause?: boolean };

export type MetricField =
  "processed" | "backlog" | "inFlight" | "failed" | "deadLettered" | "dropped" | "throughput" | "lag";

export interface Expectation {
  id: string;
  /** Human wording, e.g. "Nothing is dead-lettered". */
  label: string;
  /** What to measure: a node field (lag may name a consumer group), or messages in the whole system. */
  metric: { node: string; field: MetricField; group?: string } | { system: "inSystem" };
  op: "<" | "<=" | "==" | ">=" | ">";
  value: number;
  /** "always": must hold the whole run; "eventually": must hold at some point; "end": checked when the run ends;
   *  "at": checked at `atMs`. Default "end". */
  when?: "always" | "eventually" | "end" | "at";
  atMs?: number;
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
  /** Message / request flows from `from` to `to`. Either end may also be a shape annotation's id. */
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
