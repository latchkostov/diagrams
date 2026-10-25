import { expect, it } from "vitest";
import { waitingFixture } from "../lab/waitingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import { realSnapshot } from "./units";
import { createEngine } from "./engine";
import { assertLedgerInvariants, assertOutcomeInvariants, type LedgerInvariantState } from "./resourceInvariants";

it("a 504 returned by a child's continuation retains the parent's reply-phase turnaround", () => {
  const diagram = waitingFixture();
  diagram.nodes[1].props!.concurrency = 1;
  diagram.nodes.push({ ...diagram.nodes[1], id: "child", props: { concurrency: 100, latencyMs: 10, jitter: 0 } });
  diagram.edges[1].to = "child";
  diagram.edges.push({
    id: "child-call",
    from: "child",
    to: "partner",
    kind: "sync",
    props: { caller: { wait: "non-blocking", deadlineMs: 100, replyMs: 40 } },
  });
  const counts = [1, 10].map((scale) => {
    const engine = createEngine({ scale, maxParticles: 0 });
    engine.load(diagram);
    engine.inject("source", 1000 / scale);
    engine.step(30_000);
    return realSnapshot(engine.snapshot()).nodes.caller.failed;
  });
  expect(Math.abs(counts[1] - counts[0]), JSON.stringify(counts)).toBeLessThanOrEqual(10);
});

it("a sampled callee's CPU tail cannot turn its first-wave reply into a timeout", () => {
  const diagram = waitingFixture();
  diagram.nodes[1].props!.concurrency = 1;
  diagram.nodes[2].stencil = "generic.service";
  diagram.nodes[2].props = {
    replicas: 1,
    concurrency: 1,
    latencyMs: 0,
    jitter: 0,
    resources: { ...resourceLesson(), cpuMsPerMessage: 100, startup: { delayMs: 0, jitterFraction: 0 } },
  };
  diagram.edges[1].props = { caller: { deadlineMs: 600 } };
  const engine = createEngine({ scale: 10, verifyOutcomes: assertOutcomeInvariants });
  engine.load(diagram);
  engine.inject("source", 1);
  engine.step(500);
  expect(engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
  expect(engine.snapshot().edges.call.calls!.timedOut).toBe(0);
  engine.setNodeStatus("partner", "down");
  engine.step(2000);
  expect(engine.snapshot().nodes.caller).toMatchObject({ processed: 1, failed: 0 });
  expect(engine.snapshot().edges.call.calls!.timedOut).toBe(0);
});

it.each([1, 3, 10])(
  "deadline settles at its exact logical expiry and stays failed after a paused late reply (scale=%s)",
  (scale) => {
    const diagram = waitingFixture();
    diagram.nodes[1].props!.concurrency = 1;
    diagram.edges[1].props = { caller: { deadlineMs: 103, wait: "non-blocking", poolConnections: 1 } };
    let state!: LedgerInvariantState;
    const outcomes: { ok: boolean; at: number }[] = [];
    const engine = createEngine({
      scale,
      verifyLedger(s) {
        state = s;
        assertLedgerInvariants(s);
      },
      verifyOutcomes(s) {
        assertOutcomeInvariants(s);
        for (const attempt of s.attempts)
          if (attempt.node === "caller" && attempt.outcome) outcomes.push({ ...attempt.outcome });
      },
    });
    engine.load(diagram);
    engine.inject("source", 1);
    engine.step(30);
    const branch = state.logical.find((event) => "timeout" in event)!;
    expect(branch).toBeDefined();
    const expiresAt = branch.end;
    engine.setNodeStatus("caller", "paused");
    engine.step(1000);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((outcome) => !outcome.ok && outcome.at === expiresAt)).toBe(true);
    expect(engine.snapshot().nodes.caller.failed).toBe(0);
    expect(engine.snapshot().edges.call.calls).toMatchObject({ timedOut: 1, late: 1 });
    const pool = [...state.ledger.reservations.values()].find((reservation) => reservation.scope === "pool");
    // The deadline cancels undispatched members and ends every dispatched pool lease now.
    expect(pool).toBeUndefined();
    expect(engine.snapshot().edges.call.calls!.inFlight).toBe(0);
    engine.setScale(1);
    engine.setNodeStatus("caller", "up");
    engine.step(2000);
    expect(engine.snapshot().nodes.caller).toMatchObject({ processed: 0, failed: 1 });
    expect(state.ledger.reservations.size).toBe(0);
    expect(state.logical).toHaveLength(0);
  },
);

it.each(["blocking", "non-blocking"] as const)(
  "I7: %s deadline outcomes do not depend on retained ledger holds",
  (wait) => {
    const traces = ([undefined, "none"] as const).map((ledgerHold) => {
      const diagram = waitingFixture();
      diagram.nodes[1].props!.concurrency = 1;
      diagram.edges[1].props = { caller: { wait, deadlineMs: 100, poolConnections: 1, replyMs: 40 } };
      const outcomes: unknown[] = [];
      const engine = createEngine({
        scale: 10,
        ledgerHold,
        verifyOutcomes(s) {
          assertOutcomeInvariants(s);
          for (const attempt of s.attempts)
            if (attempt.outcome) outcomes.push([attempt.id, attempt.node, { ...attempt.outcome }, attempt.committed]);
        },
      });
      engine.load(diagram);
      for (let i = 0; i < 3; i++) {
        engine.inject("source", 1);
        engine.step(10_000);
      }
      expect(engine.snapshot().nodes.caller).toMatchObject({ processed: 0, failed: 3 });
      expect(engine.snapshot().edges.call.calls).toMatchObject({ timedOut: 3, late: 3 });
      return outcomes;
    });
    expect(traces[0]).toEqual(traces[1]);
  },
);
