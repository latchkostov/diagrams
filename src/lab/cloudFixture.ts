import { autoscalingFixture } from "./autoscalingFixture";
import { cloudLesson, resourceLesson, type CloudPreset } from "../model/autoscalingLessons";
import type { DiagramFile } from "../model/types";

const WORKER_STENCIL: Record<CloudPreset, string> = {
  "ecs-cpu": "aws.ecs",
  "ecs-alb": "aws.ecs",
  "ecs-step": "aws.ecs",
  "aca-http": "azure.container-apps",
  "aca-event": "azure.container-apps",
  "app-service": "azure.app-service",
  "cloud-run": "gcp.cloud-run",
};
/**
 * One synthetic service per A3 platform, with the platform's preset and the shared I/O workload lesson. ALB metrics
 * get a load balancer in front; Container Apps events read a Service Bus queue. Timings are the published preset's:
 * tests shorten them explicitly.
 */
export function cloudFixture(preset: CloudPreset): DiagramFile {
  const d = autoscalingFixture();
  d.title = `Cloud ${preset}`;
  d.nodes[0].props = { ratePerSec: 0 };
  const worker = d.nodes[1];
  worker.stencil = WORKER_STENCIL[preset];
  worker.label = "API";
  worker.props = {
    replicas: 1,
    concurrency: preset === "cloud-run" ? 80 : 4,
    latencyMs: 250,
    jitter: 0,
    resources: { ...resourceLesson(), modelRevision: "a2" },
    autoscaling: cloudLesson(preset, {
      source: "lb",
      binding: { node: "queue" },
    }),
  };
  if (preset === "ecs-alb") {
    d.nodes.splice(1, 0, { id: "lb", stencil: "aws.elb", label: "ALB", x: 260, y: 180, props: {} });
    d.edges = [
      { id: "to-lb", from: "source", to: "lb", kind: "sync", props: { travelMs: 10 } },
      { id: "requests", from: "lb", to: "worker", kind: "sync", props: { travelMs: 10 } },
    ];
  }
  if (preset === "aca-event") {
    Object.assign(d.nodes[0], { id: "queue", stencil: "azure.service-bus.queue", label: "Jobs", props: {} });
    d.edges = [{ id: "consume", from: "queue", to: "worker", kind: "async", props: { travelMs: 10 } }];
  }
  return d;
}
