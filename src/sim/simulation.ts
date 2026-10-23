import { faultLabel } from "../model/faultWords";
import { simulationSetup } from "./topology";
import { faultTimelineProblem, FaultTimelineError } from "../model/faultRuntime";
import type { DiagramFile, Expectation, Simulation, TrafficShape } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { createRealCountInjector } from "./injection";
import { createEngine, seedEngine, SOURCE_VOLUME_CAP, WorkBudgetError } from "./engine";
import { realFrame, realSnapshot, resolveScale, resolveMultiplier, toRealUnits } from "./units";
export { autoScale } from "./scale";
import type {
  ExpectationState,
  InjectOptions,
  SimulationRun,
  SimulationRunOptions,
  SimulationRunState,
  SimulationRunCheckpoint,
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

/** Startup needs the entire ramp, so integrate each stage directly instead of rescanning it per segment. */
function trafficVolume(shape: TrafficShape): number {
  if (shape.kind === "burst") return positive(shape.count);
  if (shape.kind !== "ramp") return trafficArea(shape, 0, Infinity);
  let rate = positive(shape.startRate ?? 0),
    volume = 0;
  for (const stage of shape.stages) {
    const duration = positive(stage.durationMs),
      target = positive(stage.targetRate);
    volume += (duration * (rate + target)) / 2000;
    rate = target;
  }
  return volume;
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
  const problem = faultTimelineProblem(diagram, simulation);
  if (problem) throw new FaultTimelineError(problem);
  const seed = simulation.seed ?? opts.seed ?? 1;
  const scale = resolveScale(simulation.scale);
  let multipliers = {
    traffic: resolveMultiplier(simulation.multipliers?.traffic),
    capacity: resolveMultiplier(simulation.multipliers?.capacity),
  };
  const injectionCredits = new Map<string, number>();
  const inputs = new Map(diagram.nodes.map((node) => [node.id, node]));
  const sourceIds = diagram.nodes
    .filter((node) => (opts.roleOf ?? stencilRole)(node.stencil) === "source")
    .map((node) => node.id);
  const engine = opts.engine ?? createEngine({ ...opts, seed });
  const manual = createRealCountInjector(engine, (id) => inputs.get(id), opts.roleOf ?? stencilRole, diagram.planning);
  const checkpoints = new WeakMap<SimulationRunCheckpoint, () => void>();
  let epoch = 0;
  const timeline = [...(simulation.timeline ?? [])].sort((a, b) => a.atMs - b.atMs);
  const markers: TimelineMarker[] = timeline.map((step) => ({
    atMs: step.atMs,
    kind: step.action.do,
    label:
      step.action.do === "note"
        ? step.action.text
        : step.action.do === "fault"
          ? faultLabel(step.action.fault, step.action.drill, diagram)
          : `${step.action.do}: ${step.action.node}`,
  }));
  for (const profile of simulation.traffic) {
    const window = trafficWindow(profile.shape),
      label = profile.label ?? profile.id;
    markers.push({ atMs: window.startMs, kind: "traffic", label });
    if (window.endMs !== window.startMs) markers.push({ atMs: window.endMs, kind: "traffic", label: `${label} ends` });
  }
  markers.sort((a, b) => a.atMs - b.atMs);
  engine.setLatencySinceFault(timeline.some((step) => step.action.do === "fault"));
  const totalMs = estimateTotalMs(simulation);
  const trafficEnd = Math.max(0, ...simulation.traffic.map((p) => trafficWindow(p.shape).endMs));
  const scheduler = createScheduler();
  let speed = 1,
    cursor = 0,
    done = false,
    waiting = false,
    traceActions = true;
  let idleSince: number | undefined;
  let note: SimulationRunState["note"];
  let metrics: ReturnType<typeof engine.metrics>;
  let expectations: ExpectationState[] = [];
  let credits: number[] = [],
    fired: boolean[] = [];
  let scriptedSamples = 0;

  function injectScripted(node: string, count: number, options?: InjectOptions): void {
    if (!Number.isFinite(count) || count > SOURCE_VOLUME_CAP - scriptedSamples)
      throw new WorkBudgetError("The simulation exceeds its scripted traffic budget");
    scriptedSamples += count;
    engine.inject(node, count, options);
  }

  function injectReal(node: string, count: number, type?: string, spreadMs?: number): void {
    if (!inputs.has(node)) return;
    const key = JSON.stringify([node, type]);
    const credit = (injectionCredits.get(key) ?? 0) + (positive(count) * multipliers.traffic) / scale;
    const samples = Math.floor(credit + 1e-9);
    injectionCredits.set(key, credit - samples);
    if (samples > 0) injectScripted(node, samples, { type, spreadMs });
  }

  function injectManual(node: string, count: number, options: InjectOptions = {}): void {
    manual.inject(node, count, scale, options);
    refresh();
  }

  function actions(time: number): void {
    while (!waiting && cursor < timeline.length && timeline[cursor].atMs <= time) {
      const step = timeline[cursor++],
        action = step.action;
      switch (action.do) {
        case "fault":
          engine.setFault(action.fault);
          break;
        case "status":
          engine.setNodeStatus(action.node, action.status);
          break;
        case "props":
          engine.setNodeProps(action.node, action.props);
          break;
        case "inject":
          injectReal(action.node, action.count, action.messageType, action.spreadMs);
          break;
        case "trace":
          if (traceActions && inputs.has(action.node)) engine.tracer.request({ next: "message", node: action.node });
          break;
        case "note":
          note = {
            text: action.text,
            focus: (action.focus ?? []).filter((id) => inputs.has(id)),
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
        injectScripted(profile.node, count, { type: profile.messageType, spreadMs: profile.shape.spreadMs });
    });
  }

  function evaluate(final = false): void {
    (simulation.expectations ?? []).forEach((expectation, index) => {
      const state = expectations[index],
        measured = engine.measure(expectation.metric);
      const value =
        measured === undefined
          ? undefined
          : "field" in expectation.metric && expectation.metric.field === "amplification"
            ? measured
            : toRealUnits(measured, scale);
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
    // Refuse unsafe raw callers too, before startup actions or bursts schedule anything.
    const messages = simulation.traffic.reduce(
      (sum, { shape }) => sum + trafficVolume(shape),
      (simulation.timeline ?? []).reduce(
        (sum, { action }) => sum + (action.do === "inject" ? positive(action.count) : 0),
        0,
      ),
    );
    if (
      !Number.isFinite(messages) ||
      (messages * resolveMultiplier(simulation.multipliers?.traffic)) / resolveScale(simulation.scale) >
        SOURCE_VOLUME_CAP
    )
      throw new WorkBudgetError("The simulation exceeds its scripted traffic budget");
    scriptedSamples = 0;
    seedEngine(engine, seed);
    // The same configuration static message analysis and loop-fix verification read (configuredDiagram).
    const setup = simulationSetup(diagram, simulation);
    engine.load(setup.diagram);
    multipliers = {
      traffic: resolveMultiplier(simulation.multipliers?.traffic),
      capacity: resolveMultiplier(simulation.multipliers?.capacity),
    };
    engine.setNodePropsBatch(setup.props, multipliers.capacity);
    engine.setScale(scale);
    injectionCredits.clear();
    manual.clear();
    epoch++;
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
    for (const [id, status] of Object.entries(simulation.setup?.status ?? {})) engine.setNodeStatus(id, status);
    actions(0);
    if (!waiting) bursts(0);
    refresh();
  }

  function checkpoint() {
    const engineState = engine.checkpoint();
    const saved = structuredClone({
      multipliers,
      speed,
      cursor,
      done,
      waiting,
      idleSince,
      note,
      expectations,
      credits,
      fired,
      injectionCredits,
      scriptedSamples,
    });
    const manualState = manual.checkpoint();
    const clock = scheduler.checkpoint();
    const savedEpoch = epoch;
    const token = Object.freeze({ time: metrics.time });
    checkpoints.set(token, () => {
      if (epoch !== savedEpoch) throw new Error("Checkpoint belongs to a previous run");
      engine.restore(engineState);
      const copy = structuredClone(saved);
      ({ multipliers, speed, cursor, done, waiting, idleSince, note, expectations, credits, fired, scriptedSamples } =
        copy);
      injectionCredits.clear();
      for (const [key, value] of copy.injectionCredits) injectionCredits.set(key, value);
      manual.restore(manualState);
      scheduler.restore(clock);
      metrics = engine.metrics();
    });
    return token;
  }
  function restore(checkpoint: SimulationRunCheckpoint) {
    const restore = checkpoints.get(checkpoint);
    if (!restore) throw new Error("Checkpoint belongs to another runner");
    restore();
  }

  // Refusals depend only on allocation configuration, never on elapsed time or traffic.
  // Validate the reachable edits before touching any caller-visible state.
  function transaction(until: number, update: () => void) {
    const properties = [];
    for (let i = cursor; i < timeline.length && timeline[i].atMs <= until; i++) {
      const action = timeline[i].action;
      if (action.do === "note" && action.pause) break;
      if (action.do === "props") properties.push(action);
    }
    if (properties.length) engine.validateLifecycleActions(properties);
    try {
      update();
    } catch (error) {
      if (error instanceof WorkBudgetError) {
        scheduler.reset();
        refresh();
      }
      throw error;
    }
  }

  restart();
  return {
    engine,
    checkpoint,
    restore,
    units: {
      sampledFrame: () => engine.frame(),
      realFrame: () => realFrame(engine.frame()),
      sampledSnapshot: () => engine.snapshot(),
      realSnapshot: () => realSnapshot(engine.snapshot()),
    },
    inject: injectManual,
    injectAtSources(count, options) {
      for (const id of sourceIds) injectManual(id, count, options);
    },
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
    setTraceActions(on) {
      traceActions = on;
    },
    step(dtMs): void {
      if (waiting || done || !Number.isFinite(dtMs) || dtMs <= 0) return;
      // Keep fractional simulation ticks here; engine.step applies speed exactly once.
      const ticks = Math.floor((scheduler.checkpoint() + dtMs * speed + 1e-8) / TICK);
      transaction(Math.min(metrics.time + ticks * TICK, Math.ceil(totalMs / TICK) * TICK), () =>
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
              if (count > 0) injectScripted(profile.node, count, { type: profile.messageType });
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
        }),
      );
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
      transaction(metrics.time, () => {
        waiting = false;
        actions(metrics.time);
        if (!waiting) {
          simulation.traffic.forEach((profile, index) => {
            const count = Math.floor(credits[index] + 1e-9);
            credits[index] -= count;
            if (count > 0) injectScripted(profile.node, count, { type: profile.messageType });
          });
          bursts(metrics.time);
        }
        refresh();
      });
    },
    restart,
  };
}
