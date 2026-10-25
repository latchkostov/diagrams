import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { LiveController } from "../live/controller";
import { TroubleWatcher, type Trouble } from "../live/observedTrouble";
import { effectiveCallerPolicy } from "../editor/callerPolicy";
import type { EditorApi } from "../editor/types";
import { holds, resolveSubjects } from "./checks";
import { patchProps } from "./paths";
import type { Tutorial } from "./types";
import { whereTimeGoes } from "./catalog/whereTimeGoes";
import { threadsBlock } from "./catalog/threadsBlock";
import { timeoutsPools } from "./catalog/timeoutsPools";
import { autoscaling } from "./catalog/autoscaling";
import { backlogLag } from "./catalog/backlogLag";
import { scaleToZero } from "./catalog/scaleToZero";
import { tutorialEntries } from "./catalog/ids";

const initial = (tutorial: Tutorial): DiagramFile =>
  typeof tutorial.start === "function"
    ? tutorial.start()
    : (JSON.parse(readFileSync(`src/examples/${tutorial.start.example}.json`, "utf8")) as DiagramFile);

/** Real saved seeds and units, driven by simulation time rather than a browser's frame rate. */
function run(tutorial: Tutorial, id: string, test: (c: LiveController, diagram: DiagramFile) => void) {
  const diagram = initial(tutorial);
  const c = new LiveController(diagram);
  try {
    const simulation = diagram.simulations?.find((s) => s.id === id);
    expect(simulation, `${tutorial.id}: ${id}`).toBeDefined();
    c.selectSimulation(simulation!);
    c.setPlaying(true);
    test(c, diagram);
  } finally {
    c.dispose();
  }
}

const play = (c: LiveController, ms: number) => {
  for (let t = 0; t < ms; t += 10) c.advance(10);
  c.publish();
};

function met(tutorial: Tutorial, step: string, c: LiveController, diagram: DiagramFile, subject?: string) {
  const subjects = resolveSubjects(tutorial, diagram);
  return holds(
    tutorial.steps.find((s) => s.id === step)!.check,
    {
      diagram,
      live: true,
      session: c.getState(),
      processed: (id) => c.getState().snapshot.nodes[id].processed,
      readout: subject ? { kind: "node", id: subjects[subject]! } : null,
    },
    subjects,
  );
}

