/* eslint-disable local/no-literal-ui-text -- Titles and labels in these fixtures are test input, not UI copy. */
import { describe, expect, it, vi } from "vitest";
import type { DiagramFile, Simulation } from "../model/types";
import { createRepairs, repairedRun, type RepairPorts } from "./repair";

const diagram = (): DiagramFile => ({
  format: "diagrams/v2",
  title: "Repair",
  planning: { revision: "p3-w2" },
  nodes: [
    { id: "api", stencil: "generic.service", label: "API", x: 0, y: 0, props: { replicas: 2, latencyMs: 10 } },
    { id: "psp", stencil: "generic.external-api", label: "PSP", x: 300, y: 0 },
  ],
  edges: [
    {
      id: "call",
      from: "api",
      to: "psp",
      kind: "sync",
      props: { caller: { retry: { maxAttempts: 2, backoffMs: 100, idempotent: false } } },
    },
  ],
  simulations: [{ id: "run", title: "Run", traffic: [] }],
});

describe("repairedRun", () => {
  it("merges a node repair into the run's saved Inputs, keeping its other props", () => {
    const d = diagram();
    const sim: Simulation = { ...d.simulations![0], setup: { props: { api: { replicas: 1, concurrency: 7 } } } };
    const next = repairedRun(d, sim, { node: "api" }, [{ op: "set", path: ["replicas"], value: 4 }]);
    expect(next.setup!.props).toEqual({ api: { replicas: 4, concurrency: 7 } });
  });

  it("never pins a key the run inherits", () => {
    const d = diagram();
    const sim: Simulation = { ...d.simulations![0], setup: { props: { api: { concurrency: 7 } } } };
    expect(repairedRun(d, sim, { node: "api" }, [{ op: "set", path: ["replicas"], value: 4 }])).toBe(sim);
    const callerless = d.simulations![0];
    expect(
      repairedRun(d, callerless, { edge: "call" }, [{ op: "set", path: ["caller", "deadlineMs"], value: 250 }]),
    ).toBe(callerless);
  });

  it("merges only overridden caller fields, a nested one as its whole field", () => {
    const d = diagram();
    const retry = {
      maxAttempts: 5,
      backoffMs: 50,
      strategy: "fixed" as const,
      retryOn: ["timeout" as const],
      idempotent: false,
    };
    const sim: Simulation = {
      ...d.simulations![0],
      setup: { edges: { call: { caller: { retry, replyMs: 17, deadlineMs: null } } } },
    };
    const next = repairedRun(d, sim, { edge: "call" }, [
      { op: "set", path: ["caller", "retry", "idempotent"], value: true },
      { op: "set", path: ["caller", "deadlineMs"], value: 250 },
      { op: "set", path: ["caller", "poolConnections"], value: 1 },
    ]);
    expect(next.setup!.edges!.call.caller).toEqual({
      retry: { ...retry, idempotent: true },
      replyMs: 17,
      deadlineMs: 250,
    });
  });

  it("raises only a short deadline with atLeast", () => {
    const d = diagram();
    const run = (deadlineMs: number | null): Simulation => ({
      ...d.simulations![0],
      setup: { edges: { call: { caller: { deadlineMs } } } },
    });
    const raise = (sim: Simulation) =>
      repairedRun(d, sim, { edge: "call" }, [{ op: "atLeast", path: ["caller", "deadlineMs"], value: 2000 }]);
    expect(raise(run(250)).setup!.edges!.call.caller).toEqual({ deadlineMs: 2000 });
    for (const sim of [run(3000), run(null)]) expect(raise(sim)).toBe(sim);
  });

  it("normalizes a run's capacity multiplier, keeping its traffic multiplier", () => {
    const d = diagram();
    const patches = [{ op: "set" as const, path: ["multipliers", "capacity"] as const, value: 1 }];
    const sim: Simulation = { ...d.simulations![0], multipliers: { traffic: 1.5, capacity: 2 } };
    expect(repairedRun(d, sim, { run: true }, patches).multipliers).toEqual({ traffic: 1.5, capacity: 1 });
    expect(repairedRun(d, d.simulations![0], { run: true }, patches)).toBe(d.simulations![0]);
  });
});

