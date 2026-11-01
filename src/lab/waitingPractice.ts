import { t } from "../i18n";
import scalingText from "../examples/autoscaling-basics.json?raw";
import retriesText from "../examples/retry-storm.json?raw";
import invoicesText from "../examples/azure-service-bus-integration.json?raw";
import type { DiagramFile } from "../model/types";

// Practice snapshots are separate modules from the gallery’s lazy, retryable downloads.
const scaling = JSON.parse(scalingText) as DiagramFile;
const retries = JSON.parse(retriesText) as DiagramFile;
const invoices = JSON.parse(invoicesText) as DiagramFile;

/** Public KEDA story, narrowed to its broker and workers; the executable policy and seed stay intact. */
export function backlogScalingPractice(): DiagramFile {
  const d = structuredClone(scaling) as DiagramFile;
  const ids = new Set(["poster-studio", "render-requests", "render-workers"]);
  d.title = t("tutorials.scaleOnBacklog.title");
  d.nodes = d.nodes.filter((n) => ids.has(n.id));
  d.edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  d.annotations = [];
  d.simulations = d.simulations!.filter((s) => s.id === "wake-on-burst");
  const run = d.simulations[0];
  run.timeline = [
    {
      atMs: 2500,
      action: { do: "note", text: t("tutorials.scaleOnBacklog.startNote"), focus: ["render-workers"], pause: true },
    },
    {
      atMs: 4000,
      action: {
        do: "note",
        text: t("tutorials.scaleOnBacklog.ceilingNote"),
        focus: ["render-requests", "render-workers"],
        pause: true,
      },
    },
  ];
  return d;
}

/** Freeze actual seeded breaker states for reading, without changing the controller or load. */
export function breakerPractice(): DiagramFile {
  const d = structuredClone(retries) as DiagramFile;
  const run = d.simulations!.find((s) => s.id === "circuit-breaker")!;
  run.timeline!.push(
    {
      atMs: 9000,
      action: {
        do: "note",
        text: t("tutorials.circuitBreaker.openNoteV2"),
        focus: ["checkout", "payments"],
        pause: true,
      },
    },
    {
      atMs: 10500,
      action: {
        do: "note",
        text: t("tutorials.circuitBreaker.testingNoteV2"),
        focus: ["checkout", "payments"],
        pause: true,
      },
    },
  );
  return d;
}

/** Keep the public poison story, but describe investigation rather than an unavailable replay command. */
export function deadLetterPractice(): DiagramFile {
  const d = structuredClone(invoices) as DiagramFile;
  const run = d.simulations!.find((s) => s.id === "poison")!;
  for (const step of run.timeline ?? []) {
    if (step.action.do === "note")
      step.action.text =
        step.atMs === 0 ? t("tutorials.deadLetters.poisonNoteV3") : t("tutorials.deadLetters.investigateNoteV3");
  }
  return d;
}
