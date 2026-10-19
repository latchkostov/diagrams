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
  "messaging" | "compute" | "data" | "network" | "onprem" | "observability" | "security" | "clients" | "generic";

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
/** Immutable model revision. Absent means legacy playback, including omitted defaults. */
export interface PlanningModel {
  revision: "p1" | "p2" | "p3" | "p3-a1" | "p3-w1";
  sharedQuotas?: import("./admission").Quota[];
  sharedAllocations?: import("./admission").SharedAllocation[];
  /**
   * Request routing R1 (src/model/requestRouting.ts): the diagram-scoped request routes. Present (even empty) opts a
   * p3-a1 document into routing: traffic mixes, route tables and caller addresses. Older readers refuse the key.
   */
  requestRoutes?: import("./requestRouting").RequestRoute[];
}

/** The saved / imported file format. Plain JSON. */
export interface DiagramFile {
  format: typeof DIAGRAM_FORMAT | "diagrams/v2";
  planning?: PlanningModel;
  title: string;
  description?: string;
  /** Background canvas tint colour (hex or predefined annotation color id). Absent means default canvas background. */
  color?: string;
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
  /** Shared back-to-front order of diagram nodes and annotations; absent means default order. */
  layerOrder?: string[];
  /**
   * A Private diagram's export says so, so it stays private when it's opened or imported again: no share
   * links, no cloud saves, no AI. Kept in the library's metadata while the diagram is in the browser.
   */
  private?: boolean;
  /** Architecture checks a person turned off or ignored for this diagram (docs/research/architecture-checks.md). */
  checks?: DiagramChecks;
}

// ---------- Architecture checks ----------

/**
 * What a person decided about this diagram's checks; travels with the file, so a team sees the same
 * findings. Only people write it: no agent tool does.
 */
export interface DiagramChecks {
  /** Rule ids turned off for this diagram, e.g. "dead-letter". */
  off?: string[];
  /** Single findings ignored here: a rule plus the element it's about, with an optional reason. */
  ignore?: CheckIgnore[];
}

export interface CheckIgnore {
  rule: string;
  /** The finding's target element id (a node or connection). An ignore whose target is gone is dropped. */
  target: string;
  /** Why, in a few words ("Projection rebuilds from the log"). At most 200 characters. */
  reason?: string;
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
export type AnnotationColor = "white" | "neutral" | "yellow" | "green" | "blue" | "purple" | "red";
export type AnnotationTextSize = "s" | "m" | "l" | "xl";

// ---------- Elements & Annotations ----------

/** Base interface for any placed visual canvas element (nodes, boundaries, annotations). */
export interface DiagramElement {
  id: string;
  /** Top-left position in canvas pixels. */
  x: number;
  y: number;
  /** Optional id of an enclosing boundary this element visually sits inside. */
  group?: string;
}

/** Canvas element with explicit width and height bounding box. */
export interface DiagramBoxElement extends DiagramElement {
  width: number;
  height: number;
}

export interface DiagramAnnotation extends DiagramBoxElement {
  kind: AnnotationKind;
  /** Multi-line text ("\n" separates lines). A zone's text is its label. */
  text: string;
  /** Kind "shape" only. Default "rect". */
  shape?: AnnotationShape;
  /** Default per kind: note yellow, zone blue, text and shape neutral. Can also be a hex string (#rrggbb). */
  color?: AnnotationColor | string;
  /** Default "m"; text uses "xl" for titles. */
  textSize?: AnnotationTextSize;
}

// ---------- Simulations (docs/SIMULATIONS.md) ----------
// Traffic shapes follow load-testing tools (k6 / Gatling); timeline faults and expectations define
// repeatable drills. Times are simulation ms from the start.

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
  | { do: "fault"; fault: import("./faults").Fault; drill?: import("./faults").DrillPreset }
  | { do: "status"; node: string; status: "up" | "paused" | "down" }
  | { do: "props"; node: string; props: Record<string, unknown> }
  | { do: "inject"; node: string; count: number; messageType?: string; spreadMs?: number }
  /** Narration for presenting: a callout, optionally highlighting nodes and pausing playback. */
  | { do: "note"; text: string; focus?: string[]; pause?: boolean }
  /** Narration: trace the next message to arrive at (or start from) `node`, hop by hop. */
  | { do: "trace"; node: string };

export type MetricField =
  | "processed"
  | "backlog"
  | "inFlight"
  | "failed"
  | "deadLettered"
  | "dropped"
  | "blocked"
  | "rejected"
  | "throughput"
  | "lag";

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

export interface DiagramNode extends DiagramElement {
  /** Stencil id; unknown ids render with a generic fallback rather than failing. */
  stencil: string;
  label: string;
  /** Secondary line, e.g. topic name "orders.created" or "consumer group: billing". */
  sublabel?: string;
  /** Optional Markdown documentation and technical details for the node. */
  description?: string;
  /** Free-form properties for the simulation / future features (partitions, rate, etc.). */
  props?: Record<string, unknown>;
}

/**
 * What an edge means. "flow" (the default) carries messages or requests; the other six are
 * dependencies: drawn dotted, never carry traffic, and the simulation ignores them.
 */
export type EdgeRelation = "flow" | "config" | "secret" | "identity" | "telemetry" | "deploy" | "depends";

/**
 * Where an edge's relationship came from. "inferred": from the stencils at its ends (drawn into a Key Vault, or
 * an end's stencil changed), so it follows them when they change again. "explicit": someone chose it (the
 * Relationship menu, Make it a flow), so it never changes by itself. Absent: a flow follows its ends' stencils;
 * a dependency stays as it is.
 */
export type RelationOrigin = "inferred" | "explicit";

export interface DiagramEdge {
  id: string;
  /** Message / request flows from `from` to `to`. Either end may also be a shape annotation's id. */
  from: string;
  to: string;
  label?: string;
  /** "async" = message-based (dashed, animated in sim); "sync" = request/response (solid). Default "async".
   *  Only meaningful for flows; kept on dependencies so switching back to a flow restores it. */
  kind?: "async" | "sync";
  /** Absent = "flow". Dependencies point from the thing that needs it to the dependency (Deploy: from
   *  the actor to its target). Config edges may list what they read in `props.settings`. */
  relation?: EdgeRelation;
  /** Who set `relation` (see RelationOrigin): decides whether a stencil change re-infers it. */
  relationOrigin?: RelationOrigin;
  /** Which side of each node the edge attaches to. Omitted = chosen automatically from node positions. */
  sourceSide?: Side;
  targetSide?: Side;
  props?: Record<string, unknown>;
}

export type Side = "top" | "right" | "bottom" | "left";

export type GroupTone = "azure" | "aws" | "gcp" | "k8s" | "onprem" | "neutral";

export interface DiagramGroup extends DiagramBoxElement {
  label: string;
  /** Visual tone or custom hex colour of the boundary box. */
  tone?: GroupTone | string;
}
