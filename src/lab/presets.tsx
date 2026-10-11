import { safeStorage } from "../lib/storage";
import { exportFixture } from "./exportFixture";
// The Lab's preset registry. Every entry renders the *current* components with fixed data, so
// opening ?view=lab&preset=<id> is a quick visual check of whatever you're working on.
//
// Add a preset: push an object onto `presets` (see types.ts). Controls become inputs in the right
// panel and URL params automatically (`?view=lab&preset=my-id&count=12`).

import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { examples } from "../examples";
import { stencils } from "../stencils/registry";
import { CATEGORY_ORDER, categoryLabel } from "../lib/categories";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";
import {
  backEdgeDiagram,
  cycleDiagram,
  edgeKindsDiagram,
  edgeSidesDiagram,
  fanEdgesDiagram,
  fanOutDiagram,
  groupsDiagram,
  oddNodesDiagram,
  stressDiagram,
} from "./generators";
import { scenarioDefs } from "./scenarios";
import { AllStencils, NODE_STATES, NodeMatrix, NodePlayground } from "./NodeShowcase";
import type { ControlDef, Preset } from "./types";
import { LiveLabStage } from "../live/LiveLabStage";
import { badgeStatesDiagram, noteStatesDiagram, particleStressDiagram, type NoteState } from "../live/labDiagrams";
import { OverlapAudit } from "./OverlapAudit";
import { obstacleCourseDiagram } from "./routingDiagrams";

const variantOptions = Object.entries(nodeVariants).map(([value, v]) => ({ value, label: v.label }));
const variantsOf = (v: unknown): NodeVariantId[] =>
  v === "all" ? (Object.keys(nodeVariants) as NodeVariantId[]) : [v as NodeVariantId];

const STENCIL_SETS: Record<string, { label: string; ids: string[] }> = {
  mixed: {
    label: "Mixed",
    ids: ["kafka.topic", "azure.service-bus.queue", "service.dotnet", "postgres", "aws.api-gateway", "client.browser"],
  },
  messaging: {
    label: "Messaging",
    ids: ["kafka.topic", "azure.service-bus.topic", "azure.event-hubs", "aws.sqs", "rabbitmq.exchange", "nats.subject"],
  },
  wordmarks: {
    label: "Wide icons",
    ids: ["splunk", "service.go", "snowflake", "databricks", "elasticsearch", "datadog"],
  },
  compute: {
    label: "Compute",
    ids: ["azure.functions", "aws.lambda", "k8s.deployment", "service.java", "service.python", "docker.container"],
  },
};

// ---------- nodes ----------

const nodePresets: Preset[] = [
  {
    kind: "render",
    id: "nodes-states",
    title: "Node states",
    group: "Nodes",
    description:
      "Every node variant × a few stencils × states: selected, long label, no sublabel, unknown stencil, missing icon.",
    controls: [
      {
        type: "select",
        key: "variant",
        label: "Variant",
        default: "all",
        options: [{ value: "all", label: "All variants" }, ...variantOptions],
      },
      {
        type: "select",
        key: "set",
        label: "Stencils",
        default: "mixed",
        options: Object.entries(STENCIL_SETS).map(([value, s]) => ({ value, label: s.label })),
      },
    ],
    render: (v) => (
      <NodeMatrix variants={variantsOf(v.variant)} stencilIds={STENCIL_SETS[String(v.set)].ids} states={NODE_STATES} />
    ),
  },
  {
    kind: "render",
    id: "nodes-all-stencils",
    title: "All stencils",
    group: "Nodes",
    description: "The whole catalog in one node variant.",
    controls: [
      { type: "select", key: "variant", label: "Variant", default: "card", options: variantOptions },
      {
        type: "select",
        key: "category",
        label: "Category",
        default: "all",
        options: [
          { value: "all", label: "All categories" },
          ...CATEGORY_ORDER.map((c) => ({ value: c, label: categoryLabel[c] })),
        ],
      },
      { type: "text", key: "q", label: "Filter", default: "", placeholder: "id, label or vendor" },
    ],
    render: (v) => (
      <AllStencils variant={v.variant as NodeVariantId} category={String(v.category)} query={String(v.q)} />
    ),
  },
  {
    kind: "render",
    id: "nodes-playground",
    title: "Node playground",
    group: "Nodes",
    description: "One node, any stencil and text.",
    controls: [
      {
        type: "select",
        key: "variant",
        label: "Variant",
        default: "all",
        options: [{ value: "all", label: "All variants" }, ...variantOptions],
      },
      {
        type: "select",
        key: "stencil",
        label: "Stencil",
        default: "kafka.topic",
        options: stencils.map((s) => ({ value: s.id, label: `${s.label} (${s.id})` })),
      },
      { type: "text", key: "label", label: "Label", default: "orders" },
      { type: "text", key: "sublabel", label: "Sublabel", default: "orders.created.v1" },
      { type: "boolean", key: "selected", label: "Selected", default: false },
    ],
    render: (v) => (
      <NodePlayground
        variant={v.variant as NodeVariantId | "all"}
        stencil={String(v.stencil)}
        label={String(v.label)}
        sublabel={String(v.sublabel)}
        selected={!!v.selected}
      />
    ),
  },
  {
    kind: "diagram",
    id: "nodes-on-canvas",
    title: "Odd nodes on canvas",
    group: "Nodes",
    description: "Unknown stencil, overflowing labels and empty text inside the real canvas node wrapper.",
    diagram: () => oddNodesDiagram(),
  },
];

