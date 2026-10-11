import type { DiagramFile, Simulation, TrafficShape, TimelineStep } from "../model/types";
import { simulationProblem, simulationReferenceWarnings } from "../interop/native";
import { autoScale } from "../sim/scale";
import { uniqueId } from "../editor/ids";
import { resolveRef, normalizeRef, ReferenceError } from "./refs";
import { checkBudget, checkSchema, validated } from "./validation";
import { set_simulationSchema } from "./schemas";
import type { SimulationSpec } from "./index";

/** Builds a validated simulation; the caller appends/replaces it in one editor transaction. */
export function buildSimulation(diagram: DiagramFile, spec: SimulationSpec): Simulation {
  checkBudget(spec);
  checkSchema(spec, set_simulationSchema);
  if (spec.durationSec !== undefined && spec.durationSec < 1) throw new Error("Duration must be at least one second.");
  const nodeRef = (ref: string) => {
    const id = resolveRef({ ...diagram, edges: [], groups: [], annotations: [] }, ref);
    return id;
  };
  const sims = diagram.simulations ?? [];
  let id = uniqueId("sim", new Set(sims.map((s) => s.id)));
  if (spec.replace !== undefined) {
    const exact = sims.filter((s) => s.id === spec.replace);
    const matches = exact.length ? exact : sims.filter((s) => normalizeRef(s.title) === normalizeRef(spec.replace!));
    if (matches.length !== 1)
      throw new ReferenceError(
        spec.replace,
        matches.map((s) => ({ id: s.id, label: s.title })),
      );
    id = matches[0].id;
  }
  const traffic = spec.traffic.map((t, i) => {
    const start = (t.startSec ?? 0) * 1000,
      duration = (t.durationSec ?? spec.durationSec ?? 60) * 1000;
    const need = (key: "count" | "ratePerSec" | "toRatePerSec" | "peakSec") => {
      const value = t[key];
      if (value === undefined) throw new Error(`${t.pattern} traffic needs ${key}.`);
      return value;
    };
    let shape: TrafficShape;
    switch (t.pattern) {
      case "constant":
        shape = { kind: "constant", ratePerSec: need("ratePerSec"), fromMs: start, durationMs: duration };
        break;
      case "burst":
        shape = { kind: "burst", count: need("count"), atMs: start, spreadMs: (t.durationSec ?? 0) * 1000 };
        break;
      case "ramp":
        shape = {
          kind: "ramp",
          fromMs: start,
          startRate: need("ratePerSec"),
          stages: [{ durationMs: duration, targetRate: need("toRatePerSec") }],
        };
        break;
      case "spike":
        shape = {
          kind: "spike",
          baseRate: need("ratePerSec"),
          peakRate: need("toRatePerSec"),
          atMs: start,
          peakMs: need("peakSec") * 1000,
          durationMs: duration,
        };
        break;
    }
    return {
      id: `traffic-${i + 1}`,
      node: nodeRef(t.from),
      shape,
      ...(t.messageType !== undefined ? { messageType: t.messageType } : {}),
      ...(t.label !== undefined ? { label: t.label } : {}),
    };
  });
  const timeline: TimelineStep[] = [];
  for (const e of spec.events ?? []) {
    const atMs = e.atSec * 1000,
      node = nodeRef(e.node);
    if (e.do === "set") {
      if (!e.props) throw new Error("set events need props.");
      timeline.push({ atMs, action: { do: "props", node, props: e.props } });
    } else if (e.do === "slow") {
      if (e.latencyMs === undefined) throw new Error("slow events need latencyMs.");
      timeline.push({ atMs, action: { do: "props", node, props: { latencyMs: e.latencyMs } } });
    } else timeline.push({ atMs, action: { do: "status", node, status: e.do === "pause" ? "paused" : e.do } });
    if (e.note !== undefined) timeline.push({ atMs, action: { do: "note", text: e.note, focus: [node] } });
  }
  const simulation: Simulation = {
    id,
    title: spec.title,
    ...(spec.durationSec !== undefined ? { durationMs: spec.durationSec * 1000 } : {}),
    traffic,
    ...(timeline.length ? { timeline: timeline.sort((a, b) => a.atMs - b.atMs) } : {}),
    ...(spec.expectations
      ? {
          expectations: spec.expectations.map((e, i) => {
            if (e.metric !== "inSystem" && e.node === undefined) throw new Error("Node metrics need a node reference.");
            return {
              id: `expectation-${i + 1}`,
              label: e.label,
              metric:
                e.metric === "inSystem" ? { system: "inSystem" as const } : { node: nodeRef(e.node!), field: e.metric },
              op: e.op,
              value: e.value,
              when: e.when ?? "end",
            };
          }),
        }
      : {}),
  };
  simulation.scale = autoScale(simulation, diagram);
  const problem = simulationProblem(simulation);
  if (problem) throw new Error(problem);
  const warnings = simulationReferenceWarnings(simulation, new Set(diagram.nodes.map((n) => n.id)));
  if (warnings.length) throw new Error(warnings.join(" "));
  validated({ ...diagram, simulations: [...sims.filter((s) => s.id !== id), simulation] });
  return simulation;
}
