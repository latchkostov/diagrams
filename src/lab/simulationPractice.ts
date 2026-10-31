import { t } from "../i18n";
import type { DiagramFile, Simulation } from "../model/types";

/** Small invented experiments, also available in the Lab. */
export function experimentPractice(): DiagramFile {
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-a1" },
    title: t("tutorials.authorASimulation.title"),
    nodes: [
      {
        id: "client",
        stencil: "client.mobile",
        label: t("tutorials.authorASimulation.client"),
        x: 0,
        y: 0,
        props: { ratePerSec: 0, messageType: "Job" },
      },
      { id: "queue", stencil: "generic.queue", label: t("tutorials.authorASimulation.queue"), x: 280, y: 0 },
      {
        id: "worker",
        stencil: "service.python",
        label: t("tutorials.authorASimulation.worker"),
        x: 560,
        y: 0,
        props: { latencyMs: 100, jitter: 0, concurrency: 8 },
      },
    ],
    edges: [
      { id: "enqueue", from: "client", to: "queue", kind: "async", props: { travelMs: 10 } },
      { id: "deliver", from: "queue", to: "worker", kind: "async", props: { travelMs: 10 } },
    ],
  };
}
export function experimentDefinition(note = false, expectation = false): Simulation {
  return {
    id: "simulation",
    title: t("tutorials.authorASimulation.runName"),
    seed: 7,
    scale: 1,
    durationMs: 4000,
    traffic: [
      {
        id: "traffic",
        node: "client",
        messageType: "Job",
        shape: { kind: "burst", count: 10, atMs: 0, spreadMs: 1000 },
      },
    ],
    timeline: note
      ? [
          {
            atMs: 500,
            action: { do: "note", text: t("tutorials.authorASimulation.noteText"), focus: ["worker"], pause: true },
          },
        ]
      : [],
    expectations: expectation
      ? [
          {
            id: "check",
            label: t("tutorials.authorASimulation.expectationText"),
            metric: { node: "worker", field: "processed" },
            op: ">=",
            value: 10,
            when: "end",
          },
        ]
      : [],
  };
}
export function resourcePractice(): DiagramFile {
  const d = experimentPractice();
  d.title = t("tutorials.resourceHeadroom.title");
  d.nodes[2].label = t("tutorials.resourceHeadroom.worker");
  d.nodes[2].props = {
    ...d.nodes[2].props,
    replicas: 1,
    resources: {
      preset: "custom",
      presetRevision: "1",
      cpuRequestMilli: 1000,
      cpuLimitMilli: 1000,
      cpuMsPerMessage: 200,
      baselineMemoryMiB: 64,
      memoryMiBPerMessage: 1,
      memoryRequestMiB: 128,
      memoryLimitMiB: 256,
      startup: { delayMs: 0, jitterFraction: 0 },
      terminationGraceMs: 0,
    },
  };
  d.simulations = [
    {
      id: "image-burst",
      title: t("tutorials.resourceHeadroom.runName"),
      seed: 7,
      scale: 1,
      durationMs: 6000,
      traffic: [{ id: "images", node: "client", shape: { kind: "burst", count: 20, spreadMs: 1000 } }],
    },
  ];
  return d;
}