// ---------- edges ----------

const edgePresets: Preset[] = [
  {
    kind: "diagram",
    id: "edges-kinds",
    title: "Edge kinds",
    group: "Edges",
    description: "async, sync, labelled, long label, two-way.",
    diagram: () => edgeKindsDiagram(),
  },
  {
    kind: "diagram",
    id: "edges-back",
    title: "Back-edges and loops",
    group: "Edges",
    description: "Edges running against the flow, above / below, and a self-loop.",
    controls: [{ type: "boolean", key: "selfloop", label: "Self-loop", default: true }],
    diagram: (v) => backEdgeDiagram(!!v.selfloop),
  },
  {
    kind: "diagram",
    id: "edges-sides",
    title: "All side combinations",
    group: "Edges",
    description: "sourceSide × targetSide: 16 pinned pairs.",
    controls: [{ type: "number", key: "spacing", label: "Spacing", default: 1, min: 0.6, max: 2, step: 0.1 }],
    diagram: (v) => edgeSidesDiagram(Number(v.spacing)),
  },
  {
    kind: "diagram",
    id: "edges-fan",
    title: "Fan in / fan out",
    group: "Edges",
    description: "Many edges meeting at one node.",
    controls: [{ type: "number", key: "count", label: "Edges each way", default: 5, min: 1, max: 30 }],
    diagram: (v) => fanEdgesDiagram(Number(v.count)),
  },
];

// ---------- diagrams ----------

// Local-only work diagrams (dev only) never get presets; only their file names are read here.
const localOnly = new Set(
  Object.keys(import.meta.env.DEV ? import.meta.glob("../examples/private/*.json") : {}).map((p) =>
    p.slice(p.lastIndexOf("/") + 1, -".json".length),
  ),
);

const stressControls = (nodes: number): ControlDef[] => [
  { type: "number", key: "nodes", label: "Nodes", default: nodes, min: 1, max: 1000, step: 10 },
  { type: "number", key: "seed", label: "Seed", default: 1, min: 1, max: 9999 },
  { type: "number", key: "density", label: "Cross-links", default: 0.25, min: 0, max: 1, step: 0.05 },
  { type: "boolean", key: "groups", label: "Group columns", default: false },
  {
    type: "select",
    key: "direction",
    label: "Direction",
    default: "LR",
    options: [
      { value: "LR", label: "Left → right" },
      { value: "TB", label: "Top → bottom" },
    ],
  },
];

const stress = (nodes: number): Preset => ({
  kind: "diagram",
  id: `stress-${nodes}`,
  title: `Stress: ${nodes} nodes`,
  group: "Diagrams",
  description: "Procedural layered pipeline. Change Nodes to try any size.",
  controls: stressControls(nodes),
  diagram: (v) =>
    stressDiagram({
      nodes: Number(v.nodes),
      seed: Number(v.seed),
      density: Number(v.density),
      groups: !!v.groups,
      direction: v.direction === "TB" ? "TB" : "LR",
    }),
});

