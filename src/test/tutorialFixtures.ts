import type { DiagramFile } from "../model/types";
import type { Tutorial, TutorialStep, Words } from "../tutorials/types";

/**
 * Lessons that exercise the runner's data forms no catalog lesson uses yet: prop paths and length checks,
 * edit-preserving patches, Live metric expressions (sums, comparisons, a delta since the step began) and a combined add
 * and name. They go through the catalog's authoring lint (catalog.test.ts) and the completion sweep's cases
 * (completionSweep.test.ts), as a lesson would. Tests only: not in the catalog, the Lab or any bundle.
 */

const words =
  (text: string): Words =>
  () =>
    text;
const step = (
  id: string,
  rest: Omit<TutorialStep, "id" | "title" | "goal" | "targets" | "solution"> & Partial<TutorialStep>,
) =>
  ({
    id,
    title: words(id),
    goal: words(`Do ${id}`),
    targets: [{ testId: "canvas-pane", tip: words(`Do ${id}`) }],
    solution: [{ hover: "canvas-pane" }],
    ...rest,
  }) as TutorialStep;
const base = (id: string, start: () => DiagramFile) =>
  ({
    id,
    version: 1,
    track: "blocks",
    level: 2,
    minutes: 2,
    title: words(id),
    summary: words(id),
    start,
    finish: { text: words("Done") },
  }) as const;

const token = words("Token");

/** Settings on a dependency: a fifth key added without touching the learner's four, then that fifth marked secret. */
export const pathsFixture: Tutorial = {
  ...base("fixture-paths", () => ({
    format: "diagrams/v1",
    title: "Paths",
    nodes: [
      { id: "api", stencil: "generic.service", label: "API", x: 0, y: 0 },
      { id: "config", stencil: "postgres", label: "Config", x: 240, y: 0 },
    ],
    edges: [
      {
        id: "api-config",
        from: "api",
        to: "config",
        kind: "sync",
        props: { settings: [{ key: "Host" }, { key: "Port" }, { key: "User" }, { key: "Pool" }] },
      },
    ],
  })),
  subjects: { api: { stencils: ["generic.service"] }, config: { stencils: ["postgres"] } },
  steps: [
    step("add-setting", {
      check: { kind: "prop", edge: ["api", "config"], prop: ["settings"], measure: "length", op: ">=", value: 5 },
      demo: [
        {
          kind: "patch",
          edge: ["api", "config"],
          patches: [{ op: "ensureItem", path: ["settings"], match: { key: token } }],
        },
      ],
    }),
    step("mark-secret", {
      check: { kind: "prop", edge: ["api", "config"], prop: ["settings", 4, "secret"], op: "=", value: true },
      demo: [
        {
          kind: "patch",
          edge: ["api", "config"],
          patches: [{ op: "set", path: ["settings", 4, "secret"], value: true }],
        },
      ],
    }),
    step("default-retries", {
      check: {
        kind: "all",
        checks: [
          { kind: "prop", subject: "api", prop: ["retry", "attempts"], op: ">=", value: 3 },
          {
            kind: "prop",
            edge: ["api", "config"],
            prop: ["settings", { where: { key: token } }, "secret"],
            op: "=",
            value: true,
          },
        ],
      },
      demo: [
        { kind: "patch", subject: "api", patches: [{ op: "setIfMissing", path: ["retry", "attempts"], value: 3 }] },
      ],
    }),
  ],
};

