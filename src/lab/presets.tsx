import { kedaFixture } from "./kedaFixture";
import { ImportRetryLab } from "./ImportRetryLab";
import { LiveKeyboardLab } from "./LiveKeyboardLab";
import { measuredHierarchyFixture, nestedBoundariesFixture } from "./nestedBoundariesFixture";
import { captionContrastFixture } from "./captionContrastFixture";
import { GalleryCatalogLab } from "./GalleryCatalogLab";
import { autoscalingFixture } from "./autoscalingFixture";
import { ColourPickerLab } from "./ColourPickerLab";
import { customColoursFixture } from "./customColoursFixture";
import { planningP3Fixture, planningP3BulkFixture } from "./planningP3Fixture";
import { planningP2Fixture } from "./planningP2Fixture";
import { OnDeviceEvalsLab } from "./OnDeviceEvalsLab";
import { relationshipFixture } from "./relationshipFixture";
import { planningFixture } from "./planningFixture";
import { t } from "../i18n";
import { safeStorage } from "../lib/storage";
import { ON_DEVICE } from "../lib/deployment";
import { layersFixture, headerOverflowFixture } from "./layersFixture";
import { simReviewFixture, simReviewTrafficFixture } from "./simReviewFixture";
import { exportFixture } from "./exportFixture";
import { textFieldsFixture } from "./textFieldsFixture";
import { InspectorFocusLab } from "./InspectorFocusLab";
import { TroubleCallout } from "../live/CapacityLayer";
import "../styles/capacity.css";
import { FilePrompts } from "./FilePrompts";
// The Lab's preset registry. Every entry renders the *current* components with fixed data, so
// opening ?view=lab&preset=<id> is a quick visual check of whatever you're working on.
//
// Add a preset: push an object onto `presets` (see types.ts). Controls become inputs in the right
// panel and URL params automatically (`?view=lab&preset=my-id&count=12`).

import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { examples } from "../examples";
import { labMetadata } from "../examples/labMetadata";
import { exampleDiagram } from "./exampleDiagram";
import { stencils } from "../stencils/registry";
import { CATEGORY_ORDER, categoryLabel } from "../lib/categories";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";
import {
  backEdgeDiagram,
  cycleDiagram,
  edgeKindsDiagram,
  edgeRelationsDiagram,
  edgeSidesDiagram,
  fanEdgesDiagram,
  fanOutDiagram,
  groupsDiagram,
  oddNodesDiagram,
  stressDiagram,
} from "./generators";
import { scenarioDefs } from "./scenarios";
import { AllStencils, NodeMatrix, NodePlayground } from "./NodeShowcase";
import { NODE_STATES } from "./nodeStates";
import type { ControlDef, Preset } from "./types";
import { LiveLabStage } from "../live/LiveLabStage";
import { badgeStatesDiagram, noteStatesDiagram, particleStressDiagram, type NoteState } from "../live/labDiagrams";
import { OverlapAudit } from "./OverlapAudit";
import {
  importedAsyncApi,
  importedCompose,
  importedKubernetes,
  importedTerraform,
  importedTerraformAzure,
} from "./importFixtures";
import { annotationCourseDiagram, obstacleCourseDiagram } from "./routingDiagrams";
import { TraceCardInteraction, TraceCardStates, TraceSequencePreview, type TraceFlow } from "../live/TraceLab";

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
      { type: "text", key: "sublabel", label: "Subtitle", default: "orders.created.v1" },
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
    id: "edges-relations",
    title: "Relationships",
    group: "Edges",
    description:
      "Message and request flows, then the six dependencies: dotted, glyph and tint. Hover the config edge for its settings.",
    diagram: () => edgeRelationsDiagram(),
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

