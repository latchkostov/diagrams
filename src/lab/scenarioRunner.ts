// Drives a SimEngine through a Scenario's script and evaluates its checks. Pure TS (no DOM):
// the Lab readout calls advance() from requestAnimationFrame; tests call fastForward().

import type { DiagramFile } from "../model/types";
import type { EngineOptions, SimEngine, SimSnapshot } from "../sim/types";
import type { Scenario, SimAction } from "./types";
import { scenarioDuration } from "./scenarios";

export type CreateEngine = (opts?: EngineOptions) => SimEngine;
export type CheckStatus = "pending" | "pass" | "fail";

// Optional module: the Lab must build even before src/sim/engine.ts exists.
const engineModules = import.meta.glob<{ createEngine?: CreateEngine }>("../sim/engine.ts");

/** Resolves the engine factory, or null if src/sim/engine.ts is missing / doesn't export createEngine. */
export async function loadCreateEngine(): Promise<CreateEngine | null> {
  const load = engineModules["../sim/engine.ts"];
  if (!load) return null;
  const mod = await load();
  return typeof mod.createEngine === "function" ? mod.createEngine : null;
}

export interface ScenarioRun {
  engine: SimEngine;
  /** Advance by wall-clock ms (the engine applies its speed). Applies due actions, evaluates due checks. */
  advance(wallMs: number): SimSnapshot;
  /** Run as fast as possible until simulation time reaches `simMs` (default: the scenario's duration). */
  fastForward(simMs?: number): SimSnapshot;
  setSpeed(speed: number): void;
  snapshot(): SimSnapshot;
  checks(): { label: string; at: number; status: CheckStatus }[];
  /** Sim time at which the scenario counts as finished. */
  duration: number;
}

export function applyAction(engine: SimEngine, a: SimAction) {
  switch (a.do) {
    case "inject":
      engine.inject(a.node, a.count, { type: a.type, spreadMs: a.spreadMs });
      break;
    case "status":
      engine.setNodeStatus(a.node, a.status);
      break;
    case "props":
      engine.setNodeProps(a.node, a.props);
      break;
    case "traffic":
      engine.setTraffic(a.on);
      break;
  }
}

/** Largest sim-time slice between action / check evaluations, so timings are honoured closely. */
const SLICE_MS = 50;

export function createScenarioRun(createEngine: CreateEngine, diagram: DiagramFile, scenario: Scenario, opts: { seed?: number; speed?: number } = {}): ScenarioRun {
  const engine = createEngine({ seed: opts.seed ?? 1 });
  engine.load(diagram);
  let speed = opts.speed ?? 1;
  engine.setSpeed(speed);
  const actions = [...scenario.script].sort((a, b) => a.at - b.at);
  let nextAction = 0;
  const status: CheckStatus[] = scenario.checks.map(() => "pending");
  let snap = engine.snapshot();

  const settle = () => {
    while (nextAction < actions.length && actions[nextAction].at <= snap.time) applyAction(engine, actions[nextAction++]);
    scenario.checks.forEach((c, i) => {
      if (status[i] === "pending" && snap.time >= c.at) {
        let ok = false;
        try {
          ok = c.pass(snap);
        } catch {
          ok = false;
        }
        status[i] = ok ? "pass" : "fail";
      }
    });
  };
  settle(); // actions at t=0

  const advanceSim = (simMs: number) => {
    let left = simMs;
    while (left > 0) {
      const slice = Math.min(SLICE_MS, left);
      engine.step(slice / speed);
      left -= slice;
      snap = engine.snapshot();
      settle();
    }
  };

  return {
    engine,
    duration: scenarioDuration(scenario),
    advance(wallMs) {
      advanceSim(Math.max(0, wallMs) * speed);
      return snap;
    },
    fastForward(simMs) {
      const target = simMs ?? scenarioDuration(scenario);
      let guard = 0;
      while (snap.time < target && guard++ < 1_000_000) {
        const before = snap.time;
        advanceSim(Math.min(SLICE_MS * 20, target - snap.time));
        if (snap.time <= before) break; // engine not advancing; avoid spinning forever
      }
      return snap;
    },
    setSpeed(s) {
      speed = s;
      engine.setSpeed(s);
    },
    snapshot: () => snap,
    checks: () => scenario.checks.map((c, i) => ({ label: c.label, at: c.at, status: status[i] })),
  };
}