/** A queue and two workers on a seeded run: replicas as Live shows them, counter sums, comparisons, a delta. */
export const metricsFixture: Tutorial = {
  ...base("fixture-metrics", () => ({
    format: "diagrams/v1",
    title: "Metrics",
    nodes: [
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0, props: { ratePerSec: 8 } },
      { id: "queue", stencil: "aws.sqs", label: "Queue", x: 240, y: 0 },
      { id: "first", stencil: "generic.service", label: "First", x: 480, y: -110, props: { replicas: 1 } },
      { id: "second", stencil: "generic.service", label: "Second", x: 480, y: 110 },
    ],
    edges: [
      { id: "app-queue", from: "app", to: "queue", kind: "async" },
      { id: "queue-first", from: "queue", to: "first", kind: "async" },
      { id: "queue-second", from: "queue", to: "second", kind: "async" },
    ],
    simulations: [{ id: "flow", title: "Flow", seed: 20261025, scale: 1, durationMs: 600_000, traffic: [] }],
  })),
  subjects: {
    app: { stencils: ["client.mobile"] },
    queue: { stencils: ["aws.sqs"] },
    first: { stencils: ["generic.service"] },
    second: { stencils: ["generic.service"] },
  },
  steps: [
    step("live", { check: { kind: "simulation", id: "flow" }, demo: [{ kind: "runSimulation", id: "flow" }] }),
    step("replicas", {
      check: {
        kind: "all",
        checks: [
          { kind: "prop", subject: "first", prop: "replicas", op: "=", value: 2 },
          { kind: "metric", subject: "first", field: "replicas", op: "=", value: 2 },
        ],
      },
      demo: [{ kind: "prop", subject: "first", props: { replicas: 2 } }],
    }),
    step("balanced", {
      check: {
        kind: "all",
        checks: [
          { kind: "compare", left: { sum: "processed", every: { stencils: ["generic.service"] } }, op: ">=", right: 5 },
          {
            kind: "compare",
            left: { sum: "processed", nodes: ["first", "second"] },
            op: "<=",
            right: { sum: "delivered", from: "queue" },
          },
        ],
      },
      sticky: true,
      demo: [],
    }),
    step("since", {
      check: { kind: "compare", left: { sinceStep: { node: "first", metric: "processed" } }, op: ">=", right: 5 },
      sticky: true,
      demo: [],
    }),
    step("lower", {
      check: {
        kind: "compare",
        left: { node: "queue", metric: "backlog" },
        op: "<",
        right: {
          sum: "delivered",
          edges: [
            ["queue", "first"],
            ["queue", "second"],
          ],
        },
      },
      sticky: true,
      demo: [],
    }),
  ],
};

/** Add a connected service and name it, twice: one step each, as a gateway's routes are built. */
const addNamed = (id: string, subject: string, name: string): TutorialStep =>
  step(id, {
    check: {
      kind: "all",
      checks: [
        { kind: "edge", from: "gw", to: subject },
        { kind: "label", subject, is: words(name) },
      ],
    },
    settle: "naming",
    demo: [
      { kind: "add", subject, stencil: "generic.service", after: "gw" },
      { kind: "rename", subject, label: words(name) },
    ],
  });
export const addNameFixture: Tutorial = {
  ...base("fixture-add-name", () => ({
    format: "diagrams/v1",
    title: "Add and name",
    nodes: [{ id: "gw", stencil: "client.mobile", label: "Gateway", x: 0, y: 0 }],
    edges: [],
  })),
  subjects: {
    gw: { stencils: ["client.mobile"] },
    orders: { stencils: ["generic.service"], role: "processor" },
    users: { stencils: ["generic.service"], role: "processor" },
  },
  steps: [addNamed("add-orders", "orders", "Orders"), addNamed("add-users", "users", "Users")],
};

/**
 * Live's own controls and the inspector's typed fields, in the ports' shapes: a trace from the canvas (outbox), a saved
 * run with Continuous traffic (build-04's Live step), a connection's settings typed at the field's end
 * (dependencies-2), pointed at through the connection between two subjects.
 */
