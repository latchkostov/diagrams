import { faultTarget } from "../model/faults";
import { canCutLink } from "../model/faultRuntime";
import { t } from "../i18n";
// Warnings for a simulation against the diagram it runs on. The runner ignores unknown node ids,
// so a renamed node silently breaks a simulation; the authoring panel surfaces it instead.

import type { DiagramFile, Simulation } from "../model/types";
import { LIMITS } from "../interop/native";
import { faultTargets } from "./faults";
import { editableProperties } from "./editableProperties";

export interface SimFieldError {
  field: string;
  text: string;
}

/** Authoring diagnostics name the visible control and its units; import validation stays structural. */
export function simulationFieldErrors(sim: Simulation, diagram: DiagramFile): SimFieldError[] {
  const errors: SimFieldError[] = [];
  const add = (field: string, text: string) => errors.push({ field, text });
  const range = (field: string, label: string, value: number | undefined, max: number, integer = false) => {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value)))
    )
      add(
        field,
        integer
          ? t("workspaceValidation.integerRange", { field: label, max })
          : t("workspaceValidation.range", { field: label, max }),
      );
  };
  const time = (field: string, label: string, value?: number) =>
    range(field, label, value === undefined ? undefined : value / 1000, LIMITS.maxSimulationMs / 1000);
  const target = (field: string, label: string, valid: boolean) => {
    if (!valid) add(field, t("workspaceValidation.target", { field: label }));
  };
  const nodes = new Set(diagram.nodes.map((n) => n.id));
  if (!sim.title.trim()) add("sim-panel-title", t("workspaceValidation.title"));
  if (!sim.id) add("sim-panel-id", t("workspaceValidation.id"));
  if (sim.seed !== undefined && !Number.isFinite(sim.seed))
    add("sim-panel-seed", t("workspaceValidation.number", { field: "Seed" }));
  time("sim-panel-duration", "Stop after (s)", sim.durationMs);
  sim.traffic.forEach((p, i) => {
    const id = `sim-panel-traffic-${i}`;
    const label = `Traffic ${i + 1}`;
    target(`${id}-node`, `${label}: Starts at`, nodes.has(p.node));
    const s = p.shape;
    if (s.kind === "burst") {
      range(`${id}-count`, `${label}: Messages`, s.count, LIMITS.maxMessageCount, true);
      time(`${id}-at`, `${label}: At (s)`, s.atMs);
      time(`${id}-spread`, `${label}: Over (s)`, s.spreadMs);
    } else {
      time(`${id}-from`, `${label}: From (s)`, "fromMs" in s ? s.fromMs : undefined);
      time(
        `${id}-duration`,
        `${label}: ${s.kind === "spike" ? "Total" : "For"} (s)`,
        "durationMs" in s ? s.durationMs : undefined,
      );
      if (s.kind === "constant") range(`${id}-rate`, `${label}: Rate (/s)`, s.ratePerSec, LIMITS.maxRatePerSec);
      if (s.kind === "spike") {
        range(`${id}-base`, `${label}: Base (/s)`, s.baseRate, LIMITS.maxRatePerSec);
        range(`${id}-peak`, `${label}: Peak (/s)`, s.peakRate, LIMITS.maxRatePerSec);
        time(`${id}-at`, `${label}: Peak at (s)`, s.atMs);
        time(`${id}-peak-for`, `${label}: Peak for (s)`, s.peakMs);
      }
      if (s.kind === "ramp") {
        range(`${id}-start-rate`, `${label}: Start rate (/s)`, s.startRate, LIMITS.maxRatePerSec);
        s.stages.forEach((stage, j) => {
          time(`${id}-stage-${j}-duration`, `${label}: Stage ${j + 1} seconds`, stage.durationMs);
          range(
            `${id}-stage-${j}-rate`,
            `${label}: Stage ${j + 1} target rate (/s)`,
            stage.targetRate,
            LIMITS.maxRatePerSec,
          );
        });
      }
    }
  });
  sim.timeline?.forEach((step, i) => {
    const id = `sim-panel-step-${i}`;
    const label = `Timeline ${i + 1}`;
    time(`${id}-time`, `${label}: Time (s)`, step.atMs);
    const a = step.action;
    if (a.do === "fault")
      target(
        `${id}-fault-target`,
        `${label}: Target`,
        faultTargets(diagram, a.fault.kind).some((n) => n.id === faultTarget(a.fault)),
      );
    else if (a.do !== "note") target(`${id}-node`, `${label}: Target node`, nodes.has(a.node));
    if (a.do === "inject") range(`${id}-count`, `${label}: Messages`, a.count, LIMITS.maxMessageCount, true);
    if (a.do === "props") {
      const key = Object.keys(a.props)[0];
      const property = editableProperties.find((property) => property.key === key);
      if (property) range(`${id}-value`, `${label}: ${key}`, Number(a.props[key]), property.maximum);
    }
  });
  sim.expectations?.forEach((e, i) => {
    const id = `sim-panel-expectation-${i}`;
    if ("node" in e.metric) target(`${id}-node`, `Expectation ${i + 1}: Metric node`, nodes.has(e.metric.node));
    if (!Number.isFinite(e.value))
      add(`${id}-value`, t("workspaceValidation.number", { field: `Expectation ${i + 1}: Value` }));
    if (e.when === "at") time(`${id}-at`, `Expectation ${i + 1}: At (s)`, e.atMs);
  });
  return errors;
}