describe("createRepairs", () => {
  const ports = (d: DiagramFile, live: Partial<NonNullable<RepairPorts["live"]>> | null = null): RepairPorts => ({
    editor: {
      getDiagram: () => d,
      setNodeProps: vi.fn((id, props) => {
        d.nodes = d.nodes.map((n) => (n.id === id ? { ...n, props: { ...n.props, ...props } } : n));
      }),
      setEdgeProps: vi.fn(),
      updateMeta: vi.fn((patch) => Object.assign(d, patch)),
    },
    live: live as RepairPorts["live"],
    liveOn: live !== null,
  });
  const overridden = (sim: Simulation): Simulation => ({ ...sim, setup: { props: { api: { replicas: 1 } } } });
  const patch = {
    target: { node: "api" },
    patches: [{ op: "set", path: ["replicas"], value: 4 }],
    runs: ["run"],
  } as const;

  it("repairs the diagram, then a saved run with Live off, through the document", () => {
    const d = diagram();
    d.simulations = [overridden(d.simulations![0])];
    const p = ports(d);
    expect(createRepairs().repair(p, patch)).toBe("done");
    expect(d.nodes[0].props).toMatchObject({ replicas: 4 });
    expect(d.simulations[0].setup!.props!.api).toEqual({ replicas: 4 });
  });

  it("repairs the learner's unsaved draft with Run, leaving the saved run, and waits for the session to show it", () => {
    const d = diagram();
    const saved = overridden(d.simulations![0]);
    d.simulations = [saved];
    const draft: Simulation = { ...saved, title: "Mine", seed: 9 };
    let selected: Simulation = draft;
    const live = {
      draft,
      simulations: d.simulations,
      controller: { getState: () => ({ simulation: selected }) } as never,
      runDraft: vi.fn((sim: Simulation) => void (selected = sim)),
      saveSimulation: vi.fn(),
    };
    const repairs = createRepairs();
    const p = ports(d, live);
    expect(repairs.repair(p, patch)).toBe("waiting");
    expect(live.runDraft).toHaveBeenCalledWith({ ...draft, setup: { props: { api: { replicas: 4 } } } });
    expect(live.saveSimulation).not.toHaveBeenCalled();
    // Not shown yet: no second write.
    expect(repairs.repair(p, patch)).toBe("waiting");
    expect(live.runDraft).toHaveBeenCalledOnce();
    // Live's next render publishes the draft it ran.
    live.draft = selected;
    expect(repairs.repair(p, patch)).toBe("done");
    expect(d.simulations).toEqual([saved]);
  });

  it("saves a saved run through Save, and stops waiting when its session is gone", () => {
    const d = diagram();
    d.simulations = [overridden(d.simulations![0])];
    const live = {
      draft: null,
      simulations: d.simulations,
      controller: { getState: () => ({ simulation: null }) } as never,
      runDraft: vi.fn(),
      saveSimulation: vi.fn(() => true),
    };
    const repairs = createRepairs();
    expect(repairs.repair(ports(d, live), patch)).toBe("waiting");
    expect(live.saveSimulation).toHaveBeenCalledOnce();
    // A remounted session never shows the first one's write: the repair reads afresh (and saves again).
    expect(
      repairs.repair(ports(d, { ...live, controller: { getState: () => ({ simulation: null }) } as never }), patch),
    ).toBe("waiting");
    expect(live.saveSimulation).toHaveBeenCalledTimes(2);
  });

  it("gives up on a copy Run refuses, leaving the draft the learner's", () => {
    const d = diagram();
    const draft = overridden(d.simulations![0]);
    const live = {
      draft,
      simulations: d.simulations!,
      controller: { getState: () => ({ simulation: draft }) } as never,
      runDraft: vi.fn(),
      saveSimulation: vi.fn(),
    };
    expect(createRepairs().repair(ports(d, live), patch)).toBe("done");
    expect(live.runDraft).toHaveBeenCalledOnce();
  });

  it("gives the open panel's working copy the same merge, keeping its pending edits", () => {
    const d = diagram();
    const saved = overridden(d.simulations![0]);
    d.simulations = [saved];
    let panel: Simulation = { ...saved, title: "Pending title" };
    const live = {
      draft: null,
      simulations: d.simulations,
      controller: { getState: () => ({ simulation: null }) } as never,
      runDraft: vi.fn(),
      saveSimulation: vi.fn(() => true),
      editPanelCopy: vi.fn((id: string, edit: (sim: Simulation) => Simulation) => {
        if (panel.id === id) panel = edit(panel);
      }),
    };
    createRepairs().repair(ports(d, live), patch);
    expect(panel).toEqual({ ...saved, title: "Pending title", setup: { props: { api: { replicas: 4 } } } });
  });

  it("puts a run's saved multipliers back to ×1 before a reference replay", () => {
    const d = diagram();
    d.simulations = [{ ...d.simulations![0], multipliers: { traffic: 2, capacity: 0.25 } }];
    expect(createRepairs().reference(ports(d), "run")).toBe("done");
    expect(d.simulations[0].multipliers).toEqual({ traffic: 1, capacity: 1 });
  });

  it("waits for Live's session while it mounts", () => {
    const d = diagram();
    const p = { ...ports(d), liveOn: true };
    expect(createRepairs().repair(p, patch)).toBe("waiting");
  });
});