export const liveControlsFixture: Tutorial = {
  ...base("fixture-live-controls", () => ({
    format: "diagrams/v1",
    title: "Live controls",
    nodes: [
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0, props: { ratePerSec: 8 } },
      { id: "api", stencil: "generic.service", label: "API", x: 240, y: 0 },
      { id: "config", stencil: "postgres", label: "Config", x: 480, y: 0 },
    ],
    edges: [
      { id: "app-api", from: "app", to: "api", kind: "sync" },
      { id: "saved-elsewhere", from: "api", to: "config", kind: "sync", props: { settings: [{ key: "Host" }] } },
    ],
    simulations: [{ id: "flow", title: "Flow", seed: 20261025, scale: 1, durationMs: 600_000, traffic: [] }],
  })),
  subjects: {
    app: { stencils: ["client.mobile"] },
    api: { stencils: ["generic.service"] },
    config: { stencils: ["postgres"] },
  },
  steps: [
    step("trace", {
      check: { kind: "trace" },
      sticky: true,
      targets: [
        { testId: "live-trace-next", tip: words("Trace") },
        { testId: "live-more", tip: words("Trace") },
        { testId: "live-toggle", tip: words("Trace") },
      ],
      demo: [{ kind: "live" }, { kind: "trace" }],
      solution: [
        { click: "live-toggle" },
        { click: "live-more" },
        { click: "live-trace-message" },
        { click: "live-trace-next" },
      ],
    }),
    step("flow", {
      check: { kind: "simulation", id: "flow", traffic: true },
      targets: [
        { testId: "live-traffic", tip: words("Traffic") },
        { testId: "live-controls", tip: words("Traffic"), dim: false },
        { testId: "live-toggle", tip: words("Traffic") },
      ],
      demo: [
        { kind: "runSimulation", id: "flow" },
        { kind: "traffic", on: true },
      ],
      solution: [
        { click: "live-toggle" },
        { select: "live-sim-picker", value: "flow" },
        { click: "live-more" },
        { click: "live-traffic" },
        { click: "live-more" },
      ],
    }),
    step("setting", {
      check: { kind: "prop", edge: ["api", "config"], prop: ["settings"], measure: "length", op: ">=", value: 2 },
      targets: [
        { testId: "inspector-field-settings", tip: words("Setting") },
        { testId: "edge-label-{api->config}", tip: words("Setting") },
      ],
      demo: [
        {
          kind: "patch",
          edge: ["api", "config"],
          patches: [{ op: "ensureItem", path: ["settings"], match: { key: token } }],
        },
      ],
      solution: [
        { click: "edge-label-{api->config}" },
        { click: "inspector-field-settings" },
        { press: "ControlOrMeta+End" },
        { press: "Enter" },
        { type: "inspector-field-settings", text: token },
      ],
    }),
  ],
};

/** Saved runs that must have played for a while, as webhooks, outbox and partitions start and rerun theirs. */
export const runTimeFixture: Tutorial = {
  ...base("fixture-run-time", () => ({
    format: "diagrams/v1",
    title: "Run time",
    nodes: [
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0, props: { ratePerSec: 4 } },
      { id: "api", stencil: "generic.service", label: "API", x: 240, y: 0 },
    ],
    edges: [{ id: "app-api", from: "app", to: "api", kind: "sync" }],
    simulations: [
      { id: "first-run", title: "First", seed: 1, scale: 1, durationMs: 600_000, traffic: [] },
      { id: "second-run", title: "Second", seed: 2, scale: 1, durationMs: 600_000, traffic: [] },
    ],
  })),
  subjects: { app: { stencils: ["client.mobile"] }, api: { stencils: ["generic.service"] } },
  steps: [
    step("run", {
      check: { kind: "simulation", id: "first-run", atLeastMs: 1500 },
      sticky: true,
      targets: [{ testId: "live-sim-picker", tip: words("Run") }],
      demo: [{ kind: "runSimulation", id: "first-run" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "first-run" }],
    }),
    step("rerun", {
      check: { kind: "simulation", id: "second-run", atLeastMs: 1000 },
      targets: [{ testId: "live-sim-picker", tip: words("Rerun") }],
      demo: [{ kind: "runSimulation", id: "second-run" }],
      solution: [{ select: "live-sim-picker", value: "second-run" }],
    }),
  ],
};

