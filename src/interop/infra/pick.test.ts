import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import type { ImportOutcome } from "../formats";
import type { ImportGraph, ImportReport } from "./graph";
import { importKubernetes, replayOutcome } from "./pipeline";
import { defaultPick, MAX_DRAWN, PICK_OVER, pickGraph, pickGroups, pickedNodes } from "./pick";

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
    expect(report.summary).toMatch(new RegExp(`^Imported “.*” from Kubernetes: ${diagram.nodes.length} of 440 nodes,`));
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
    expect(again.report.summary).toContain("22 of 440 nodes");
  });

  it("leaves small imports, and imports with one boundary, whole", () => {
    expect(ok(importKubernetes([{ name: "c.yaml", text: cluster(20, 10) }])).report.pick).toBeUndefined();
    const one = ok(importKubernetes([{ name: "c.yaml", text: cluster(1, 320, 0) }]));
    expect(one.report.pick).toBeUndefined();
    expect(one.diagram.nodes).toHaveLength(321);
  });

  it("brings loose nodes connected to a picked boundary, and drops the ones connected to nothing drawn", () => {
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
      { key: "A", label: "A", nodes: 1, flows: 1, drawn: true },
      { key: "B", label: "B", nodes: 1, flows: 1, drawn: false },
    ]);
  });

  it("opens an import too big to draw at all with a pick, rather than refusing it", () => {
    // 60 boundaries of 100: 6,000 nodes, over the 5,000 an import draws.
    const components: ImportGraph["components"] = [];
    const links: ImportGraph["links"] = [];
    for (let b = 0; b < 60; b++)
      for (let i = 0; i < 100; i++) {
        components.push({ key: `${b}/${i}`, label: `n${i}`, hint: { name: `n${i}` }, group: `g${b}` });
        if (i > 0 && i <= b % 7)
          links.push({ from: `${b}/${i - 1}`, to: `${b}/${i}`, relation: "flow", evidence: { source: "spec" } });
      }
    const g: ImportGraph = {
      format: "Terraform",
      title: "huge",
      source: "plan.json",
      components,
      links,
      groups: Array.from({ length: 60 }, (_, b) => ({ key: `g${b}`, label: `module.m${b}` })),
      notDrawn: [],
      unread: [],
      notes: [],
    };
    expect(components.length).toBeGreaterThan(MAX_DRAWN);
    const keys = defaultPick(g)!;
    // Three boundaries of 100 fit in 300; the ones with 6 flows come first.
    expect(keys).toEqual(["g6", "g13", "g20"]);
    const { diagram, report } = ok(replayOutcome(g, "terraform"));
    expect(diagram.nodes).toHaveLength(300);
    expect(report.pick?.total).toBe(6_000);
  });

  it("never carries a Secret value or a URL's password, in the drawing, the report or the whole import it keeps", () => {
    const outcome = importKubernetes([{ name: "cluster.yaml", text: cluster(40, 10) }]);
    const { report } = ok(outcome);
    expect(report.pick).toBeDefined();
    const out = JSON.stringify(outcome);
    for (const secret of ["pick-leak-", "pick-pass-", "user:"]) expect(out, secret).not.toContain(secret);
  });
});
