import { type AutoscalingConfig } from "../../model/autoscaling";
import { kedaLesson, resourceLesson } from "../../model/autoscalingLessons";
import { validateDiagram } from "../native";
import { mulberry32 } from "../../sim/rng";
import { formatImportMessage } from "../ui/importMessages";
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { ImportOutcome } from "../formats";
import type { ImportGraph, ImportReport } from "./graph";
import { importKubernetes, outcomeOf, replayOutcome } from "./pipeline";
import {
  defaultSelection,
  MAX_DEPENDENCY_WORK,
  MAX_DRAWN,
  PICK_OVER,
  pickGraph,
  pickGroups,
  pickedNodes,
  UNGROUPED,
} from "./pick";
import { GROWTH_FACTOR, LINEAR_LIMIT } from "../../test/complexity";

// Big imports (docs/research/imports.md § UX, "Big imports"): past PICK_OVER nodes, an import with boundaries draws
// the ones with the most flows, and the report lists every boundary to draw another set as a new diagram.

function ok(outcome: ImportOutcome): { diagram: DiagramFile; report: ImportReport } {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  if (!outcome.report) throw new Error("no report");
  return { diagram: outcome.diagram, report: outcome.report };
}

/**
 * `namespaces` namespaces of `size` Deployments each. The first `chained` namespaces call along a chain
 * (w0 → w1 → …, a request each), namespace i with `size - 1 - i` calls, so the most flows come first. Each
 * namespace has a Secret with a value, used by its first workload, for the leak check.
 */
function cluster(namespaces: number, size: number, chained = 4): string {
  const docs: string[] = [];
  for (let n = 0; n < namespaces; n++) {
    const ns = `team-${String(n).padStart(2, "0")}`;
    docs.push(
      `apiVersion: v1\nkind: Secret\nmetadata: { name: creds, namespace: ${ns} }\nstringData: { password: "pick-leak-${n}" }`,
    );
    const calls = n < chained ? size - 1 - n : 0;
    for (let w = 0; w < size; w++) {
      const env = [
        ...(w < calls ? [`{ name: NEXT_URL, value: "http://user:pick-pass-${n}@w${w + 1}:8080" }`] : []),
        ...(w === 0 ? ["{ name: DB_PASSWORD, valueFrom: { secretKeyRef: { name: creds, key: password } } }"] : []),
      ];
      docs.push(`apiVersion: apps/v1
kind: Deployment
metadata: { name: w${w}, namespace: ${ns} }
spec:
  selector: { matchLabels: { app: w${w} } }
  template:
    metadata: { labels: { app: w${w} } }
    spec:
      containers:
        - name: w${w}
          image: example/w${w}
          env: [${env.join(", ")}]
---
apiVersion: v1
kind: Service
metadata: { name: w${w}, namespace: ${ns} }
spec: { selector: { app: w${w} } }`);
    }
  }
  return docs.join("\n---\n");
}

const big = () => ok(importKubernetes([{ name: "cluster.yaml", text: cluster(40, 10) }]));

