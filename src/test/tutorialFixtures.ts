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

export const tutorialFixtures: readonly Tutorial[] = [
  runTimeFixture,
  pathsFixture,
  metricsFixture,
  addNameFixture,
  liveControlsFixture,
];