describe("waiting lessons against their seeded runs", () => {
  it("Billing's p95 needs the slowdown, and the waiting comparison needs a real backlog", () => {
    run(whereTimeGoes, "slow-billing-drill", (c, diagram) => {
      play(c, 2000);
      expect(met(whereTimeGoes, "read-p95", c, diagram, "billing")).toBe(false);
      play(c, 3000);
      expect(c.getState().snapshot.nodes.billing.latency!.p95).toBeGreaterThanOrEqual(1050 / 0.7);
      expect(met(whereTimeGoes, "read-p95", c, diagram)).toBe(false);
      expect(met(whereTimeGoes, "read-p95", c, diagram, "billing")).toBe(true);
      expect(met(whereTimeGoes, "waiting-vs-working", c, diagram, "billing")).toBe(false);
      play(c, 4000);
      expect(met(whereTimeGoes, "waiting-vs-working", c, diagram, "billing")).toBe(true);
    });
  });

  it("keeps the Latency breakdown as an acknowledged reading step", () => {
    const reading = whereTimeGoes.steps.at(-1)!;
    expect(reading.id).toBe("read-breakdown");
    expect(reading.check).toEqual({ kind: "acknowledge" });
    expect(reading.goal()).toContain("click Latency");
    expect(reading.solution).toEqual([
      { hover: "node-{billing}" },
      { click: "hover-section-latency" },
      { click: "tutorial-skip" },
    ]);
  });

  it("blocking holds threads, while the free-thread result excludes a fresh empty run", () => {
    run(threadsBlock, "blocking", (c, diagram) => {
      play(c, 2000);
      expect(met(threadsBlock, "threads-waiting", c, diagram)).toBe(false);
      expect(met(threadsBlock, "threads-waiting", c, diagram, "caller")).toBe(true);
      expect(c.getState().snapshot.nodes.caller.threads!.waiting).toBeGreaterThanOrEqual(1 / 0.7);
    });
    run(threadsBlock, "free-thread", (c, diagram) => {
      expect(met(threadsBlock, "no-threads-waiting", c, diagram)).toBe(false);
      play(c, 2000);
      expect(c.getState().snapshot.nodes.caller.processed).toBeGreaterThanOrEqual(400 / 0.7);
      expect(met(threadsBlock, "no-threads-waiting", c, diagram)).toBe(false);
      expect(met(threadsBlock, "no-threads-waiting", c, diagram, "caller")).toBe(true);
    });
  });

  it("rejects zero completions after the free-thread time threshold", () => {
    run(threadsBlock, "free-thread", (c, diagram) => {
      play(c, 2000);
      const session = c.getState();
      const subjects = resolveSubjects(threadsBlock, diagram);
      const caller = session.snapshot.nodes[subjects.caller!];
      expect(session.run!.time).toBeGreaterThanOrEqual(2000);
      const empty = {
        ...session,
        snapshot: {
          ...session.snapshot,
          nodes: {
            ...session.snapshot.nodes,
            [subjects.caller!]: { ...caller, processed: 0, threads: { ...caller.threads!, waiting: 0 } },
          },
        },
      };
      expect(
        holds(
          threadsBlock.steps.find((step) => step.id === "no-threads-waiting")!.check,
          {
            diagram,
            live: true,
            session: empty,
            processed: () => 0,
            readout: { kind: "node", id: subjects.caller! },
          },
          subjects,
        ),
      ).toBe(false);
    });
  });

  it("the busy-thread run grows beyond its initial fleet", () => {
    run(autoscaling, "busy-threads", (c, diagram) => {
      expect(met(autoscaling, "replicas-grow", c, diagram)).toBe(false);
      play(c, 9000);
      expect(met(autoscaling, "replicas-grow", c, diagram)).toBe(false);
      expect(met(autoscaling, "replicas-grow", c, diagram, "caller")).toBe(true);
    });
  });

  it("the timeout comparison observes failed-fast calls after the provider slows", () => {
    run(timeoutsPools, "timeout-600", (c, diagram) => {
      play(c, 5000);
      expect(c.getState().snapshot.edges.pay.calls!.timedOut).toBeGreaterThanOrEqual(1 / 0.7);
      expect(met(timeoutsPools, "run-timeout-600", c, diagram)).toBe(true);
    });
  });

  it("the inline queue backs up with at least 30% headroom for its threshold", () => {
    run(backlogLag, "tutorial-flow", (c, diagram) => {
      c.setTraffic(true);
      const watcher = new TroubleWatcher();
      let seen: Trouble[] = [];
      for (let sample = 0; sample < 160; sample++) {
        play(c, 100);
        seen = watcher.observe(c.getState().snapshot, diagram);
        if (sample === 79) expect(c.getState().snapshot.nodes.queue.backlog).toBeGreaterThanOrEqual(50 / 0.7);
      }
      // Decision 8 needs more than a test id: this queue already has a reader, so the action is Inputs.
      expect(seen.find((trouble) => trouble.kind === "lag")?.action).toEqual({ kind: "inputs" });
    });
  });

  it("call patches preserve unrelated settings and resolve to the actual Request", () => {
    const diagram = initial(timeoutsPools);
    const subjects = resolveSubjects(timeoutsPools, diagram);
    const edge = diagram.edges.find((e) => e.from === subjects.checkout && e.to === subjects.payment)!;
    expect(edge).toBeDefined();
    const original = structuredClone(edge.props);
    edge.props = { ...edge.props, caller: { replyMs: 19 } };
    for (const step of timeoutsPools.steps)
      for (const demo of step.demo)
        if (demo.kind === "patch") edge.props = { ...edge.props, ...patchProps(edge.props, demo.patches) };
    expect(edge.props).toMatchObject({ ...original, caller: { replyMs: 19, deadlineMs: 600, poolConnections: 40 } });
  });

  it("targets the Request itself when the public example has no edge label in Live", () => {
    for (const lesson of [threadsBlock, timeoutsPools]) {
      const diagram = initial(lesson);
      const subjects = resolveSubjects(lesson, diagram);
      for (const step of lesson.steps) {
        const patch = step.demo.find((demo) => demo.kind === "patch");
        const connection = patch?.kind === "patch" ? patch.edge : undefined;
        if (!connection) continue;
        const edge = diagram.edges.find((e) => e.from === subjects[connection[0]] && e.to === subjects[connection[1]])!;
        expect(edge.label).toBeUndefined();
        expect(step.targets.some((target) => target.testId.startsWith("edge-{"))).toBe(true);
        expect(JSON.stringify(step.solution)).not.toContain("edge-label-");
      }
    }
  });

  it("leaves the saved run before editing diagram caller props, then re-enters Live for the comparison", () => {
    run(threadsBlock, "blocking", (controller, diagram) => {
      const edge = diagram.edges.find((edge) => edge.id === "call")!;
      const editor: Pick<EditorApi, "getDiagram" | "getEdge" | "getNode" | "updateMeta" | "setEdgeProps"> = {
        getDiagram: () => diagram,
        getEdge: (id) => diagram.edges.find((edge) => edge.id === id),
        getNode: (id) => diagram.nodes.find((node) => node.id === id),
        updateMeta: (patch) => {
          Object.assign(diagram, patch);
        },
        setEdgeProps: (id, props) => {
          const edge = diagram.edges.find((edge) => edge.id === id)!;
          edge.props = { ...edge.props, ...props };
        },
      };
      effectiveCallerPolicy(editor, edge.id, { controller, slowmo: { active: false } })!.set({ wait: "non-blocking" });
      expect(edge.props?.caller).toBeUndefined();
      expect(diagram.simulations!.find((sim) => sim.id === "blocking")!.setup?.edges?.call.caller?.wait).toBe(
        "non-blocking",
      );
      effectiveCallerPolicy(editor, edge.id, null)!.set({ wait: "non-blocking" });
      expect(edge.props?.caller).toEqual({ wait: "non-blocking" });
    });
    for (const lesson of [threadsBlock, timeoutsPools])
      lesson.steps.forEach((step, index) => {
        if (!step.demo.some((demo) => demo.kind === "patch" && demo.edge)) return;
        expect(step.solution[0]).toEqual({ click: "live-toggle" });
        expect(lesson.steps[index + 1].check).toEqual({ kind: "all", checks: [step.check, { kind: "live" }] });
        expect(lesson.steps[index + 2].solution[0]).toHaveProperty("select", "live-sim-picker");
      });
    // The p3-w2 payment example puts Connection pool behind its own disclosure.
    expect(initial(timeoutsPools).planning?.revision).toBe("p3-w2");
    expect(timeoutsPools.steps.find((step) => step.id === "pool-40")!.solution).toContainEqual({
      click: "inspector-section-call-advanced",
    });
  });

  it("registers six lessons and releases the decided cold-start lesson", () => {
    for (const lesson of [whereTimeGoes, threadsBlock, timeoutsPools, backlogLag, autoscaling, scaleToZero]) {
      expect(lesson.version).toBe(
        [whereTimeGoes, threadsBlock, timeoutsPools, autoscaling, scaleToZero].includes(lesson) ? 2 : 1,
      );
      expect(tutorialEntries).toContainEqual({ id: lesson.id, ...(lesson.quarantined ? { quarantined: true } : {}) });
      const diagram = initial(lesson);
      for (const step of lesson.steps)
        for (const demo of step.demo)
          if (demo.kind === "runSimulation")
            expect(diagram.simulations?.find((sim) => sim.id === demo.id)?.seed).toBeGreaterThan(0);
    }
    expect(backlogLag.quarantined).toBe(true);
    expect(scaleToZero.quarantined).toBeUndefined();
    expect(JSON.stringify(scaleToZero.steps)).toContain("fleet.starting");
  });
});