describe("big imports: the boundaries with the most flows, and a picker", () => {
  it("draws the boundaries with the most flows, within the cap, and says how much there is", () => {
    const { diagram, report } = big();
    // 40 namespaces of 10 workloads and a Secret: 440 nodes in all.
    expect(report.pick?.total).toBe(440);
    const drawn = report.pick!.groups.filter((g) => g.drawn);
    // The four chained namespaces first (9, 8, 7, 6 flows), then the rest by name while they fit in 300.
    expect(report.pick!.groups.slice(0, 4).map((g) => [g.label, g.flows])).toEqual([
      ["team-00", 9],
      ["team-01", 8],
      ["team-02", 7],
      ["team-03", 6],
    ]);
    expect(drawn.map((g) => g.label).slice(0, 4)).toEqual(["team-00", "team-01", "team-02", "team-03"]);
    expect(diagram.nodes.length).toBeLessThanOrEqual(PICK_OVER);
    expect(diagram.nodes.length).toBe(drawn.length * 11);
    expect(diagram.groups?.map((g) => g.label).sort()).toEqual(drawn.map((g) => g.label).sort());
    expect(report.nodes).toBe(diagram.nodes.length);
    expect(formatImportMessage(report.summary!)).toMatch(
      new RegExp(`^Imported “.*” from Kubernetes: ${diagram.nodes.length} of 440 nodes,`),
    );
  });

  it("draws the picked boundaries again, with the picker still there", () => {
    const { report } = big();
    const pick = report.pick!;
    const keys = pick.groups.filter((g) => ["team-05", "team-39"].includes(g.label)).map((g) => g.key);
    expect(pickedNodes(pick.graph, { keys })).toBe(22);
    const again = ok(replayOutcome(pick.graph, pick.format, keys));
    expect(again.diagram.groups?.map((g) => g.label).sort()).toEqual(["team-05", "team-39"]);
    expect(again.diagram.nodes).toHaveLength(22);
    expect(
      again.report.pick?.groups
        .filter((g) => g.drawn)
        .map((g) => g.label)
        .sort(),
    ).toEqual(["team-05", "team-39"]);
    expect(formatImportMessage(again.report.summary!)).toContain("22 of 440 nodes");
  });

  it("leaves small imports, and imports with one boundary, whole", () => {
    expect(ok(importKubernetes([{ name: "c.yaml", text: cluster(20, 10) }])).report.pick).toBeUndefined();
    const one = ok(importKubernetes([{ name: "c.yaml", text: cluster(1, 320, 0) }]));
    expect(one.report.pick).toBeUndefined();
    expect(one.diagram.nodes).toHaveLength(321);
  });

  it("brings loose nodes connected to a picked boundary, and lists the rest as one more entry", () => {
    const g: ImportGraph = {
      format: "Kubernetes",
      title: "t",
      source: "t.yaml",
      components: [
        { key: "users", label: "Users", hint: { name: "Users" }, stencil: "client.user" },
        { key: "ext", label: "Stripe", hint: { name: "Stripe" }, stencil: "generic.external-api" },
        { key: "a", label: "a", hint: { name: "a" }, group: "A" },
        { key: "b", label: "b", hint: { name: "b" }, group: "B" },
      ],
      links: [
        { from: "users", to: "a", relation: "flow", kind: "sync", evidence: { source: "spec" } },
        { from: "b", to: "ext", relation: "flow", kind: "sync", evidence: { source: "spec" } },
      ],
      groups: [
        { key: "A", label: "A" },
        { key: "B", label: "B" },
      ],
      notDrawn: [],
      unread: [],
      notes: [],
    };
    const a = pickGraph(g, { keys: ["A"] });
    expect(a.components.map((c) => c.key)).toEqual(["users", "a"]);
    expect(a.links).toHaveLength(1);
    expect(a.groups.map((x) => x.key)).toEqual(["A"]);
    expect(pickGroups(g, ["A"])).toEqual([
      { key: UNGROUPED, label: "Not in a boundary", nodes: 2, flows: 2, drawn: false },
      { key: "A", label: "A", nodes: 1, flows: 1, drawn: true },
      { key: "B", label: "B", nodes: 1, flows: 1, drawn: false },
    ]);
    // Picking what's in no boundary brings all of it.
    expect(pickGraph(g, { keys: [UNGROUPED] }).components.map((c) => c.key)).toEqual(["users", "ext"]);
  });

  /** `sizes` boundaries (members, flows inside each), plus `loose` components in none. */
  const graphOf = (sizes: [number, number][], loose = 0, links: ImportGraph["links"] = []): ImportGraph => {
    const components: ImportGraph["components"] = [];
    sizes.forEach(([n, flows], b) => {
      for (let i = 0; i < n; i++) {
        components.push({ key: `${b}/${i}`, label: `n${i}`, hint: { name: `n${i}` }, group: `g${b}` });
        if (i > 0 && i <= flows)
          links.push({ from: `${b}/${i - 1}`, to: `${b}/${i}`, relation: "flow", evidence: { source: "spec" } });
      }
    });
    for (let i = 0; i < loose; i++) components.push({ key: `l${i}`, label: `f${i}`, hint: { name: `f${i}` } });
    return {
      format: "Terraform",
      title: "huge",
      source: "plan.json",
      components,
      links,
      groups: sizes.map((_, b) => ({ key: `g${b}`, label: `module.m${b}` })),
      notDrawn: [],
      unread: [],
      notes: [],
    };
  };

  it("keeps what's in no boundary in reach: a root module of 301 resources beside two small modules", () => {
    const g = graphOf(
      [
        [1, 0],
        [1, 0],
      ],
      301,
    );
    const { diagram, report } = ok(outcomeOf("terraform", g));
    // Drawn first (the most nodes, no flows anywhere), and listed.
    expect(diagram.nodes).toHaveLength(301);
    expect(report.pick?.groups.map((x) => [x.label, x.nodes, x.drawn])).toEqual([
      ["Not in a boundary", 301, true],
      ["module.m0", 1, false],
      ["module.m1", 1, false],
    ]);
    // Everything ticked draws everything.
    expect(pickedNodes(g, { keys: report.pick!.groups.map((x) => x.key) })).toBe(303);
  });

  it("opens an import too big to draw at all with a pick, rather than refusing it", () => {
    // 60 boundaries of 100: 6,000 nodes, over the 5,000 an import draws.
    const g = graphOf(Array.from({ length: 60 }, (_, b) => [100, b % 7] as [number, number]));
    expect(g.components.length).toBeGreaterThan(MAX_DRAWN);
    // Three boundaries of 100 fit in 300; the ones with 6 flows come first.
    expect(defaultSelection(g)?.keys).toEqual(["g6", "g13", "g20"]);
    const { diagram, report } = ok(outcomeOf("terraform", g));
    expect(diagram.nodes).toHaveLength(300);
    expect(report.pick?.total).toBe(6_000);
  });

  it("opens a smaller boundary when the highest-ranked one exceeds MAX_DRAWN, loose nodes included", () => {
    // The most flows, but 6,000 nodes: skipped, not drawn, and still listed.
    const big = graphOf([
      [6_000, 9],
      [1, 0],
    ]);
    const first = ok(outcomeOf("terraform", big));
    expect(first.diagram.nodes).toHaveLength(1);
    expect(first.report.pick?.groups.map((x) => [x.label, x.drawn])).toEqual([
      ["module.m0", false],
      ["module.m1", true],
    ]);
    // 4,990 members and 20 outside services they call: 5,010 drawn, so it's skipped too.
    const links: ImportGraph["links"] = Array.from({ length: 20 }, (_, i) => ({
      from: `0/${i}`,
      to: `l${i}`,
      relation: "flow" as const,
      evidence: { source: "spec" as const },
    }));
    const pushed = ok(
      outcomeOf(
        "terraform",
        graphOf(
          [
            [4_990, 0],
            [2, 0],
          ],
          20,
          links,
        ),
      ),
    );
    expect(pushed.diagram.nodes.length).toBeLessThanOrEqual(MAX_DRAWN);
    expect(pushed.report.pick?.groups.find((x) => x.label === "module.m0")?.drawn).toBe(false);
    // Nothing fits on its own: it says so.
    expect(() =>
      outcomeOf(
        "terraform",
        graphOf([
          [5_001, 1],
          [5_001, 0],
        ]),
      ),
    ).toThrow("No boundary in it fits in 5,000 nodes, the most an import draws.");
  });

  it("Draw everything draws everything up to the cap, not an automatic subset", () => {
    // Four boundaries of 100: the import draws 300, Draw everything all 400.
    const g = graphOf(Array.from({ length: 4 }, () => [100, 1] as [number, number]));
    expect(ok(outcomeOf("terraform", g)).diagram.nodes).toHaveLength(300);
    const all = ok(replayOutcome(g));
    expect(all.diagram.nodes).toHaveLength(400);
    expect(all.report.pick).toBeUndefined();
  });

  it("Draw everything keeps the cap and the remaining boundaries in the picker", { timeout: 40_000 }, () => {
    // This exercises mapping, layout and validation of all 5,000 nodes. Like CI,
    // allow load/coverage overhead; the assertions guard the cap, not elapsed time.
    // Over the cap, it draws as much as fits, the most flows first, and the picker has the rest.
    const huge = ok(replayOutcome(graphOf(Array.from({ length: 60 }, () => [100, 1] as [number, number]))));
    expect(huge.diagram.nodes).toHaveLength(MAX_DRAWN);
    expect(huge.report.pick?.groups.filter((x) => !x.drawn)).toHaveLength(10);
  });

  it("names a picked diagram by what it draws, so it isn't taken for the first", () => {
    const g = graphOf(Array.from({ length: 5 }, () => [100, 1] as [number, number]));
    expect(ok(replayOutcome(g, "terraform", ["g1", "g3"])).diagram.title).toBe("huge (module.m1 and module.m3)");
    expect(ok(replayOutcome(g, "terraform", ["g0", "g1", "g2"])).diagram.title).toBe(
      "huge (module.m0, module.m1 and 1 more)",
    );
    expect(ok(outcomeOf("terraform", g)).diagram.title).toBe("huge");
  });

  it("never carries a Secret value or a URL's password, in the drawing, the report or the whole import it keeps", () => {
    const outcome = importKubernetes([{ name: "cluster.yaml", text: cluster(40, 10) }]);
    const { report } = ok(outcome);
    expect(report.pick).toBeDefined();
    const out = JSON.stringify(outcome);
    for (const secret of ["pick-leak-", "pick-pass-", "user:"]) expect(out, secret).not.toContain(secret);
  });
});

