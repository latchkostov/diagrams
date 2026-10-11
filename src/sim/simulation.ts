import type { DiagramFile, Expectation, Simulation, TrafficShape } from "../model/types";
import { createEngine, seedEngine } from "./engine";
import { resolveScale, resolveMultiplier, toRealUnits } from "./units";
export { autoScale } from "./scale";
import type {
  ExpectationState,
  SimulationRun,
  SimulationRunOptions,
  SimulationRunState,
  TimelineMarker,
} from "./types";

import { clampSpeed, createScheduler, SIM_TICK_MS as TICK } from "./scheduler";
const CAP = 600_000;
const GRACE = 1500;
const positive = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);

export function trafficWindow(shape: TrafficShape): { startMs: number; endMs: number } {
  switch (shape.kind) {
    case "burst": {
      const startMs = positive(shape.atMs ?? 0);
      return { startMs, endMs: startMs + positive(shape.spreadMs ?? 0) };
    }
    case "constant": {
      const startMs = positive(shape.fromMs ?? 0);
      return { startMs, endMs: startMs + positive(shape.durationMs) };
    }
    case "ramp": {
      const startMs = positive(shape.fromMs ?? 0);
      return { startMs, endMs: startMs + shape.stages.reduce((sum, stage) => sum + positive(stage.durationMs), 0) };
    }
    case "spike":
      return { startMs: 0, endMs: positive(shape.durationMs) };
  }
}

/** Half-open windows. An instantaneous burst has a 1 ms preview pulse; injection is discrete. */
export function trafficRateAt(shape: TrafficShape, tMs: number): number {
  const { startMs, endMs } = trafficWindow(shape);
  if (!Number.isFinite(tMs) || tMs < startMs) return 0;
  if (shape.kind === "burst") {
    const spread = Math.max(1, positive(shape.spreadMs ?? 0));
    return tMs < startMs + spread ? (positive(shape.count) * 1000) / spread : 0;
  }
  if (tMs >= endMs) return 0;
  if (shape.kind === "constant") return positive(shape.ratePerSec);
  if (shape.kind === "spike")
    return positive(tMs >= shape.atMs && tMs < shape.atMs + positive(shape.peakMs) ? shape.peakRate : shape.baseRate);
  let start = startMs,
    rate = positive(shape.startRate ?? 0);
  for (const stage of shape.stages) {
    const duration = positive(stage.durationMs),
      target = positive(stage.targetRate);
    if (duration && tMs < start + duration) return rate + ((target - rate) * (tMs - start)) / duration;
    start += duration;
    rate = target;
  }
  return 0;
}

// Integrate exactly across rate discontinuities and ramp stage boundaries, including partial ticks.
function trafficArea(shape: TrafficShape, from: number, to: number): number {
  const window = trafficWindow(shape);
  const left = Math.max(from, window.startMs),
    right = Math.min(to, window.endMs);
  if (right <= left || shape.kind === "burst") return 0;
  const cuts = [left, right];
  if (shape.kind === "spike") cuts.push(shape.atMs, shape.atMs + positive(shape.peakMs));
  if (shape.kind === "ramp") {
    let time = window.startMs;
    for (const stage of shape.stages) {
      time += positive(stage.durationMs);
      cuts.push(time);
    }
  }
  const points = [...new Set(cuts.filter((t) => t >= left && t <= right))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    // The midpoint rule is exact for each linear/constant segment.
    area += (trafficRateAt(shape, (a + b) / 2) * (b - a)) / 1000;
  }
  return area;
}

export function estimateTotalMs(simulation: Simulation): number {
  if (simulation.durationMs !== undefined) return Math.min(CAP, positive(simulation.durationMs));
  return Math.min(
    CAP,
    Math.max(
      0,
      ...simulation.traffic.map((p) => trafficWindow(p.shape).endMs),
      ...(simulation.timeline ?? []).map((step) => positive(step.atMs)),
    ) + 10_000,
  );
}

function matches(expectation: Expectation, value: number): boolean {
  switch (expectation.op) {
    case "<":
      return value < expectation.value;
    case "<=":
      return value <= expectation.value;
    case "==":
      return value === expectation.value;
    case ">=":
      return value >= expectation.value;
    case ">":
      return value > expectation.value;
  }
}

