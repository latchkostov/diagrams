// Frozen A1 runs: record every controller second, including decisions and the actual explanation copy.
import { it } from "vitest";
import { LiveController } from "../../../src/live/controller";
import { explainNode } from "../../../src/planning/explanation";
import { t } from "../../../src/i18n/core";
import { formatNumber } from "../../../src/i18n/format";
import { corpus, examples } from "../lib/corpus";
import { expectGolden } from "../lib/golden";
import { planScaling } from "../../../src/sim/scalingPlanner";
import { planMessage } from "../../../src/checks/scalingFindings";
import { metricPhrase, planDescriptor, planSentence, reasonText } from "../../../src/planning/scalingPlanText";

// The retired standalone showcases live on as frozen corpus inputs (a1-image-workers, a2-render-workers).
for (const { slug, diagram } of corpus.filter(({ slug }) => slug.startsWith("a1-") || slug.startsWith("a2-"))) {
  for (const simulation of diagram.simulations ?? []) {
    it(`${slug}: ${simulation.id} replica history and explanations`, () => {
      const controller = new LiveController(diagram);
      controller.selectSimulation(simulation);
      controller.setPlaying(true);
      const points: unknown[] = [];
      try {
        for (;;) {
          const snapshot = controller.snapshot();
          const worker = snapshot.nodes.worker;
          const fleet = worker.fleet;
          if (!fleet) throw new Error("A1 parity input has no resource-enabled fleet");
          const decision = fleet.decision;
          points.push({
            atMs: snapshot.time,
            desired: fleet.desired,
            ready: fleet.ready,
            starting: fleet.starting,
            draining: fleet.draining,
            active: worker.activeReplicas,
            idle: worker.idleReplicas,
            lag: snapshot.nodes.uploads.lag,
            backlog: worker.backlog,
            processed: worker.processed,
            decision,
            explanation: decision && {
              why: t("autoscaling.why", {
                raw: decision.raw,
                desired: decision.desired,
                next: formatNumber(decision.nextAt / 1000),
              }),
              reason: ["activation", "inactive", "cooldown", "partitions", "fallback"].includes(decision.reason)
                ? t("autoscaling.kedaReason", { reason: decision.reason })
                : t("autoscaling.reason", { reason: decision.reason }),
            },
          });
          if (controller.getState().run?.done) break;
          if (snapshot.time >= 600_000) throw new Error("A1 parity run failed to finish");
          for (let i = 0; i < 100; i++) controller.advance(10);
          controller.publish();
        }
        const planning = explainNode(diagram, "worker", { sim: simulation });
        const plan = planning?.resources;
        expectGolden(`autoscaling/${slug}/${simulation.id}.json`, {
          planning,
          configuredExplanation:
            plan?.targetReplicas !== undefined && plan.max !== undefined
              ? t("autoscaling.needed", { count: plan.targetReplicas, max: plan.max })
              : null,
          points,
        });
      } finally {
        controller.dispose();
      }
    });
  }
}

// A3 cloud adapters: every controller second of each frozen per-adapter diagram (and the Cloud Run showcase), with
// the adapter's own reason/metric words, then the scenario planner's suggestions in the words Checks, agents and
// live playback all show.
const a3 = [
  ...corpus.filter(({ slug }) => slug.startsWith("a3-")),
  ...examples.filter(({ slug }) => slug === "cloud-run-timetable-api"),
];
for (const { slug, diagram } of a3) {
  for (const simulation of diagram.simulations ?? []) {
    it(`${slug}: ${simulation.id} A3 replica history and decisions`, () => {
      const controller = new LiveController(diagram);
      controller.selectSimulation(simulation);
      controller.setPlaying(true);
      const points: unknown[] = [];
      try {
        for (;;) {
          const state = controller.getState();
          if (state.run?.waiting) controller.resume();
          const snapshot = controller.snapshot();
          const worker = snapshot.nodes.worker;
          const fleet = worker.fleet;
          if (!fleet) throw new Error("A3 parity input has no resource-enabled fleet");
          const decision = fleet.decision;
          points.push({
            atMs: snapshot.time,
            desired: fleet.desired,
            ready: fleet.ready,
            starting: fleet.starting,
            draining: fleet.draining,
            backlog: worker.backlog,
            processed: worker.processed,
            rejected: worker.rejected,
            decision,
            reason: decision && reasonText(decision),
            metric:
              decision?.adapter && decision.metricKind
                ? metricPhrase(decision.metricKind, decision.metric, decision.target)
                : undefined,
          });
          if (controller.getState().run?.done) break;
          if (snapshot.time >= 600_000) throw new Error("A3 parity run failed to finish");
          for (let i = 0; i < 100; i++) controller.advance(10);
          controller.publish();
        }
        expectGolden(`autoscaling/${slug}/${simulation.id}.json`, { points });
      } finally {
        controller.dispose();
      }
    });
  }
  it(`${slug}: scenario sizing`, () => {
    const names = (id: string) => diagram.nodes.find((n) => n.id === id)?.label ?? id;
    const plans = planScaling(diagram);
    expectGolden(`autoscaling/${slug}/plan.json`, {
      plans,
      english: plans.flatMap((p) => p.suggestions.map((s) => planMessage(p, s, names))),
      shown: plans.flatMap((p) => p.suggestions.map((s) => planSentence(planDescriptor(p, s, names)))),
    });
  });
}