/** Synthetic cross-namespace dependencies; the metric route need not end on the scaler's own workload. */
function scalingGraph(workers = 1): ImportGraph {
  return {
    format: "Kubernetes",
    title: "scaling",
    source: "scaling.yaml",
    groups: [
      { key: "workers", label: "Workers" },
      { key: "brokers", label: "Brokers" },
      { key: "readers", label: "Readers" },
    ],
    components: [
      ...Array.from({ length: workers }, (_, i) => ({
        key: `worker-${i}`,
        label: `Worker ${i}`,
        hint: { name: "worker" },
        stencil: "k8s.deployment",
        group: "workers",
        props: {
          resources: { ...resourceLesson(), modelRevision: "a2" },
          autoscaling: {
            ...kedaLesson("kafka", { node: "topic", group: "readers" }),
            controller: {
              ...kedaLesson("kafka", { node: "topic", group: "readers" }).controller,
              maxReplicas: 2,
            },
          },
        },
      })),
      { key: "topic", label: "Topic", hint: { name: "topic" }, stencil: "kafka.topic", group: "brokers" },
      { key: "reader", label: "Reader", hint: { name: "reader" }, stencil: "service.go", group: "readers" },
    ],
    links: [
      { from: "topic", to: "reader", relation: "flow", props: { group: "readers" }, evidence: { source: "spec" } },
      ...Array.from({ length: workers - 1 }, (_, i) => ({
        from: `worker-${i}`,
        to: `worker-${i + 1}`,
        relation: "flow" as const,
        evidence: { source: "spec" as const },
      })),
    ],
    notes: [],
    unread: [],
    notDrawn: [],
  };
}
it.each(["automatic", "selected"])("keeps cross-namespace KEDA sources and group routes in %s imports", (mode) => {
  const graph = scalingGraph(300);
  const before = structuredClone(graph);
  const { diagram, report } = ok(outcomeOf("kubernetes", graph, mode === "selected" ? { chosen: ["workers"] } : {}));
  expect(validateDiagram(diagram).ok).toBe(true);
  expect(diagram.nodes).toHaveLength(302);
  expect(pickedNodes(graph, { keys: ["workers"] })).toBe(302);
  expect(report.pick).toBeDefined();
  expect(report.pick!.groups.filter((g) => g.drawn).map((g) => g.key)).toEqual(["workers"]);
  expect(report.notes.map(formatImportMessage).join(" ")).toContain("included automatically");
  expect(diagram.nodes[0].props?.autoscaling).toMatchObject({
    controller: { triggers: [{ source: { node: "topic", group: "readers" } }] },
  });
  expect(diagram.edges).toContainEqual(
    expect.objectContaining({ from: "topic", to: "reader", props: { group: "readers" } }),
  );
  expect(graph).toEqual(before);
});
it.each([-1, 0, 1])("deduplicates shared KEDA dependencies at picker budgets (offset %s)", (offset) => {
  for (const budget of [PICK_OVER, MAX_DRAWN]) {
    const graph = scalingGraph(budget + offset - 2);
    // A higher-ranked unrelated boundary consumes one slot when testing the ordinary budget.
    if (budget === PICK_OVER) {
      graph.groups.unshift({ key: "first", label: "First" });
      graph.components.push({ key: "first", label: "First", hint: { name: "first" }, group: "first" });
      graph.groups.push({ key: "extra", label: "Extra" });
      graph.components.push(
        ...Array.from({ length: 10 }, (_, i) => ({
          key: `extra-${i}`,
          label: "Extra",
          hint: { name: "extra" },
          group: "extra",
        })),
      );
      graph.links.push(
        ...Array.from({ length: budget + 1 }, () => ({
          from: "first",
          to: "first",
          relation: "flow" as const,
          evidence: { source: "spec" as const },
        })),
      );
    }
    expect(pickedNodes(graph, { keys: ["workers"] })).toBe(budget + offset);
    const keys = defaultSelection(graph, budget === MAX_DRAWN ? 1 : budget + 1)!.keys;
    expect(keys.includes("workers")).toBe(offset <= 0);
    expect(pickedNodes(graph, { keys })).toBeLessThanOrEqual(budget === MAX_DRAWN ? MAX_DRAWN : budget + 1);
  }
});