const diagramPresets: Preset[] = [
  ...examples
    .filter((e) => !localOnly.has(e.slug))
    .map((e): Preset => ({
      kind: "diagram",
      id: `example-${e.slug}`,
      title: e.diagram.title,
      group: "Diagrams",
      description: e.diagram.description,
      exampleSlug: e.slug,
      diagram: () => e.diagram,
    })),
  stress(10),
  stress(50),
  stress(150),
  {
    kind: "diagram",
    id: "fan-out-deep",
    title: "Deep fan-out",
    group: "Diagrams",
    description: "A topic tree: every level fans out to N consumers, each publishing to its own topic.",
    controls: [
      { type: "number", key: "depth", label: "Depth", default: 3, min: 1, max: 6 },
      { type: "number", key: "breadth", label: "Breadth", default: 3, min: 1, max: 8 },
    ],
    diagram: (v) => fanOutDiagram(Number(v.depth), Number(v.breadth)),
  },
  {
    kind: "diagram",
    id: "cycle",
    title: "Cycle",
    group: "Diagrams",
    description: "A ring of services and topics; the last edge loops back.",
    controls: [{ type: "number", key: "size", label: "Nodes", default: 8, min: 2, max: 40 }],
    diagram: (v) => cycleDiagram(Number(v.size)),
  },
  {
    kind: "diagram",
    id: "group-tones",
    title: "Group tones",
    group: "Diagrams",
    description: "Every boundary tone with cross-boundary edges.",
    diagram: () => groupsDiagram(),
  },
  {
    kind: "diagram",
    id: "empty",
    title: "Empty diagram",
    group: "Diagrams",
    description: "No nodes, no edges.",
    diagram: (): DiagramFile => ({ format: DIAGRAM_FORMAT, title: "Empty", nodes: [], edges: [] }),
  },
];

// ---------- simulation ----------

const simControls: ControlDef[] = [
  {
    type: "select",
    key: "speed",
    label: "Sim speed",
    default: "1",
    options: ["0.25", "0.5", "1", "2", "4", "8"].map((s) => ({ value: s, label: `${s}×` })),
  },
  { type: "number", key: "seed", label: "Seed", default: 7, min: 1, max: 99999 },
  { type: "boolean", key: "autoplay", label: "Autoplay", default: true },
];

const simPresets: Preset[] = scenarioDefs.map((s): Preset => ({
  kind: "scenario",
  id: s.id,
  title: s.title,
  group: "Simulation",
  description: s.description,
  controls: [...(s.controls ?? []), ...simControls],
  diagram: s.diagram,
  scenario: s.scenario,
}));

// ---------- playground ----------

export const CUSTOM_PRESET_ID = "custom-json";
export const CUSTOM_STORAGE_KEY = "diagrams.lab.custom.v1";

export function readCustomDiagram(): DiagramFile | null {
  try {
    const raw = safeStorage.getItem(CUSTOM_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DiagramFile) : null;
  } catch {
    return null;
  }
}

const playgroundPresets: Preset[] = [
  {
    kind: "diagram",
    id: "export-contract",
    title: "Complete export contract",
    group: "Playground",
    diagram: () => exportFixture,
  },
  {
    kind: "diagram",
    id: CUSTOM_PRESET_ID,
    title: "Pasted JSON",
    group: "Playground",
    description: "Whatever you last loaded with Load JSON (kept in this browser).",
    diagram: () =>
      readCustomDiagram() ?? {
        format: DIAGRAM_FORMAT,
        title: "Nothing loaded yet",
        description: "Paste a diagrams/v1 file into Load JSON on the right.",
        nodes: [],
        edges: [],
      },
  },
];

// ---------- live view ----------

const liveSpeed: ControlDef = {
  type: "select",
  key: "livespeed",
  label: "Speed",
  default: "1",
  options: ["0.25", "0.5", "1", "2", "4", "8"].map((s) => ({ value: s, label: `${s}×` })),
};
const livePresent: ControlDef = { type: "boolean", key: "livepresent", label: "Presentation sizing", default: false };

