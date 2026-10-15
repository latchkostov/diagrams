import { kedaLesson, resourceLesson, type AutoscalingConfig } from "../../model/autoscaling";
import { validateDiagram } from "../native";
import { mulberry32 } from "../../sim/rng";
import { formatImportMessage } from "../ui/importMessages";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { ImportOutcome } from "../formats";
import type { ImportGraph, ImportReport } from "./graph";
import { importKubernetes, outcomeOf, replayOutcome } from "./pipeline";
import { defaultPick, MAX_DRAWN, PICK_OVER, pickGraph, pickGroups, pickedNodes, UNGROUPED } from "./pick";

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
    expect(pickedNodes(pick.graph, keys)).toBe(22);
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
    const a = pickGraph(g, ["A"]);
    expect(a.components.map((c) => c.key)).toEqual(["users", "a"]);
    expect(a.links).toHaveLength(1);
    expect(a.groups.map((x) => x.key)).toEqual(["A"]);
    expect(pickGroups(g, ["A"])).toEqual([
      { key: UNGROUPED, label: "Not in a boundary", nodes: 2, flows: 2, drawn: false },
      { key: "A", label: "A", nodes: 1, flows: 1, drawn: true },
      { key: "B", label: "B", nodes: 1, flows: 1, drawn: false },
    ]);
    // Picking what's in no boundary brings all of it.
    expect(pickGraph(g, [UNGROUPED]).components.map((c) => c.key)).toEqual(["users", "ext"]);
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
    expect(
      pickedNodes(
        g,
        report.pick!.groups.map((x) => x.key),
      ),
    ).toBe(303);
  });

  it("opens an import too big to draw at all with a pick, rather than refusing it", () => {
    // 60 boundaries of 100: 6,000 nodes, over the 5,000 an import draws.
    const g = graphOf(Array.from({ length: 60 }, (_, b) => [100, b % 7] as [number, number]));
    expect(g.components.length).toBeGreaterThan(MAX_DRAWN);
    // Three boundaries of 100 fit in 300; the ones with 6 flows come first.
    expect(defaultPick(g)).toEqual(["g6", "g13", "g20"]);
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
          autoscaling:
            i === 0
              ? {
                  ...kedaLesson("kafka", { node: "topic", group: "readers" }),
                  controller: {
                    ...kedaLesson("kafka", { node: "topic", group: "readers" }).controller,
                    maxReplicas: 2,
                  },
                }
              : { mode: "off" },
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
  expect(pickedNodes(graph, ["workers"])).toBe(302);
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
it("counts shared scaling dependencies once, including at the drawing cap", () => {
  const graph = scalingGraph(MAX_DRAWN - 1);
  expect(defaultPick(graph, 1)).not.toContain("workers");
  expect(pickedNodes(graph, ["workers"])).toBe(MAX_DRAWN + 1);
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
    const selected = pickGraph(graph, keys);
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
