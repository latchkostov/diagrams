// Frozen A1 runs: record every controller second, including decisions and the actual explanation copy.
import { it } from "vitest";
import { LiveController } from "../../../src/live/controller";
import { explainNode } from "../../../src/planning/explanation";
import { t } from "../../../src/i18n/core";
import { formatNumber } from "../../../src/i18n/format";
import { corpus, examples } from "../lib/corpus";
import { expectGolden } from "../lib/golden";

for (const { slug, diagram } of [
  ...corpus.filter(({ slug }) => slug.startsWith("a1-") || slug.startsWith("a2-")),
  ...examples.filter(({ slug }) => slug === "autoscaling-image-workers" || slug === "keda-render-workers"),
]) {
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
