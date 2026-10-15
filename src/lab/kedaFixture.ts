import { autoscalingFixture } from "./autoscalingFixture";
import { kedaLesson } from "../model/autoscaling";
export function kedaFixture() {
  const d = autoscalingFixture();
  d.title = "KEDA Kafka worker";
  Object.assign(d.nodes[0], {
    id: "uploads",
    stencil: "kafka.topic",
    label: "Render requests",
    props: { partitions: 3 },
  });
  const a = kedaLesson("kafka", { node: "uploads", group: "renders" });
  Object.assign(a.controller, { pollingMs: 1000, cooldownMs: 3000, maxReplicas: 10 });
  a.controller.settings.syncMs = 1000;
  Object.assign(d.nodes[1].props!, {
    autoscaling: a,
    resources: {
      ...(d.nodes[1].props!.resources as object),
      startup: { delayMs: 1000, jitterFraction: 0 },
    },
  });
  d.edges = [
    { id: "consume", from: "uploads", to: "worker", kind: "async", props: { group: "renders", travelMs: 10 } },
  ];
  return d;
}