// Local-only examples never appear in Lab previews or UI copy.
const localOnly = new Set(examples.filter((e) => e.localOnly).map((e) => e.slug));

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
      title: e.title,
      group: "Diagrams",
      description: e.description,
      exampleSlug: e.slug,
      diagram: () => exampleDiagram(e.slug),
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
    id: "nested-boundaries",
    title: "Nested boundaries",
    group: "Diagrams",
    description: "A child-first hierarchy with a node and note: move or wrap the selection, then follow it with Tab.",
    diagram: () => structuredClone(nestedBoundariesFixture),
  },
  {
    kind: "diagram",
    id: "caption-contrast",
    title: "Caption contrast",
    group: "Diagrams",
    description: "Custom caption ink over separate boundary and zone fills.",
    diagram: () => structuredClone(captionContrastFixture),
  },
  {
    kind: "diagram",
    id: "measured-hierarchy",
    title: "Measured hierarchy",
    group: "Diagrams",
    description: "Auto-layout refits three empty boundary levels around measured cards, a note and a zone.",
    diagram: () => structuredClone(measuredHierarchyFixture),
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
  ...(["orders", "connections", "no-reader", "outage", "many-groups", "analysis-limit"] as const).map(
    (kind): Preset => ({
      kind: "diagram",
      id: `planning-${kind}`,
      get title() {
        return kind === "orders"
          ? t("planning.labOrders")
          : kind === "connections"
            ? t("planning.labConnections")
            : kind === "analysis-limit"
              ? t("planning.labAnalysisLimit")
              : kind === "many-groups"
                ? t("planning.labManyGroups")
                : kind === "outage"
                  ? t("planning.labOutage")
                  : t("planning.labNoReader");
      },
      group: "Diagrams",
      diagram: () => planningFixture(kind),
    }),
  ),
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
  // Not in a copy deployed without the on-device model (src/lib/deployment.ts): it would run the model.
  ...(ON_DEVICE
    ? ([
        {
          kind: "render",
          id: "ondevice-evals",
          title: "On-device model: evals",
          group: "Playground",
          description:
            "Runs the eval cases through Chrome's built-in model with the AI panel's prompt and schema. Needs the model; never in CI.",
          render: () => <OnDeviceEvalsLab />,
        },
      ] satisfies Preset[])
    : []),
  {
    kind: "diagram",
    id: "autoscaling-a1",
    title: t("autoscaling.lesson"),
    group: "Playground",
    diagram: () => autoscalingFixture(),
  },
  {
    kind: "diagram",
    id: "autoscaling-a2",
    title: t("autoscaling.kedaPreset", { broker: "Kafka" }),
    group: "Playground",
    diagram: () => kedaFixture(),
  },
  {
    kind: "diagram",
    id: "relationship-regressions",
    title: "Relationship regressions",
    group: "Playground",
    diagram: () => relationshipFixture,
  },
  {
    kind: "diagram",
    id: "custom-colours",
    title: "Custom colours",
    group: "Playground",
    diagram: () => customColoursFixture,
  },
  {
    kind: "render",
    id: "colour-picker",
    title: "Colour picker mutations",
    group: "Playground",
    render: () => <ColourPickerLab />,
  },
  {
    kind: "diagram",
    id: "text-fields",
    title: "Text selection and naming",
    group: "Playground",
    diagram: () => textFieldsFixture,
  },
  {
    kind: "render",
    id: "inspector-focus",
    title: "Inspector focus before selection",
    group: "Playground",
    render: () => <InspectorFocusLab />,
  },
  {
    kind: "render",
    id: "trouble-callout-counts",
    title: "Live callout changing counts",
    group: "Playground",
    controls: [{ key: "count", label: "Waiting messages", type: "text", default: "111" }],
    render: (v) => (
      <TroubleCallout
        floating
        trouble={{
          key: "down:payments",
          kind: "down",
          node: "payments",
          headline: "Payments service is down",
          announce: "Payments service is down",
          detail: `Messages wait in orders until it's back (${String(v.count)} so far).`,
          action: { kind: "revive", node: "payments" },
        }}
        onAction={() => {}}
        onDismiss={() => {}}
      />
    ),
  },
  {
    kind: "diagram",
    id: "export-contract",
    title: "Complete export contract",
    group: "Playground",
    diagram: () => exportFixture,
  },
  {
    kind: "diagram",
    id: "sim-review-losses",
    title: "Simulation review: delivery losses",
    group: "Diagrams",
    description: "A failing consumer exhausts deliveries; the live callout adds a dead-letter queue.",
    diagram: () => simReviewFixture(),
  },
  {
    kind: "diagram",
    id: "sim-review-diagnostics",
    title: "Simulation review: loss diagnostics",
    group: "Diagrams",
    description: "An incompatible dead-letter filter loses deliveries; Show events remains available in slow motion.",
    diagram: () => simReviewFixture(true),
  },
  {
    kind: "diagram",
    id: "sim-review-traffic-budget",
    title: "Simulation review: continuous source budget",
    group: "Diagrams",
    description:
      "The file accepts ten million messages per second; its explicit one-message-per-dot scale cannot enable continuous traffic.",
    diagram: () => simReviewTrafficFixture(),
  },

  {
    kind: "diagram",
    id: "overlapping-layers",
    title: "Overlapping layers",
    group: "Diagrams",
    description: "A note over a node for inspecting Send to back, undo and reload.",
    diagram: () => layersFixture,
  },
  {
    kind: "diagram",
    id: "header-overflow",
    title: "Long export header",
    group: "Diagrams",
    description: "A one-node diagram with unbroken title and description text.",
    diagram: () => headerOverflowFixture,
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
    id: "live-keyboard",
    title: "Live: keyboard lifecycle",
    group: "Simulation",
    description: "A host render during Escape must not replace the live session's keyboard listener.",
    render: () => <LiveKeyboardLab />,
  },
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
      (labMetadata[e.slug] ?? []).map((s): Preset => ({
        kind: "render",
        id: `live-${e.slug}-${s.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
        title: `Live: ${s.title}`,
        group: "Simulation",
        description: `${e.title}. ${s.description ?? ""}`.trim(),
        controls: [liveSpeed, livePresent],
        render: (v) => (
          <LiveLabStage
            key={String(v.livespeed)}
            diagram={exampleDiagram(e.slug)}
            presenting={!!v.livepresent}
            initial={{ sim: s.id, speed: Number(v.livespeed) }}
          />
        ),
      })),
    ),
];

// ---------- inputs & capacity (heat map, bottleneck callout, the panel) ----------

const publicExamples = examples.filter((e) => !localOnly.has(e.slug));
const exampleBySlug = (slug: string) => publicExamples.find((e) => e.slug === slug);

/** Heat map states on real examples: which simulation, what what-if, and a word for each. */
const CAPACITY_STATES: Record<string, { label: string; slug: string; sim: string; traffic?: number }> = {
  healthy: { label: "Healthy (Black Friday at 0.5×)", slug: "kafka-order-pipeline", sim: "black-friday", traffic: 0.5 },
  busy: { label: "Busy (Black Friday as saved)", slug: "kafka-order-pipeline", sim: "black-friday" },
  saturated: { label: "Saturated (Black Friday at 3×)", slug: "kafka-order-pipeline", sim: "black-friday", traffic: 3 },
  idle: { label: "Idle replicas (partition hot spot)", slug: "iot-telemetry", sim: "hot-spot" },
};

const capacityPresets: Preset[] = [
  {
    kind: "render",
    id: "capacity-heat-map",
    title: "Capacity: heat map states",
    group: "Simulation",
    description:
      "The capacity heat map with its bottleneck callout: green below 60%, amber to 90%, red above, pulsing past 100%, and replicas left idle by too few partitions.",
    controls: [
      {
        type: "select",
        key: "state",
        label: "State",
        default: "saturated",
        options: Object.entries(CAPACITY_STATES)
          .filter(([, s]) => exampleBySlug(s.slug))
          .map(([value, s]) => ({ value, label: s.label })),
      },
      { type: "boolean", key: "panel", label: "Inputs panel open", default: false },
      livePresent,
    ],
    render: (v) => {
      const state = CAPACITY_STATES[String(v.state)] ?? CAPACITY_STATES.saturated;
      const example = exampleBySlug(state.slug);
      if (!example) return null;
      return (
        <LiveLabStage
          key={`${String(v.state)}:${String(v.panel)}`}
          diagram={exampleDiagram(example.slug)}
          presenting={!!v.livepresent}
          initial={{
            sim: state.sim,
            paused: true,
            capacity: true,
            panel: v.panel ? "capacity" : undefined,
            inputs: state.traffic === undefined ? undefined : { traffic: state.traffic },
          }}
        />
      );
    },
  },
  {
    kind: "render",
    id: "capacity-panel",
    title: "Inputs & capacity panel",
    group: "Simulation",
    description:
      "The Inputs & capacity panel generated from each public example, with the heat map on: entry points, services and topics, the what-if sliders and the bottleneck callout.",
    controls: [
      {
        type: "select",
        key: "diagram",
        label: "Example",
        default: publicExamples[0]?.slug ?? "",
        options: publicExamples.map((e) => ({ value: e.slug, label: e.title })),
      },
      {
        type: "select",
        key: "run",
        label: "Run",
        default: "0",
        options: [
          { value: "0", label: "First saved simulation" },
          { value: "1", label: "Second saved simulation" },
          { value: "free", label: "Free play" },
        ],
      },
      livePresent,
    ],
    render: (v) => {
      const example = exampleBySlug(String(v.diagram)) ?? publicExamples[0];
      if (!example) return null;
      const sim = v.run === "free" ? null : (labMetadata[example.slug]?.[Number(v.run)]?.id ?? null);
      return (
        <LiveLabStage
          key={`${example.slug}:${String(v.run)}`}
          diagram={exampleDiagram(example.slug)}
          presenting={!!v.livepresent}
          initial={{ sim, paused: true, capacity: true, panel: "capacity" }}
        />
      );
    },
  },
];

// ---------- layout quality (routing, labels, overlap audit) ----------

const auditSources: Record<string, { label: string; diagram: () => DiagramFile }> = {
  "caption-contrast": { label: "Caption contrast", diagram: () => structuredClone(captionContrastFixture) },
  ...Object.fromEntries(examples.map((e) => [e.slug, { label: e.title, diagram: () => exampleDiagram(e.slug) }])),
  obstacles: { label: "Routing obstacle course", diagram: () => obstacleCourseDiagram() },
  "imported-compose": { label: "Imported: compose", diagram: importedCompose },
  "imported-asyncapi": { label: "Imported: AsyncAPI", diagram: importedAsyncApi },
  "imported-kubernetes": { label: "Imported: Kubernetes", diagram: importedKubernetes },
  "imported-terraform": { label: "Imported: Terraform (AWS plan)", diagram: importedTerraform },
  "imported-terraform-azure": { label: "Imported: Terraform (Azure state)", diagram: importedTerraformAzure },
  annotations: { label: "Annotations among routes", diagram: () => annotationCourseDiagram() },
  "stress-150": {
    label: "Stress: 150 nodes",
    diagram: () => stressDiagram({ nodes: 150, seed: 1, density: 0.25, groups: false, direction: "LR" }),
  },
};
const auditDefault = examples.some((e) => e.slug === "kafka-order-pipeline")
  ? "kafka-order-pipeline"
  : Object.keys(auditSources)[0];

const layoutPresets: Preset[] = [
  {
    kind: "diagram",
    id: "imported-compose",
    title: "Imported: compose",
    group: "Diagrams",
    description:
      "tests/fixtures/imports/compose/docker-compose.yml through the import pipeline: stencils, connections from settings, networks as boundaries and the three-step layout.",
    diagram: importedCompose,
  },
  {
    kind: "diagram",
    id: "imported-asyncapi",
    title: "Imported: AsyncAPI",
    group: "Diagrams",
    description:
      "The three AsyncAPI fixtures (tests/fixtures/imports/asyncapi) joined on their channels: apps, Kafka and RabbitMQ boundaries, typed flows and the Imported traffic simulation.",
    diagram: importedAsyncApi,
  },
  {
    kind: "diagram",
    id: "imported-kubernetes",
    title: "Imported: Kubernetes",
    group: "Diagrams",
    description:
      "The five Kubernetes fixtures (tests/fixtures/imports/k8s): namespaces as boundaries, the Ingress entry, ConfigMap, Secrets and workload identity, and the KEDA consumer on a Strimzi topic.",
    diagram: importedKubernetes,
  },
  {
    kind: "diagram",
    id: "imported-terraform",
    title: "Imported: Terraform (AWS plan)",
    group: "Diagrams",
    description:
      "The AWS plan fixture (tests/fixtures/imports/terraform): SNS → SQS → Lambda → DynamoDB flows from subscriptions and event-source mappings, the streaming module as a boundary, and IAM, secret and config relationships.",
    diagram: importedTerraform,
  },
  {
    kind: "diagram",
    id: "imported-terraform-azure",
    title: "Imported: Terraform (Azure state)",
    group: "Diagrams",
    description:
      "The Azure state fixture: resource groups as boundaries, a Service Bus forward, Event Grid into a Function App, and role assignments read as flows and a Key Vault secret relationship.",
    diagram: importedTerraformAzure,
  },
  {
    kind: "diagram",
    id: "edges-obstacles",
    title: "Routing obstacle course",
    group: "Edges",
    description:
      "Edges that skip columns, fan out from one side, run backwards and come in reverse pairs: routes go around cards, ports spread, parallel runs separate.",
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
    description:
      "A diagram on the real canvas with every overlap outlined: nodes, label pills, routes through cards, shared tracks and group headers. Drag nodes to watch it update.",
    controls: [
      {
        type: "select",
        key: "diagram",
        label: "Diagram",
        default: auditDefault,
        options: Object.entries(auditSources).map(([value, s]) => ({ value, label: s.label })),
      },
    ],
    render: (v) => {
      const src = auditSources[String(v.diagram)] ?? auditSources[auditDefault];
      return <OverlapAudit key={String(v.diagram)} diagram={src.diagram()} />;
    },
  },
];

// ---------- message trace (trace card states, sequence diagrams of each public example) ----------

/** Each public example's first message from its entry point, plus every dead-lettering simulation. */
const traceFlows: Record<string, { label: string; flow: () => TraceFlow }> = Object.fromEntries([
  ...examples
    .filter((e) => !localOnly.has(e.slug))
    .map((e) => [e.slug, { label: e.title, flow: () => ({ diagram: exampleDiagram(e.slug) }) }]),
  ...examples
    .filter((e) => !localOnly.has(e.slug))
    .flatMap((e) =>
      (labMetadata[e.slug] ?? [])
        .filter((s) => s.deadLetter)
        .map((s) => [
          `${e.slug}:${s.id}`,
          {
            label: `${e.title}: ${s.title} (dead letter)`,
            flow: () => ({
              diagram: exampleDiagram(e.slug),
              simulation: exampleDiagram(e.slug).simulations?.find((simulation) => simulation.id === s.id),
              deadLetter: true,
            }),
          },
        ]),
    ),
]);
const traceDefault = Object.keys(traceFlows)[0];
const deadLetterDefault = Object.keys(traceFlows).find((k) => k.includes(":")) ?? traceDefault;
const traceFlowControl = (key: string, label: string, value: string): ControlDef => ({
  type: "select",
  key,
  label,
  default: value,
  options: Object.entries(traceFlows).map(([v, f]) => ({ value: v, label: f.label })),
});
const flowOf = (key: unknown, fallback: string) => (traceFlows[String(key)] ?? traceFlows[fallback]).flow();

const tracePresets: Preset[] = [
  {
    kind: "render",
    id: "trace-card-interaction",
    title: "Trace: replace and follow",
    group: "Simulation",
    description: "Switch between equal-length journeys and append hops to check scrolling in the trace card.",
    controls: [],
    render: () => <TraceCardInteraction flow={flowOf(traceDefault, traceDefault)} />,
  },
  {
    kind: "render",
    id: "trace-card-states",
    title: "Trace: card states",
    group: "Simulation",
    description:
      "The trace card waiting at a node, in flight, done (with fan-out copies) and retried then dead-lettered.",
    controls: [
      traceFlowControl("flow", "Message", traceDefault),
      traceFlowControl("failing", "Failing", deadLetterDefault),
    ],
    render: (v) => (
      <TraceCardStates
        key={`${v.flow}:${v.failing}`}
        flow={flowOf(v.flow, traceDefault)}
        failing={flowOf(v.failing, deadLetterDefault)}
      />
    ),
  },
  {
    kind: "render",
    id: "trace-sequence",
    title: "Trace: sequence diagram",
    group: "Simulation",
    description:
      "The sequence diagram generated from one traced message (its whole fan-out tree), and its Mermaid text.",
    controls: [traceFlowControl("flow", "Flow", traceDefault)],
    render: (v) => <TraceSequencePreview key={String(v.flow)} flow={flowOf(v.flow, traceDefault)} />,
  },
  {
    kind: "render",
    id: "trace-live",
    title: "Trace: live",
    group: "Simulation",
    description: "A traced message on the live canvas: it glows with a label, the rest dims, its path lights up.",
    controls: [traceFlowControl("flow", "Flow", traceDefault), liveSpeed, livePresent],
    render: (v) => {
      const flow = flowOf(v.flow, traceDefault);
      return (
        <LiveLabStage
          key={`${v.flow}:${v.livespeed}`}
          diagram={flow.diagram}
          presenting={!!v.livepresent}
          initial={{
            sim: flow.simulation?.id ?? null,
            traffic: !flow.simulation,
            speed: Number(v.livespeed),
            trace: flow.deadLetter ? "deadletter" : "next",
          }}
        />
      );
    },
  },
];

export const presets: readonly Preset[] = [
  {
    kind: "render",
    id: "import-retry",
    title: "Retry a degraded import",
    group: "Playground",
    description: "Recover omitted scaling dependencies from an unchanged boundary selection.",
    controls: [],
    render: () => <ImportRetryLab />,
  },
  {
    kind: "render",
    id: "gallery-local-catalog",
    title: "Gallery local catalog",
    group: "Playground",
    description: "The gallery and keyboard picker with a synthetic local example.",
    controls: [],
    render: () => <GalleryCatalogLab />,
  },
  {
    kind: "render",
    id: "planning-p3-bulk",
    title: "Managed bulk editing",
    group: "Playground",
    description: "Mixed admission values with independent account budgets.",
    render: () => <LiveLabStage diagram={planningP3BulkFixture()} />,
  },
  {
    kind: "render",
    id: "planning-p3",
    title: "Managed admission",
    group: "Playground",
    description: "Account budgets, concurrent calls and unknown evidence.",
    controls: [
      {
        type: "select",
        key: "api",
        label: "API",
        default: "generic.external-api",
        options: ["stripe", "generic.external-api", "aws.lambda", "openai", "paypal", "iterable"].map((value) => ({
          value,
          label: value,
        })),
      },
    ],
    render: (v) => <LiveLabStage key={String(v.api)} diagram={planningP3Fixture(String(v.api))} />,
  },
  {
    kind: "render",
    id: "planning-p2",
    title: "Logs and subscriptions",
    group: "Playground",
    description: "Compare partition or shard assignment with subscription and binding fan-out.",
    controls: [
      {
        type: "select",
        key: "broker",
        label: "Broker",
        default: "aws.sns",
        options: [
          "aws.sns",
          "kafka.topic",
          "aws.kinesis",
          "azure.event-hubs",
          "rabbitmq.exchange",
          "gcp.pubsub",
          "azure.service-bus.topic",
        ].map((value) => ({ value, label: value })),
      },
    ],
    render: (v) => <LiveLabStage key={String(v.broker)} diagram={planningP2Fixture(String(v.broker))} />,
  },
  {
    kind: "render",
    id: "file-prompts",
    title: "File provider prompts",
    group: "Playground",
    description: "Cloud sign-in, permission and file errors, without an account or network.",
    controls: [
      {
        type: "select",
        key: "scenario",
        label: "Reply",
        default: "blocked",
        options: ["blocked", "admin", "denied", "expired", "full"].map((value) => ({ value, label: value })),
      },
    ],
    render: ({ scenario }) => <FilePrompts scenario={String(scenario)} />,
  },
  ...nodePresets,
  ...edgePresets,
  ...diagramPresets,
  ...simPresets,
  ...livePresets,
  ...tracePresets,
  ...capacityPresets,
  ...playgroundPresets,
  ...layoutPresets,
];

export const DEFAULT_PRESET_ID = "nodes-states";

export function getPreset(id: string | null | undefined): Preset | undefined {
  return presets.find((p) => p.id === id);
}
