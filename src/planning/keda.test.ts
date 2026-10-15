import { createEngine } from "../sim/engine";
import { createResourceValidator } from "../model/resourceValidation";
import { resolveNodeProps } from "../sim/defaults";
import { hpaLesson, resourceLesson } from "../model/autoscaling";
import { expect, it } from "vitest";
import { kedaFixture } from "../lab/kedaFixture";
import { parseNative, serializeNative, validateDiagram } from "../interop/native";
import { makePayload, parsePayload, remapPayload } from "../editor/clipboard";
import { applyOps } from "../ai/ops";
import { kedaLesson } from "../model/autoscaling";
import { analyzeCapacity } from "../sim/capacity";
import { runChecks } from "../checks/run";
import { presentFinding } from "../checks/presentation";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ResourceEstimate } from "./ResourceDetails";
import { emptyInputs, freePlaySaveProps } from "../live/capacityModel";

it("round trips KEDA natively, through agent ops, and clipboard with remapped broker/group identities", () => {
  const d = kedaFixture();
  d.edges[0].props = { group: "worker", groupOrigin: "inferred" };
  const a = kedaLesson("kafka", { node: "uploads", group: "worker" });
  d.nodes[1].props!.autoscaling = a;
  expect(parseNative(serializeNative(d))).toMatchObject({ ok: true, diagram: d });
  const copy = parsePayload(JSON.stringify(makePayload(d, ["uploads", "worker"])));
  expect(copy).not.toBeNull();
  const mapped = remapPayload(
    copy!,
    { nodes: new Set(["uploads", "worker"]), edges: new Set(["consume"]), groups: new Set() },
    { x: 20, y: 20 },
  );
  const source = mapped.nodes.find((n) => n.stencil === "kafka.topic")!,
    worker = mapped.nodes.find((n) => n.id !== source.id)!;
  expect(worker.props!.autoscaling).toMatchObject({
    controller: { triggers: [{ source: { node: source.id, group: worker.id } }] },
  });
  expect(mapped.edges[0].props!.group).toBe(worker.id);
  expect(validateDiagram({ ...d, nodes: [...d.nodes, ...mapped.nodes], edges: [...d.edges, ...mapped.edges] }).ok).toBe(
    true,
  );
  expect(parsePayload(JSON.stringify(makePayload(d, ["worker"])))).not.toBeNull(); // External references resolve at paste commit.
  expect(
    applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: a } }], { layout: "none" }).errors,
  ).toEqual([]);
  const bad = structuredClone(a);
  bad.controller.triggers[0].source.node = "missing";
  expect(
    applyOps(d, [{ op: "update", target: "worker", props: { autoscaling: bad } }], { layout: "none" }).errors.length,
  ).toBeGreaterThan(0);
  expect(
    validateDiagram({ ...d, nodes: [{ ...d.nodes[1], props: { ...d.nodes[1].props, autoscaling: bad } }] }).ok,
  ).toBe(false);
});
it("shares the 40k polling backlog estimate between configured analysis, checks and inspector", () => {
  const d = kedaFixture(),
    a = kedaLesson("kafka", { node: "uploads", group: "renders" });
  d.nodes[1].props!.autoscaling = a;
  d.nodes.push({
    id: "source",
    stencil: "client.browser",
    label: "Traffic",
    x: 0,
    y: 0,
    props: { ratePerSec: 40000 / 30 },
  });
  d.edges.push({ id: "publish", from: "source", to: "uploads", kind: "async" });
  const plan = analyzeCapacity(d).nodes.worker.resourcePlan!;
  expect(plan.keda?.lagBeforePoll).toBe(40000);
  const finding = runChecks(d).findings.find((f) => f.resourceFinding?.kind === "keda")!;
  expect(finding.resourceFinding?.keda?.lag).toBe(40000);
  const words = presentFinding(finding).message;
  expect(words).toContain("40,000");
  expect(words).toContain("30 s");
  expect(renderToStaticMarkup(createElement(ResourceEstimate, { plan }))).toContain(words);
  const saved = freePlaySaveProps(d, { ...emptyInputs(), capacity: 2 });
  expect(saved.worker?.autoscaling).toMatchObject({
    controller: { minReplicas: 0, initialReplicas: 0, maxReplicas: 200 },
  });
});

it("opts imported Deployment HPAs into A2 without changing A1 Deployment playback", () => {
  const d = kedaFixture();
  d.nodes[1].stencil = "k8s.deployment";
  d.nodes[1].props = { resources: resourceLesson(), autoscaling: hpaLesson() };
  expect(resolveNodeProps(d, d.nodes[1]).autoscalingProblem).toBeDefined();
  d.nodes[1].props.autoscaling = { ...hpaLesson(), modelRevision: "a2" };
  expect(resolveNodeProps(d, d.nodes[1]).autoscalingProblem).toBeUndefined();
  const e = createEngine();
  e.load(d);
  expect(e.frame().nodes.worker.fleet).toBeDefined();
});
it("revalidates cached simulation bindings against a changed graph", () => {
  const d = kedaFixture(),
    validate = createResourceValidator();
  const a = d.nodes[1].props!.autoscaling;
  delete d.nodes[1].props!.autoscaling;
  d.simulations = [
    {
      id: "burst",
      title: "Burst",
      durationMs: 10000,
      traffic: [],
      setup: { props: { worker: { autoscaling: a } } },
      timeline: [],
    },
  ];
  expect(validate(d)).toBeUndefined();
  expect(validate({ ...d, nodes: d.nodes.filter((n) => n.id !== "uploads"), edges: [] })).toBeDefined();
});