/** A client and the service it calls, seeded: the start most Live lessons below share. */
const callChain =
  (title: string, extra: Partial<DiagramFile> = {}) =>
  (): DiagramFile => ({
    format: "diagrams/v1",
    title,
    nodes: [
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0, props: { ratePerSec: 4 } },
      { id: "api", stencil: "generic.service", label: "API", x: 240, y: 0 },
      { id: "db", stencil: "postgres", label: "DB", x: 480, y: 0 },
    ],
    edges: [
      { id: "app-api", from: "app", to: "api", kind: "sync" },
      { id: "api-db", from: "api", to: "db", kind: "sync" },
    ],
    ...extra,
  });
const chainSubjects = {
  app: { stencils: ["client.mobile"] },
  api: { stencils: ["generic.service"] },
  db: { stencils: ["postgres"] },
} as const;
const goLive = step("live", {
  check: { kind: "live" },
  targets: [{ testId: "live-toggle", tip: words("Live") }],
  demo: [{ kind: "live" }],
  solution: [{ click: "live-toggle" }],
});

/** trace-slowmo's shape: slow motion from a node's menu, then its journey played to the end. */
export const slowMotionFixture: Tutorial = {
  ...base("fixture-slow-motion", callChain("Slow motion")),
  subjects: chainSubjects,
  steps: [
    goLive,
    step("watch", {
      check: { kind: "slowmo" },
      sticky: true,
      targets: [
        { testId: "context-menu-item-sim.slowmo-from", tip: words("Watch") },
        { testId: "node-{api}", tip: words("Watch") },
      ],
      demo: [{ kind: "slowmo", subject: "api" }],
      solution: [{ rightclick: "node-{api}" }, { click: "context-menu-item-sim.slowmo-from" }],
    }),
    step("finished", {
      check: { kind: "slowmo", finished: true },
      sticky: true,
      targets: [{ testId: "node-{api}", tip: words("Finished"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{api}" }],
    }),
  ],
};

/** faults' shape: take a service down, then Restore clears it. */
export const faultsFixture: Tutorial = {
  ...base("fixture-faults", callChain("Faults")),
  subjects: chainSubjects,
  steps: [
    goLive,
    step("down", {
      check: { kind: "fault", subject: "api", fault: "down" },
      sticky: true,
      targets: [{ testId: "node-{api}", tip: words("Down") }],
      demo: [{ kind: "fault", subject: "api", fault: "down" }],
      solution: [{ rightclick: "node-{api}" }],
    }),
    step("restore", {
      check: { kind: "fault", subject: "api", absent: true },
      targets: [{ testId: "node-{api}", tip: words("Restore") }],
      demo: [{ kind: "fault", subject: "api", fault: "down", restore: true }],
      solution: [{ rightclick: "node-{api}" }],
    }),
  ],
};

/**
 * saved-simulations, author-a-drill and webhooks' shapes: run a narrated simulation, continue its pausing notes, read
 * an expectation however it turned out, then author a Drill in Simulations… and run it.
 */
export const savedSimulationsFixture: Tutorial = {
  ...base(
    "fixture-saved-simulations",
    callChain("Saved simulations", {
      simulations: [
        {
          id: "story",
          title: "Story",
          seed: 3,
          durationMs: 4000,
          traffic: [],
          timeline: [
            { atMs: 0, action: { do: "note", text: "It starts", pause: true } },
            { atMs: 1500, action: { do: "note", text: "Read this", pause: true } },
          ],
          // No traffic: this fails by the end, and either outcome completes the step.
          expectations: [
            {
              id: "served",
              label: "Served",
              metric: { node: "api", field: "processed" },
              op: ">=",
              value: 1,
              when: "end",
            },
          ],
        },
      ],
    }),
  ),
  subjects: chainSubjects,
  steps: [
    step("run", {
      check: { kind: "simulation", id: "story" },
      sticky: true,
      targets: [{ testId: "live-sim-picker", tip: words("Run") }],
      demo: [{ kind: "runSimulation", id: "story" }],
      solution: [{ click: "live-toggle" }, { select: "live-sim-picker", value: "story" }],
    }),
    step("note", {
      check: {
        kind: "all",
        checks: [
          { kind: "simulation", id: "story", atLeastMs: 1500 },
          { kind: "note", waiting: false },
        ],
      },
      sticky: true,
      targets: [{ testId: "live-note-continue", tip: words("Continue"), dim: false }],
      demo: [{ kind: "continueNote", simulation: "story", atLeastMs: 1500 }],
      solution: [{ click: "live-note-continue" }, { click: "live-note-continue" }],
    }),
    step("outcome", {
      check: { kind: "expectation", simulation: "story", label: "served", outcome: "either" },
      sticky: true,
      targets: [{ testId: "node-{api}", tip: words("Outcome"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{api}" }],
    }),
    step("open", {
      check: { kind: "liveView", view: "simulations", open: true },
      targets: [{ testId: "live-edit-sims", tip: words("Open") }],
      demo: [{ kind: "openView", view: "simulations" }],
      solution: [{ click: "live-more" }, { click: "live-edit-sims" }],
    }),
    step("author", {
      check: { kind: "savedSimulation", match: { drill: "slow-dependency" } },
      targets: [{ testId: "sim-panel-add-step", tip: words("Author") }],
      demo: [
        {
          kind: "saveSimulation",
          id: "simulation",
          title: words("My drill"),
          drills: [{ preset: "slow-dependency", atMs: 1000 }],
        },
      ],
      solution: [
        { click: "sim-panel-new" },
        { select: "sim-panel-add-step", value: "slow-dependency" },
        { click: "sim-panel-save" },
      ],
    }),
    step("drill", {
      check: { kind: "simulation", saved: { drill: "slow-dependency" } },
      targets: [{ testId: "sim-panel-run", tip: words("Drill") }],
      demo: [{ kind: "runSimulation", id: "simulation" }],
      solution: [{ click: "sim-panel-run" }],
    }),
  ],
};

/** rates-and-inputs, capacity and read-a-node's shapes: Live's panels and views, a fix, a hover card, an injection. */
export const livePanelsFixture: Tutorial = {
  ...base("fixture-live-panels", () => {
    const diagram = callChain("Live panels")();
    // Real capacity analysis must offer a replica increase, including before Traffic × changes.
    diagram.nodes.find((node) => node.id === "api")!.props = { concurrency: 1, latencyMs: 500, jitter: 0 };
    return diagram;
  }),
  subjects: chainSubjects,
  steps: [
    goLive,
    step("inputs", {
      check: { kind: "liveView", view: "inputs", open: true },
      targets: [{ testId: "live-capacity", tip: words("Inputs") }],
      demo: [{ kind: "openView", view: "inputs" }],
      solution: [{ click: "live-capacity" }],
    }),
    step("traffic", {
      check: { kind: "inputs", input: "traffic", op: "=", value: 3 },
      targets: [{ testId: "capacity-traffic-mult", tip: words("Traffic") }],
      demo: [{ kind: "inputs", input: "traffic", value: 3 }],
      solution: [{ click: "capacity-traffic-mult" }, { press: "ArrowRight" }],
    }),
    step("overlay", {
      check: { kind: "liveView", view: "capacity", open: true },
      targets: [{ testId: "capacity-overlay-toggle", tip: words("Capacity") }],
      demo: [{ kind: "openView", view: "capacity" }],
      solution: [{ click: "view-button" }, { click: "capacity-overlay-toggle" }],
    }),
    step("fix", {
      check: { kind: "prop", subject: "api", prop: "replicas", op: ">=", value: 2 },
      targets: [{ testId: "bottleneck-apply", tip: words("Fix") }],
      demo: [{ kind: "applyFix" }],
      solution: [{ click: "bottleneck-apply" }],
    }),
    step("events", {
      check: { kind: "liveView", view: "events", open: true },
      targets: [{ testId: "live-events-toggle", tip: words("Events") }],
      demo: [{ kind: "openView", view: "events" }],
      solution: [{ click: "live-more" }, { click: "live-events-toggle" }],
    }),
    step("hover", {
      check: { kind: "readout", subject: "api" },
      sticky: true,
      targets: [{ testId: "node-{api}", tip: words("Hover"), dim: false }],
      demo: [],
      solution: [{ hover: "node-{api}" }],
    }),
    step("inject", {
      check: { kind: "compare", left: { sinceStep: { node: "api", metric: "processed" } }, op: ">=", right: 10 },
      sticky: true,
      targets: [{ testId: "context-menu-item-sim.inject:10", tip: words("Inject") }],
      demo: [{ kind: "inject", subject: "api", count: 10 }],
      solution: [
        { rightclick: "node-{api}" },
        { click: "context-menu-item-sim.inject" },
        { click: "context-menu-item-sim.inject:10" },
      ],
    }),
  ],
};

/**
 * A design study's shape: milestones that point only after Show me, a number the diagram says compared with another
 * (partitions against consumers), and a Live sum over the services inside one boundary (a cell).
 */
export const studyFixture: Tutorial = {
  ...base("fixture-study", () => ({
    format: "diagrams/v1",
    title: "Study",
    groups: [{ id: "cell", label: "Cell A", x: -40, y: -60, width: 900, height: 300 }],
    nodes: [
      { id: "app", stencil: "client.mobile", label: "App", x: 0, y: 0, group: "cell", props: { ratePerSec: 4 } },
      { id: "topic", stencil: "kafka.topic", label: "Pings", x: 240, y: 0, group: "cell", props: { partitions: 2 } },
      { id: "consumer", stencil: "generic.service", label: "Dispatch", x: 480, y: 0, group: "cell" },
      { id: "outside", stencil: "generic.service", label: "Elsewhere", x: 480, y: 400, props: { replicas: 4 } },
    ],
    edges: [
      { id: "app-topic", from: "app", to: "topic", kind: "async" },
      { id: "topic-consumer", from: "topic", to: "consumer", kind: "async" },
    ],
  })),
  track: "studies",
  level: 3,
  minutes: 15,
  study: true,
  subjects: {
    cell: { boundary: true },
    topic: { stencils: ["kafka.topic"] },
    consumer: { stencils: ["generic.service"] },
    other: { stencils: ["generic.service"] },
  },
  steps: [
    step("ceiling", {
      hint: words("More partitions than readers"),
      check: {
        kind: "compare",
        left: { prop: "partitions", subject: "topic" },
        op: ">=",
        right: { prop: "replicas", subject: "other" },
      },
      targets: [{ testId: "node-{topic}", tip: words("Partitions") }],
      demo: [{ kind: "patch", subject: "topic", patches: [{ op: "set", path: ["partitions"], value: 4 }] }],
      solution: [{ dblclick: "node-{topic}" }],
    }),
    step("cell", {
      hint: words("Watch the cell"),
      check: {
        kind: "compare",
        left: { sum: "processed", every: { stencils: ["generic.service"], within: "cell" } },
        op: ">=",
        right: 0,
      },
      sticky: true,
      targets: [{ testId: "live-toggle", tip: words("Live") }],
      demo: [{ kind: "live" }],
      solution: [{ click: "live-toggle" }],
    }),
  ],
};

export const tutorialFixtures: readonly Tutorial[] = [
  runTimeFixture,
  pathsFixture,
  metricsFixture,
  addNameFixture,
  liveControlsFixture,
  slowMotionFixture,
  faultsFixture,
  savedSimulationsFixture,
  livePanelsFixture,
  studyFixture,
];