function setVisits(run: () => void): number {
  let visits = 0;
  const iterator = Set.prototype[Symbol.iterator];
  const spy = vi.spyOn(Set.prototype, Symbol.iterator).mockImplementation(function* (
    this: Set<unknown>,
  ): Generator<unknown, undefined, unknown> {
    for (const value of { [Symbol.iterator]: () => iterator.call(this) }) {
      visits++;
      yield value;
    }
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return visits;
}

it.each(
  (["group-cycle", "group-readers", "broker"] as const).flatMap((kind) => [
    { kind, automatic: false },
    { kind, automatic: true },
  ]),
)("bounds shared $kind dependency expansion at 8x size (automatic: $automatic)", ({ kind, automatic }) => {
  const count = (size: number, automatic: boolean) => {
    const graph = scalingGraph(size);
    // Keep the broker with one scaler: after drawing the separate readers, each other
    // workload fits alone but cannot also bring its one still-missing dependency.
    graph.components.find((component) => component.key === "topic")!.group = "worker-0";
    const workers = graph.components.slice(0, size);
    for (const worker of workers) {
      worker.group = worker.key;
      graph.groups.push({ key: worker.key, label: worker.key });
      if (kind === "broker") worker.props!.autoscaling = kedaLesson("aws-sqs-queue", { node: "topic" });
    }
    graph.links =
      kind === "broker"
        ? []
        : (kind === "group-cycle"
            ? workers
            : Array.from({ length: size }, (_, i) => {
                const reader = { key: `reader-${i}`, label: "Reader", hint: { name: "reader" }, group: "readers" };
                graph.components.push(reader);
                return reader;
              })
          ).map((worker) => ({
            from: "topic",
            to: worker.key,
            relation: "flow",
            props: { group: "readers" },
            evidence: { source: "spec" },
          }));
    let nodes = 0;
    if (automatic)
      for (let i = 0; i < size + 5; i++) {
        const key = `extra-${i}`;
        graph.groups.push({ key, label: `zz extra ${i}` });
        graph.components.push({ key, label: "Extra", hint: { name: "extra" }, group: key });
      }
    const visits = setVisits(() => {
      const keys = automatic ? defaultSelection(graph, size + 2)!.keys : workers.map((worker) => worker.key);
      nodes = pickedNodes(graph, { keys });
    });
    expect(nodes).toBeLessThanOrEqual(MAX_DRAWN);
    expect(nodes).toBeGreaterThan(0);
    return visits;
  };
  const small = count(40, automatic),
    large = count(40 * GROWTH_FACTOR, automatic);
  expect(large / small).toBeLessThan(LINEAR_LIMIT);
  expect(large).toBeLessThan(MAX_DEPENDENCY_WORK);
});

it("reuses an oversized shared closure without expanding it per boundary", () => {
  const graph = scalingGraph(MAX_DRAWN);
  graph.components.find((c) => c.key === "topic")!.group = "worker-0";
  for (const worker of graph.components.slice(0, MAX_DRAWN)) {
    worker.group = worker.key;
    graph.groups.push({ key: worker.key, label: worker.key });
    graph.links.push({
      from: "topic",
      to: worker.key,
      relation: "flow",
      props: { group: "readers" },
      evidence: { source: "spec" },
    });
  }
  let keys: readonly string[] = [];
  const visits = setVisits(() => {
    keys = defaultSelection(graph, 1)!.keys;
  });
  // The broker cannot be selected on its own before an oversized closure is attempted.
  expect(keys).toEqual(["readers"]);
  expect(visits).toBeGreaterThan(MAX_DRAWN);
  expect(visits).toBeLessThan(MAX_DEPENDENCY_WORK);
  expect(keys.some((key) => key.startsWith("worker-"))).toBe(false);
  expect(pickedNodes(graph, { keys })).toBeLessThanOrEqual(MAX_DRAWN);
});

it("does not mark an already-expanded shared closure again for accepted boundaries", () => {
  const count = (size: number) => {
    const graph = scalingGraph(size);
    for (const worker of graph.components.slice(0, size)) {
      worker.group = worker.key;
      graph.groups.push({ key: worker.key, label: worker.key });
      const source = `source-${worker.key}`;
      const policy = kedaLesson("kafka", { node: "topic", group: "readers" });
      policy.controller.triggers.push(kedaLesson("aws-sqs-queue", { node: source }).controller.triggers[0]);
      worker.props!.autoscaling = policy;
      graph.components.push({ key: source, label: "Topic", hint: { name: "topic" }, group: worker.key });
      graph.links.push({
        from: "topic",
        to: worker.key,
        relation: "flow",
        props: { group: "readers" },
        evidence: { source: "spec" },
      });
    }
    // One shared route reaches all scalers and their individual source vertices.
    graph.components[0].props!.autoscaling = kedaLesson("kafka", { node: "topic", group: "readers" });
    graph.groups.push({ key: "extra", label: "Extra" });
    graph.components.push(
      ...Array.from({ length: MAX_DRAWN + 1 }, (_, i) => ({
        key: `extra-${i}`,
        label: "Extra",
        hint: { name: "extra" },
        group: "extra",
      })),
    );
    return setVisits(() => {
      expect(defaultSelection(graph, MAX_DRAWN)?.keys).toHaveLength(size + 2);
    });
  };
  const small = count(200),
    large = count(200 * GROWTH_FACTOR);
  expect(large / small).toBeLessThan(LINEAR_LIMIT);
  expect(large).toBeLessThan(MAX_DEPENDENCY_WORK);
});

it.each([5, 6])("keeps a drawable selection at dependency work budget %s", (workBudget) => {
  const graph = scalingGraph(1);
  for (let i = 0; i < 2; i++)
    graph.links.push({ from: "worker-0", to: "worker-0", relation: "flow", evidence: { source: "spec" } });
  const selection = defaultSelection(graph, 1, workBudget);
  const picked = pickGraph(graph, selection!);
  const { diagram, report } = ok(outcomeOf("kubernetes", picked));
  expect(validateDiagram(diagram).ok).toBe(true);
  if (workBudget === 5) {
    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.nodes[0].props?.autoscaling).toMatchObject({ mode: "unsupported" });
    expect(report.notDrawn).toContainEqual({
      name: "Worker 0",
      reason: { code: "importDetail.scalingWorkExhausted", args: [] },
    });
    expect(report.notDrawn.map((row) => formatImportMessage(row.reason)).join(" ")).toContain(
      "Import a smaller selection",
    );
  } else {
    expect(selection?.unresolved).toBeUndefined();
    expect(diagram.nodes).toHaveLength(3);
    expect(diagram.nodes[0].props?.autoscaling).toMatchObject({ mode: "on" });
    expect(report.notDrawn).toEqual([]);
  }
});

it("opens a small boundary when rejected closures exhaust the work cap", () => {
  const graph = scalingGraph(25);
  graph.components = graph.components.slice(0, 25);
  graph.groups = [
    { key: "readers", label: "Readers" },
    { key: "small", label: "Small" },
  ];
  graph.links = [];
  for (let i = 0; i <= MAX_DRAWN; i++)
    graph.components.push({ key: `reader-${i}`, label: "Reader", hint: { name: "reader" }, group: "readers" });
  for (const worker of graph.components.slice(0, 25)) {
    const source = `source-${worker.key}`;
    worker.group = worker.key;
    worker.props!.autoscaling = kedaLesson("kafka", { node: source, group: "readers" });
    graph.groups.push({ key: worker.key, label: worker.key });
    graph.components.push({
      key: source,
      label: "Topic",
      hint: { name: "topic" },
      stencil: "kafka.topic",
      group: worker.key,
    });
    for (let i = 0; i <= MAX_DRAWN; i++)
      graph.links.push({
        from: source,
        to: `reader-${i}`,
        relation: "flow",
        props: { group: "readers" },
        evidence: { source: "spec" },
      });
  }
  graph.components.push({ key: "small", label: "Small", hint: { name: "small" }, group: "small" });
  const before = structuredClone(graph);
  const { diagram, report } = ok(outcomeOf("kubernetes", graph, { budget: 3 }));
  expect(diagram.nodes).toHaveLength(3);
  expect(diagram.nodes.some((n) => n.label === "Small")).toBe(true);
  expect(validateDiagram(diagram).ok).toBe(true);
  expect(report.pick!.groups.find((g) => g.key === "small")!.drawn).toBe(true);
  expect(report.pick!.groups.some((g) => !g.drawn)).toBe(true);
  expect(report.notDrawn.map((row) => formatImportMessage(row.reason)).join(" ")).toMatch(
    /dependencies were not resolved.*Import a smaller selection/,
  );
  expect(graph).toEqual(before);
  const kept = new Set(diagram.nodes.map((n) => n.label));
  const recovery = report.notDrawn.filter(
    (row) => typeof row.reason !== "string" && row.reason.code === "importDetail.scalingWorkExhausted",
  );
  expect(recovery.length).toBeGreaterThan(0);
  expect(recovery.every((row) => kept.has(formatImportMessage(row.name)))).toBe(true);
  expect(pickedNodes(report.pick!.graph, report.pick!.selection)).toBe(diagram.nodes.length);
  const recovered = ok(replayOutcome(graph, "kubernetes", ["small"]));
  expect(recovered.diagram.nodes).toHaveLength(1);
  expect(recovered.report.notDrawn).toEqual([]);
});

it("restores exhausted KEDA scaling by retrying the same fitting boundary", () => {
  const graph = scalingGraph(24);
  graph.components = graph.components.slice(0, 24);
  graph.groups = [{ key: "readers", label: "Readers" }];
  graph.links = [];
  for (let i = 0; i <= MAX_DRAWN; i++)
    graph.components.push({ key: `reader-${i}`, label: `Reader ${i}`, hint: { name: "reader" }, group: "readers" });
  for (const [i, worker] of graph.components.slice(0, 24).entries()) {
    const source = `source-${i}`;
    worker.group = worker.key;
    worker.props!.autoscaling = {
      ...kedaLesson("kafka", { node: source, group: "readers" }),
      controller: { ...kedaLesson("kafka", { node: source, group: "readers" }).controller, maxReplicas: 2 },
    };
    graph.groups.push({ key: worker.key, label: worker.key });
    graph.components.push({
      key: source,
      label: `Topic ${i}`,
      hint: { name: "topic" },
      stencil: "kafka.topic",
      group: worker.key,
    });
    for (let reader = 0; reader < (i === 23 ? 2000 : MAX_DRAWN + 1); reader++)
      graph.links.push({
        from: source,
        to: `reader-${reader}`,
        relation: "flow",
        props: { group: "readers" },
        evidence: { source: "spec" },
      });
  }
  const { diagram, report } = ok(outcomeOf("kubernetes", graph, { budget: 2 }));
  expect(diagram.nodes).toHaveLength(2);
  expect(report.pick!.selection.keys).toEqual(["worker-23"]);
  expect([...report.pick!.selection.unresolved!]).toEqual(["worker-23"]);
  expect(pickedNodes(graph, report.pick!.selection)).toBe(2);
  expect(pickedNodes(graph, { keys: report.pick!.selection.keys })).toBe(2002);
  const recovered = ok(replayOutcome(graph, "kubernetes", report.pick!.selection.keys));
  expect(recovered.diagram.nodes).toHaveLength(2002);
  expect(recovered.diagram.nodes.find((n) => n.label === "Worker 23")?.props?.autoscaling).toMatchObject({
    mode: "on",
    controller: { triggers: [{ source: { node: expect.any(String), group: "readers" } }] },
  });
  expect(recovered.diagram.edges.some((e) => e.props?.group === "readers")).toBe(true);
  expect(recovered.report.notDrawn).toEqual([]);
  expect(validateDiagram(recovered.diagram).ok).toBe(true);
});

it("retains resolved scaling when a later route exhausts dependency work", () => {
  const graph = scalingGraph(2);
  graph.components = graph.components.slice(0, 2);
  graph.groups = [{ key: "readers", label: "Readers" }];
  graph.links = [];
  for (const [i, worker] of graph.components.slice().entries()) {
    const source = `source-${i}`;
    worker.group = worker.key;
    worker.props!.autoscaling = kedaLesson("kafka", { node: source, group: "readers" });
    graph.groups.push({ key: worker.key, label: worker.key });
    graph.components.push(
      { key: source, label: `Topic ${i}`, hint: { name: "topic" }, stencil: "kafka.topic", group: worker.key },
      { key: `reader-${i}`, label: `Reader ${i}`, hint: { name: "reader" }, group: "readers" },
    );
    graph.links.push({
      from: source,
      to: `reader-${i}`,
      relation: "flow",
      props: { group: "readers" },
      evidence: { source: "spec" },
    });
    for (let loop = 0; loop < 3 - i; loop++)
      graph.links.push({ from: worker.key, to: worker.key, relation: "flow", evidence: { source: "spec" } });
  }
  const plan = defaultSelection(graph, 5, 7)!;
  const selected = pickGraph(graph, plan);
  expect(selected.components.find((n) => n.key === "worker-0")?.props?.autoscaling).toMatchObject({ mode: "on" });
  expect(selected.components.find((n) => n.key === "worker-1")?.props?.autoscaling).toMatchObject({
    mode: "unsupported",
  });
  expect(selected.links.some((l) => l.from === "source-0" && l.to === "reader-0")).toBe(true);
  expect(selected.notDrawn.map((n) => n.name)).toEqual(["Worker 1"]);
});

it("bounds total closure expansion even across distinct overlapping routes", () => {
  const graph = scalingGraph(200);
  graph.components = graph.components.slice(0, 200);
  graph.groups = [];
  graph.links = [];
  for (let i = 0; i < 800; i++) {
    graph.components.push({ key: `reader-${i}`, label: "Reader", hint: { name: "reader" }, group: "readers" });
  }
  graph.groups.push({ key: "readers", label: "Readers" });
  for (const worker of graph.components.slice(0, 200)) {
    worker.group = worker.key;
    const source = `source-${worker.key}`;
    worker.props!.autoscaling = kedaLesson("kafka", { node: source, group: "readers" });
    graph.groups.push({ key: worker.key, label: worker.key });
    graph.components.push({ key: source, label: "Topic", hint: { name: "topic" }, group: worker.key });
    for (let i = 0; i < 800; i++)
      graph.links.push({
        from: source,
        to: `reader-${i}`,
        relation: "flow",
        props: { group: "readers" },
        evidence: { source: "spec" },
      });
  }
  graph.groups.push({ key: "extra", label: "Extra" });
  graph.components.push(
    ...Array.from({ length: 4000 }, (_, i) => ({
      key: `extra-${i}`,
      label: "Extra",
      hint: { name: "extra" },
      group: "extra",
    })),
  );
  // Exclude the linear share-index pass; the cap applies to closure work after indexing.
  const indexing = setVisits(() => {
    pickGroups(graph, []);
  });
  let keys: readonly string[] = [];
  const visits = setVisits(() => {
    keys = defaultSelection(graph, MAX_DRAWN - 1)!.keys;
  });
  expect(keys).toBeDefined();
  expect(visits - indexing).toBeLessThan(MAX_DEPENDENCY_WORK + graph.components.length * 4);
  expect(pickedNodes(graph, { keys })).toBeLessThanOrEqual(MAX_DRAWN);
});
it.each(["source", "route"])(
  "reports an omitted KEDA %s without refusing the import or retaining an orphan policy",
  (omitted) => {
    const graph = scalingGraph();
    if (omitted === "source") graph.components = graph.components.filter((c) => c.key !== "topic");
    else graph.links = [];
    const { diagram, report } = ok(replayOutcome(graph, "kubernetes", ["workers"]));
    expect(diagram.nodes[0].props?.autoscaling).toMatchObject({
      mode: "unsupported",
      reason: expect.stringContaining("binding omitted"),
    });
    expect(report.notDrawn.map((row) => formatImportMessage(row.reason)).join(" ")).toMatch(
      /Scaling was not imported.*broker.*import again/,
    );
    expect(validateDiagram(diagram).ok).toBe(true);
  },
);
it("randomized namespace selections never orphan a scaler source (200 seeds)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const random = mulberry32(seed),
      graph = scalingGraph(3);
    const groups = graph.groups.map((g) => g.key);
    const [type, stencil, named] = (
      [
        ["kafka", "kafka.topic", true],
        ["azure-servicebus", "azure.service-bus.topic", true],
        ["azure-servicebus", "azure.service-bus.queue", false],
        ["aws-sqs-queue", "aws.sqs", false],
        ["rabbitmq", "rabbitmq.queue", false],
      ] as const
    )[Math.floor(random() * 5)];
    graph.components.find((c) => c.key === "topic")!.stencil = stencil;
    const scaler = graph.components[0];
    const policy = kedaLesson(type, { node: "topic", ...(named ? { group: "readers" } : {}) });
    policy.controller.maxReplicas = 2;
    scaler.props!.autoscaling = policy;
    for (const component of graph.components) component.group = groups[Math.floor(random() * groups.length)];
    const keys = groups.filter(() => random() < 0.5);
    if (!keys.length) keys.push(groups[0]);
    const selected = pickGraph(graph, { keys });
    const ids = new Set(selected.components.map((c) => c.key));
    for (const component of selected.components) {
      const a = component.props?.autoscaling as AutoscalingConfig | undefined;
      if (a?.mode !== "on" || a.controller.kind !== "keda") continue;
      for (const trigger of a.controller.triggers) {
        expect(ids.has(trigger.source.node), `seed ${seed}`).toBe(true);
        if (trigger.source.group)
          expect(
            selected.links.some((l) => l.from === trigger.source.node && l.props?.group === trigger.source.group),
            `seed ${seed}`,
          ).toBe(true);
      }
    }
    if (selected.components.length)
      expect(ok(replayOutcome(graph, "kubernetes", keys)).diagram.nodes).toHaveLength(selected.components.length);
  }
});