export function createSimulationRun(
  diagram: DiagramFile,
  simulation: Simulation,
  opts: SimulationRunOptions = {},
): SimulationRun {
  const seed = simulation.seed ?? opts.seed ?? 1;
  const scale = resolveScale(simulation.scale);
  let multipliers = {
    traffic: resolveMultiplier(simulation.multipliers?.traffic),
    capacity: resolveMultiplier(simulation.multipliers?.capacity),
  };
  const injectionCredits = new Map<string, number>();
  const engine = opts.engine ?? createEngine({ ...opts, seed });
  const timeline = [...(simulation.timeline ?? [])].sort((a, b) => a.atMs - b.atMs);
  const markers: TimelineMarker[] = timeline.map((step) => ({
    atMs: step.atMs,
    kind: step.action.do,
    label: step.action.do === "note" ? step.action.text : `${step.action.do}: ${step.action.node}`,
  }));
  for (const profile of simulation.traffic) {
    const window = trafficWindow(profile.shape),
      label = profile.label ?? profile.id;
    markers.push({ atMs: window.startMs, kind: "traffic", label });
    if (window.endMs !== window.startMs) markers.push({ atMs: window.endMs, kind: "traffic", label: `${label} ends` });
  }
  markers.sort((a, b) => a.atMs - b.atMs);
  const totalMs = estimateTotalMs(simulation);
  const trafficEnd = Math.max(0, ...simulation.traffic.map((p) => trafficWindow(p.shape).endMs));
  const scheduler = createScheduler();
  let speed = 1,
    cursor = 0,
    done = false,
    waiting = false;
  let idleSince: number | undefined;
  let note: SimulationRunState["note"];
  let metrics: ReturnType<typeof engine.metrics>;
  let expectations: ExpectationState[] = [];
  let credits: number[] = [],
    fired: boolean[] = [];

  function injectReal(node: string, count: number, type?: string, spreadMs?: number): void {
    if (!diagram.nodes.some((input) => input.id === node)) return;
    const key = JSON.stringify([node, type]);
    const credit = (injectionCredits.get(key) ?? 0) + (positive(count) * multipliers.traffic) / scale;
    const samples = Math.floor(credit + 1e-9);
    injectionCredits.set(key, credit - samples);
    if (samples > 0) engine.inject(node, samples, { type, spreadMs });
  }

  function actions(time: number): void {
    while (!waiting && cursor < timeline.length && timeline[cursor].atMs <= time) {
      const step = timeline[cursor++],
        action = step.action;
      switch (action.do) {
        case "status":
          engine.setNodeStatus(action.node, action.status);
          break;
        case "props":
          engine.setNodeProps(action.node, action.props);
          break;
        case "inject":
          injectReal(action.node, action.count, action.messageType, action.spreadMs);
          break;
        case "note":
          note = {
            text: action.text,
            focus: (action.focus ?? []).filter((id) => diagram.nodes.some((node) => node.id === id)),
            atMs: step.atMs,
          };
          waiting = action.pause === true;
      }
    }
  }

  function bursts(time: number): void {
    simulation.traffic.forEach((profile, index) => {
      if (profile.shape.kind !== "burst" || fired[index] || trafficWindow(profile.shape).startMs > time) return;
      fired[index] = true;
      credits[index] += (positive(profile.shape.count) * multipliers.traffic) / scale;
      const count = Math.floor(credits[index] + 1e-9);
      credits[index] -= count;
      if (count > 0)
        engine.inject(profile.node, count, { type: profile.messageType, spreadMs: profile.shape.spreadMs });
    });
  }

  function evaluate(final = false): void {
    (simulation.expectations ?? []).forEach((expectation, index) => {
      const state = expectations[index],
        measured = engine.measure(expectation.metric);
      const value = measured === undefined ? undefined : toRealUnits(measured, scale);
      if (value === undefined) return; // Unknown ids are ignored, like actions and injections.
      state.value = value;
      const pass = matches(expectation, value),
        mode = expectation.when ?? "end";
      if (mode === "always") {
        if (!pass) state.status = "fail";
        else if (final && state.status !== "fail") state.status = "pass";
      } else if (mode === "eventually") {
        if (pass) state.status = "pass";
        else if (final && state.status !== "pass") state.status = "fail";
      } else if (state.status === "pending" && (mode === "end" ? final : metrics.time >= (expectation.atMs ?? 0))) {
        state.status = pass ? "pass" : "fail";
      } else if (final && state.status === "pending") state.status = "fail";
    });
  }

  function refresh(): void {
    metrics = engine.metrics();
    if (!waiting && note && metrics.time - note.atMs >= 6000) note = undefined;
    const finished =
      cursor === timeline.length &&
      metrics.time >= trafficEnd &&
      metrics.inSystem === 0 &&
      metrics.pendingInjections === 0;
    if (finished) idleSince ??= metrics.time;
    else idleSince = undefined;
    done =
      !waiting &&
      (metrics.time >= CAP ||
        (simulation.durationMs !== undefined
          ? metrics.time >= positive(simulation.durationMs)
          : idleSince !== undefined && metrics.time - idleSince >= GRACE));
    evaluate(done);
  }

  function restart(): void {
    seedEngine(engine, seed);
    engine.load(diagram);
    engine.setScale(scale);
    multipliers = {
      traffic: resolveMultiplier(simulation.multipliers?.traffic),
      capacity: resolveMultiplier(simulation.multipliers?.capacity),
    };
    engine.setCapacityMultiplier(multipliers.capacity);
    injectionCredits.clear();
    speed = 1;
    scheduler.reset();
    cursor = 0;
    done = false;
    waiting = false;
    idleSince = undefined;
    note = undefined;
    credits = simulation.traffic.map(() => 0);
    fired = simulation.traffic.map(() => false);
    expectations = (simulation.expectations ?? []).map((e) => ({
      id: e.id,
      label: e.label,
      status: "pending",
      value: 0,
    }));
    for (const [id, props] of Object.entries(simulation.setup?.props ?? {})) engine.setNodeProps(id, props);
    for (const [id, status] of Object.entries(simulation.setup?.status ?? {})) engine.setNodeStatus(id, status);
    actions(0);
    if (!waiting) bursts(0);
    refresh();
  }

  restart();
  return {
    engine,
    setMultipliers(patch) {
      multipliers = {
        traffic: resolveMultiplier(patch.traffic, multipliers.traffic),
        capacity: resolveMultiplier(patch.capacity, multipliers.capacity),
      };
      engine.setCapacityMultiplier(multipliers.capacity);
    },
    setSpeed(value) {
      speed = clampSpeed(value, speed);
      engine.setSpeed(speed);
    },
    step(dtMs): void {
      if (waiting || done || !Number.isFinite(dtMs) || dtMs <= 0) return;
      // Keep fractional simulation ticks here; engine.step applies speed exactly once.
      scheduler.advance(dtMs * speed, () => {
        const from = metrics.time;
        engine.step(TICK / speed);
        const to = from + TICK;
        actions(to);
        if (!waiting) {
          simulation.traffic.forEach((profile, index) => {
            credits[index] += (trafficArea(profile.shape, from, to) * multipliers.traffic) / scale;
            const count = Math.floor(credits[index] + 1e-9);
            credits[index] -= count;
            if (count > 0) engine.inject(profile.node, count, { type: profile.messageType });
          });
          bursts(to);
        } else {
          // The interval elapsed before the note was reached, so retain its traffic credit.
          simulation.traffic.forEach((profile, index) => {
            credits[index] += (trafficArea(profile.shape, from, to) * multipliers.traffic) / scale;
          });
        }
        refresh();
        return !waiting && !done;
      });
    },
    state: () => ({
      time: metrics.time,
      totalMs,
      scale,
      multipliers: { ...multipliers },
      done,
      waiting,
      note: note ? { ...note, focus: [...note.focus] } : undefined,
      expectations: expectations.map((e) => ({ ...e })),
      markers: markers.map((marker) => ({ ...marker })),
    }),
    resume(): void {
      if (!waiting || done) return;
      waiting = false;
      actions(metrics.time);
      if (!waiting) {
        simulation.traffic.forEach((profile, index) => {
          const count = Math.floor(credits[index] + 1e-9);
          credits[index] -= count;
          if (count > 0) engine.inject(profile.node, count, { type: profile.messageType });
        });
        bursts(metrics.time);
      }
      refresh();
    },
    restart,
  };
}