export interface SimWarning {
  /** Where to show it in the panel: "traffic:<id>", "timeline:<index>", "expectation:<id>", "simulation". */
  where: string;
  text: string;
}

export function simulationWarnings(sim: Simulation, diagram: DiagramFile): SimWarning[] {
  const nodes = new Set(diagram.nodes.map((n) => n.id));
  const out: SimWarning[] = [];
  const missing = (where: string, id: string, what: string) => {
    if (!nodes.has(id)) out.push({ where, text: `${what} node “${id}” isn't in this diagram.` });
  };
  if (!sim.title.trim()) out.push({ where: "simulation", text: "Give the simulation a title." });
  if (!sim.traffic.length && !(sim.timeline ?? []).some((s) => s.action.do === "inject")) {
    out.push({ where: "simulation", text: "Nothing sends messages yet. Add a traffic profile." });
  }
  for (const p of sim.traffic) {
    missing(`traffic:${p.id}`, p.node, "Start");
    const s = p.shape;
    const bad =
      (s.kind === "burst" && !(s.count > 0)) ||
      (s.kind === "constant" && (!(s.ratePerSec > 0) || !(s.durationMs > 0))) ||
      (s.kind === "ramp" && !s.stages.some((st) => st.durationMs > 0)) ||
      (s.kind === "spike" && !(s.durationMs > 0));
    if (bad) out.push({ where: `traffic:${p.id}`, text: "This profile sends no messages." });
  }
  (sim.timeline ?? []).forEach((step, i) => {
    const a = step.action;
    if (a.do === "note") (a.focus ?? []).forEach((id) => missing(`timeline:${i}`, id, "Focus"));
    else if (a.do === "fault") {
      const f = a.fault;
      const valid =
        f.kind === "boundary"
          ? diagram.groups?.some((g) => g.id === f.boundary)
          : f.kind === "link"
            ? canCutLink(diagram, f.edge)
            : nodes.has(f.node);
      if (!valid) out.push({ where: `timeline:${i}`, text: t("fault.chooseTarget", { target: faultTarget(f) }) });
    } else missing(`timeline:${i}`, a.node, "Target");
    if (!(step.atMs >= 0)) out.push({ where: `timeline:${i}`, text: "Time must be zero or more." });
  });
  for (const e of sim.expectations ?? []) {
    if ("node" in e.metric) missing(`expectation:${e.id}`, e.metric.node, "Metric");
    if (!Number.isFinite(e.value)) out.push({ where: `expectation:${e.id}`, text: "Value must be a number." });
  }
  const ids = sim.traffic.map((p) => p.id);
  if (new Set(ids).size !== ids.length) out.push({ where: "simulation", text: "Two traffic profiles share an id." });
  return out;
}