const livePresets: Preset[] = [
  {
    kind: "render",
    id: "live-particles-stress",
    title: "Live: particles stress",
    group: "Simulation",
    description:
      "Continuous traffic sized to keep ~N particles in flight (the engine draws at most 1,500). Watch the frame rate.",
    controls: [
      {
        type: "select",
        key: "particles",
        label: "Particles",
        default: "1500",
        options: ["250", "500", "1000", "1500", "3000"].map((v) => ({ value: v, label: v })),
      },
      liveSpeed,
      livePresent,
    ],
    render: (v) => (
      <LiveLabStage
        key={`${v.particles}:${v.livespeed}`}
        diagram={particleStressDiagram(Number(v.particles))}
        presenting={!!v.livepresent}
        initial={{ traffic: true, speed: Number(v.livespeed) }}
      />
    ),
  },
  {
    kind: "render",
    id: "live-badge-states",
    title: "Live: badge states",
    group: "Simulation",
    description: "Down, paused, slow, failing (retries and dead letters) and healthy nodes, paused a few seconds in.",
    controls: [
      { type: "number", key: "at", label: "Paused at (s)", default: 5, min: 0, max: 20, step: 0.5 },
      { type: "boolean", key: "play", label: "Keep playing", default: false },
      livePresent,
    ],
    render: (v) => {
      const d = badgeStatesDiagram();
      return (
        <LiveLabStage
          key={`${v.at}:${v.play}`}
          diagram={d}
          presenting={!!v.livepresent}
          initial={{ sim: d.simulations![0].id, seekMs: Number(v.at) * 1000, paused: !v.play }}
        />
      );
    },
  },
  {
    kind: "render",
    id: "live-note-states",
    title: "Live: narration callouts",
    group: "Simulation",
    description: "A note focused on one node, a pausing note, a note spanning the diagram, and a free-floating note.",
    controls: [
      {
        type: "select",
        key: "note",
        label: "Note",
        default: "focus",
        options: [
          { value: "focus", label: "Focused on one node" },
          { value: "pause", label: "Pausing (waits for Continue)" },
          { value: "wide", label: "Focus far apart" },
          { value: "free", label: "No focus" },
        ],
      },
      livePresent,
    ],
    render: (v) => {
      const d = noteStatesDiagram(v.note as NoteState);
      return <LiveLabStage key={String(v.note)} diagram={d} presenting={!!v.livepresent} initial={{ sim: "story" }} />;
    },
  },
  ...examples
    .filter((e) => !localOnly.has(e.slug))
    .flatMap((e) =>
      (e.diagram.simulations ?? []).map((s): Preset => ({
        kind: "render",
        id: `live-${e.slug}-${s.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
        title: `Live: ${s.title}`,
        group: "Simulation",
        description: `${e.diagram.title}. ${s.description ?? ""}`.trim(),
        controls: [liveSpeed, livePresent],
        render: (v) => (
          <LiveLabStage
            key={String(v.livespeed)}
            diagram={e.diagram}
            presenting={!!v.livepresent}
            initial={{ sim: s.id, speed: Number(v.livespeed) }}
          />
        ),
      })),
    ),
];

// ---------- layout quality (routing, labels, overlap audit) ----------

const auditSources: Record<string, { label: string; diagram: () => DiagramFile }> = {
  ...Object.fromEntries(examples.map((e) => [e.slug, { label: e.diagram.title, diagram: () => e.diagram }])),
  obstacles: { label: "Routing obstacle course", diagram: () => obstacleCourseDiagram() },
  "stress-150": { label: "Stress: 150 nodes", diagram: () => stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: false, direction: "LR" }) },
};
const auditDefault = examples.some((e) => e.slug === "kafka-order-pipeline") ? "kafka-order-pipeline" : Object.keys(auditSources)[0];

const layoutPresets: Preset[] = [
  {
    kind: "diagram",
    id: "edges-obstacles",
    title: "Routing obstacle course",
    group: "Edges",
    description: "Edges that skip columns, fan out from one side, run backwards and come in reverse pairs: routes go around cards, ports spread, parallel runs separate.",
    controls: [
      { type: "number", key: "cols", label: "Columns", default: 4, min: 3, max: 8 },
      { type: "number", key: "rows", label: "Rows", default: 3, min: 1, max: 7 },
      { type: "number", key: "gap", label: "Column pitch", default: 400, min: 300, max: 600, step: 20 },
    ],
    diagram: (v) => obstacleCourseDiagram(Number(v.cols), Number(v.rows), Number(v.gap)),
  },
  {
    kind: "render",
    id: "overlap-audit",
    title: "Overlap audit",
    group: "Diagrams",
    description: "A diagram on the real canvas with every overlap outlined: nodes, label pills, routes through cards, shared tracks and group headers. Drag nodes to watch it update.",
    controls: [{ type: "select", key: "diagram", label: "Diagram", default: auditDefault, options: Object.entries(auditSources).map(([value, s]) => ({ value, label: s.label })) }],
    render: (v) => {
      const src = auditSources[String(v.diagram)] ?? auditSources[auditDefault];
      return <OverlapAudit key={String(v.diagram)} diagram={src.diagram()} />;
    },
  },
];

export const presets: readonly Preset[] = [
  ...nodePresets,
  ...edgePresets,
  ...diagramPresets,
  ...simPresets,
  ...livePresets,
  ...playgroundPresets,
  ...layoutPresets,
];

export const DEFAULT_PRESET_ID = "nodes-states";

export function getPreset(id: string | null | undefined): Preset | undefined {
  return presets.find((p) => p.id === id);
}
