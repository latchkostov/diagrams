import { triggerValue } from "../../sim/keda";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importHpa, importTrigger, kubernetesQuantity, workloadResources } from "./k8sScaling";
import { importKubernetes } from "./pipeline";
import { validateDiagram, serializeNative, parseNative } from "../native";
import type { AutoscalingConfig, ComputeResources } from "../../model/autoscaling";
import { formatImportMessage } from "../ui/importMessages";

const yaml = readFileSync("tests/fixtures/imports/autoscaling-a2.yaml", "utf8");
function imported(text = yaml) {
  const r = importKubernetes([{ name: "scaling.yaml", text }]);
  if (r.ok !== true) throw new Error(JSON.stringify(r));
  return r;
}
describe("Kubernetes scaling mapping", () => {
  it.each([undefined, "auto"])("resolves RabbitMQ protocol %s from HTTP(S) and AMQP(S) hosts", (protocol) => {
    for (const scheme of ["http", "https", "amqp", "amqps"]) {
      const trigger = importTrigger(
        { type: "rabbitmq", metadata: { host: `${scheme}://broker/`, ...(protocol ? { protocol } : {}) } },
        { node: "q" },
      );
      const http = scheme.startsWith("http");
      expect(trigger).toMatchObject({ protocol: http ? "http" : "amqp", excludeUnacknowledged: !http });
      expect(triggerValue(trigger, { pending: 0, outstanding: 20 })).toBe(http ? 20 : 0);
    }
  });
  it("honors explicit RabbitMQ protocols and visibility and diagnoses unresolved hosts", () => {
    expect(
      importTrigger({ type: "rabbitmq", metadata: { protocol: "http", excludeUnacknowledged: "true" } }, { node: "q" }),
    ).toMatchObject({ protocol: "http", excludeUnacknowledged: true });
    for (const metadata of [
      {},
      { protocol: "auto", hostFromEnv: "BROKER" },
      { host: "ftp://broker/" },
      { protocol: "other" },
    ]) {
      expect(() => importTrigger({ type: "rabbitmq", metadata }, { node: "q" })).toThrow(/protocol.*resolved/);
    }
  });

  it("round trips zero, quantities, timing, Kafka binding, cache, fallback, behavior and generated ownership", () => {
    const r = imported(),
      d = r.diagram,
      worker = d.nodes.find((n) => n.label === "renderer")!;
    expect(validateDiagram(JSON.parse(JSON.stringify(d)))).toMatchObject({ ok: true });
    expect(worker.props?.resources).toMatchObject({
      preset: "kubernetes-unmeasured",
      container: "renderer",
      cpuRequestMilli: 500,
      cpuLimitMilli: 1000,
      memoryRequestMiB: 256,
      memoryLimitMiB: 512,
      cpuMsPerMessage: 0,
    });
    const a = worker.props?.autoscaling as AutoscalingConfig;
    expect(a).toMatchObject({
      mode: "on",
      modelRevision: "a2",
      controller: {
        kind: "keda",
        minReplicas: 0,
        initialReplicas: 0,
        maxReplicas: 20,
        pollingMs: 30000,
        cooldownMs: 300000,
        initialCooldownMs: 60000,
        fallback: { failureThreshold: 3, replicas: 4, behavior: "currentReplicasIfHigher" },
        settings: {
          down: {
            stabilizationMs: 120000,
            selectPolicy: "Min",
            policies: [{ type: "Pods", value: 2, periodMs: 30000 }],
          },
        },
        triggers: [
          {
            type: "kafka",
            source: { node: d.nodes.find((n) => n.stencil === "kafka.topic")!.id, group: "renderers" },
            target: 10,
            activation: 5,
            allowIdleConsumers: true,
            useCachedMetrics: true,
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("kafka-auth");
  });
  it("round trips a standalone HPA YAML with Deployment resources and resource targets", () => {
    const r = imported(
      yaml.split("---")[0] +
        `
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: renderer-cpu, namespace: studio}
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: renderer}
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: {type: Utilization, averageUtilization: 70}
    - type: ContainerResource
      containerResource:
        name: memory
        container: renderer
        target: {type: AverageValue, averageValue: 128Mi}
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 120
      policies: [{type: Pods, value: 2, periodSeconds: 30}]
`,
    );
    expect(parseNative(serializeNative(r.diagram))).toMatchObject({ ok: true, diagram: r.diagram });
    const worker = r.diagram.nodes.find((n) => n.label === "renderer")!;
    expect(worker.props).toMatchObject({
      resources: { cpuRequestMilli: 500, cpuLimitMilli: 1000, memoryRequestMiB: 256, memoryLimitMiB: 512 },
      autoscaling: {
        mode: "on",
        modelRevision: "a2",
        controller: {
          kind: "hpa",
          minReplicas: 2,
          initialReplicas: 2,
          maxReplicas: 20,
          settings: {
            metrics: [
              { source: { resource: "cpu" }, target: { kind: "utilization", percentOfRequest: 70 } },
              { source: { resource: "memory", container: "renderer" }, target: { kind: "averageValue", value: 128 } },
            ],
            down: { stabilizationMs: 120000, policies: [{ type: "Pods", value: 2, periodMs: 30000 }] },
          },
        },
      },
    });
  });
  it("reports conflicting owners, exact namespace/kind/version mismatches and unknown fields", () => {
    const conflict = imported(yaml.replace(/ {2}ownerReferences:.*\n/, ""));
    expect(conflict.diagram.nodes.find((n) => n.label === "renderer")?.props?.autoscaling).toMatchObject({
      mode: "unsupported",
      reason: expect.stringContaining("Conflicting"),
    });
    for (const text of [
      yaml.replace("  pollingInterval: 30", "  pollingInterval: 0"),
      yaml.replace("  cooldownPeriod: 300", "  surprise: secret-value"),
      yaml.replace("kind: Deployment, name: renderer", "kind: StatefulSet, name: renderer"),
    ]) {
      const r = imported(text);
      expect(JSON.stringify(r)).not.toContain("secret-value");
      expect(r.report?.notes.map(formatImportMessage).join(" ") + JSON.stringify(r.report?.notDrawn)).toMatch(
        /not simulated|isntIn/,
      );
    }
    const ns = imported(yaml.replace("namespace: studio, uid:", "namespace: other, uid:"));
    expect(ns.diagram.nodes.find((n) => n.label === "renderer")?.props?.autoscaling).not.toMatchObject({
      controller: { kind: "keda" },
    });
  });
  it("maps HPA Resource and ContainerResource targets, units, defaults and authored policies", () => {
    const a = importHpa(
      {
        maxReplicas: 12,
        minReplicas: 2,
        metrics: [
          { type: "Resource", resource: { name: "cpu", target: { type: "AverageValue", averageValue: "0.25" } } },
          {
            type: "ContainerResource",
            containerResource: {
              name: "memory",
              container: "worker",
              target: { type: "AverageValue", averageValue: "128M" },
            },
          },
        ],
        behavior: {
          scaleUp: { stabilizationWindowSeconds: 5, policies: [{ type: "Percent", value: 50, periodSeconds: 30 }] },
        },
      },
      3,
      "autoscaling/v2",
    );
    expect(a).toMatchObject({
      controller: {
        minReplicas: 2,
        initialReplicas: 3,
        settings: {
          metrics: [
            { target: { value: 250 } },
            { source: { container: "worker" }, target: { value: 128e6 / 1048576 } },
          ],
          up: { stabilizationMs: 5000, policies: [{ periodMs: 30000 }] },
        },
      },
    });
    expect(importHpa({ maxReplicas: 10 }, undefined, "autoscaling/v2")).toMatchObject({
      controller: { minReplicas: 1, settings: { metrics: [{ target: { percentOfRequest: 80 } }] } },
    });
    expect(() => importHpa({ maxReplicas: 10, metrics: [{ type: "External" }] }, 1, "autoscaling/v2")).toThrow(
      /Unsupported|local binding/,
    );
  });
  it("bounds hostile arrays/quantities and diagnoses unsupported broker visibility", () => {
    expect(() => importHpa({ maxReplicas: 10, metrics: Array(17).fill({}) }, 1, "autoscaling/v2")).toThrow(/bounds/);
    expect(() => kubernetesQuantity("9".repeat(10000), "cpu")).toThrow();
    expect(() => kubernetesQuantity("1e99", "cpu")).toThrow();
    expect(() => importTrigger({ type: "aws-sqs-queue", metadata: { scaleOnDelayed: "true" } }, { node: "q" })).toThrow(
      /Delayed/,
    );
    expect(() =>
      importTrigger({ type: "rabbitmq", metadata: { mode: "QueueLength", host: "amqp://broker/" } }, { node: "q" }),
    ).toThrow(/explicit/);
    expect(
      importTrigger(
        { type: "azure-servicebus", metadata: { topicName: "jobs", subscriptionName: "workers" } },
        { node: "q", group: "workers" },
      ),
    ).toMatchObject({ target: 5, activation: 0 });
    expect(() => workloadResources({ containers: [{ resources: {} }, {}] })).toThrow(/Multi-container/);
    const r = workloadResources({
      containers: [{ name: "worker", resources: { limits: { cpu: "500m" } } }],
    }) as ComputeResources;
    expect(r.cpuRequestMilli).toBe(500);
  });
  it("reports unsupported scaling annotations and bounds conflicting-controller summaries", () => {
    const paused = imported(
      yaml.replace(
        "namespace: studio, uid:",
        'namespace: studio, annotations: {autoscaling.keda.sh/paused: "true"}, uid:',
      ),
    );
    expect(paused.diagram.nodes.find((n) => n.label === "renderer")?.props?.autoscaling).toMatchObject({
      mode: "unsupported",
      reason: "Unsupported KEDA scaling annotation fields",
    });
    const conflict = imported(
      yaml +
        `
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: {name: other, namespace: studio}
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: renderer}
  minReplicas: -999
  maxReplicas: 1e100
`,
    );
    expect(conflict.diagram.nodes.find((n) => n.label === "renderer")?.props?.autoscaling).toMatchObject({
      mode: "unsupported",
      controllers: [{ kind: "ScaledObject", minReplicas: 0, maxReplicas: 20 }, { kind: "HPA" }],
    });
    const unsupported = conflict.diagram.nodes.find((n) => n.label === "renderer")?.props?.autoscaling as Extract<
      AutoscalingConfig,
      { mode: "unsupported" }
    >;
    expect(unsupported.controllers).toEqual([
      { kind: "ScaledObject", minReplicas: 0, maxReplicas: 20 },
      { kind: "HPA" },
    ]);
    expect(validateDiagram(conflict.diagram)).toMatchObject({ ok: true });
  });
  it("keeps topology importable when container lifecycle fields exceed supported bounds", () => {
    const r = imported(
      yaml.replace("      containers:", "      terminationGracePeriodSeconds: 900\n      containers:"),
    );
    expect(validateDiagram(r.diagram)).toMatchObject({ ok: true });
    expect(r.diagram.nodes.find((n) => n.label === "renderer")?.props?.autoscaling).toMatchObject({
      mode: "unsupported",
    });
    expect(r.report?.notes.map(formatImportMessage).join(" ")).toContain("not simulated");
  });
  it("imports ScaledJob as unsupported execution and never invents a deployment HPA", () => {
    const r = imported(`apiVersion: keda.sh/v1alpha1
kind: ScaledJob
metadata: {name: batch}
spec:
  jobTargetRef:
    template:
      spec:
        containers: [{name: worker, image: example.invalid/worker:1}]
  triggers: [{type: aws-sqs-queue, metadata: {queueName: jobs}}]
`);
    expect(r.diagram.nodes.find((n) => n.label === "batch")?.props?.autoscaling).toMatchObject({
      mode: "unsupported",
      reason: "Job execution is not simulated",
    });
  });
});
