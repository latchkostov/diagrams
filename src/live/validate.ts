import { canCutLink, faultTarget } from "../model/faults";
import { t } from "../i18n";
// Warnings for a simulation against the diagram it runs on. The runner ignores unknown node ids,
// so a renamed node silently breaks a simulation; the authoring panel surfaces it instead.

import type { DiagramFile, Simulation } from "../model/types";

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
