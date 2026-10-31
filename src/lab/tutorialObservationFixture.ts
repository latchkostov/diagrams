import { msg } from "../i18n";
import { observationPorts, type ProductObservations } from "../lib/observations";
import { currentObservationSource } from "../palette/observationSource";
import type { Check, Tutorial } from "../tutorials/types";

const checks = {
  dock: { kind: "dock", tab: "checks" },
  checks: { kind: "checks", status: "done", rule: "no-reader" },
  exports: { kind: "export", format: "native" },
  imports: { kind: "import", format: "native" },
  ai: { kind: "aiTurn", turn: "change" },
  collaboration: { kind: "collaboration", status: "joined" },
} satisfies Partial<Record<keyof ProductObservations, Check>>;

/** Temporary, unregistered integration lessons; the import destination/save policy remains with the normal app. */
export const tutorialObservationFixtures: readonly Tutorial[] = Object.entries(checks).map(([port, check]) => ({
  id: `lab-tutorial-port-${port}`,
  version: 1,
  track: "basics",
  level: 1,
  minutes: 1,
  chrome: "app",
  title: msg("tutorials.runtime.title"),
  summary: msg("tutorials.runtime.summary"),
  start: () => ({
    format: "diagrams/v1",
    title: "",
    nodes: [
      { id: "source", stencil: "generic.service", label: "Source", x: 0, y: 0 },
      { id: "queue", stencil: "kafka.topic", label: "Events", x: 350, y: 0 },
    ],
    edges: [{ id: "publish", from: "source", to: "queue", kind: "async" }],
  }),
  subjects: { api: { role: "processor" } },
  steps: [
    {
      id: "observe",
      title: msg("tutorials.runtime.runningTitle"),
      goal: msg("tutorials.runtime.runningGoal"),
      check,
      targets: [],
      demo: [],
      solution: [],
    },
  ],
  finish: { text: msg("tutorials.runtime.finish") },
}));

/** A bounded read-only probe survives normal Open leaving the sandbox. Fake publications are Lab/E2E only. */
if (import.meta.env.DEV || import.meta.env.VITE_E2E === "1") {
  let latest: Partial<ProductObservations> = {};
  const watch = <K extends keyof ProductObservations>(port: K) =>
    observationPorts[port].subscribe((event) => {
      latest[port] = event;
    });
  for (const port of Object.keys(observationPorts) as (keyof ProductObservations)[]) watch(port);
  window.__observationLab = {
    ready: () => currentObservationSource() !== undefined,
    latest: () => latest,
    clear: () => {
      latest = {};
    },
    publish(port, payload) {
      const source = currentObservationSource();
      if (!source) throw new Error("No Lab canvas");
      // The cast is confined to this synthetic-publication fixture, never a product or runner action.
      observationPorts[port].publish({ ...payload, ...source } as never);
    },
  };
}

declare global {
  interface Window {
    __observationLab?: {
      ready(): boolean;
      latest(): Partial<ProductObservations>;
      clear(): void;
      publish(port: keyof ProductObservations, payload: Record<string, unknown>): void;
    };
  }
}
