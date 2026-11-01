import { t } from "../i18n";
import { stencilLabel } from "../i18n/stencils";
import type { DiagramFile } from "../model/types";
import { getStencil } from "../stencils/registry";
import { resolveMultiplier, resolveScale } from "../sim/units";
import { resolveSubjects } from "./checks";
import { equal, patchProps, readPath, resolve } from "./paths";
import type { Tutorial, TutorialStep } from "./types";

export interface BlueprintNode {
  subject: string;
  stencil: string;
  label: string;
  marks: number[];
}
export interface BlueprintEdge {
  from: string;
  to: string;
  marks: number[];
  subject?: string;
  label?: string;
}
export interface SettingChange {
  step: number;
  setting: string;
  before: unknown;
  after: unknown;
  detail?: string;
}
export interface Blueprint {
  kind: "drawing" | "settings" | "steps";
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  changes: SettingChange[];
}

/** Read-only projection of authored edits. Never runs demos, the editor or the simulation. */
export function buildBlueprint(lesson: Tutorial, initial: DiagramFile): Blueprint {
  const subjects = resolveSubjects(lesson, initial);
  const nodes = new Map<string, BlueprintNode>();
  const props = new Map<string, Record<string, unknown>>();
  const edges: BlueprintEdge[] = [];
  const changes: SettingChange[] = [];
  const inputs = new Map<string, number>();
  const start = lesson.start;
  let run = typeof start !== "function" ? initial.simulations?.find((s) => s.id === start.simulation) : undefined;
  const recordChange = (step: number, setting: string, before: unknown, after: unknown, detail?: string) => {
    const visit = (a: unknown, b: unknown, name = detail) => {
      if (equal(a, b)) return;
      if (Array.isArray(a) || Array.isArray(b)) {
        const left: unknown[] = Array.isArray(a) ? a : [],
          right: unknown[] = Array.isArray(b) ? b : [];
        for (let i = 0; i < Math.max(left.length, right.length); i++) visit(left[i], right[i], name);
      } else if ((a && typeof a === "object") || (b && typeof b === "object")) {
        const left = (a ?? {}) as Record<string, unknown>,
          right = (b ?? {}) as Record<string, unknown>;
        const label = typeof right.key === "string" ? right.key : typeof left.key === "string" ? left.key : name;
        // An optional configuration object enables a feature even when it has no explicit settings.
        if (a === undefined || b === undefined)
          changes.push({
            step,
            setting,
            before: a !== undefined,
            after: b !== undefined,
            ...(label ? { detail: label } : {}),
          });
        for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(left[key], right[key], label);
      } else changes.push({ step, setting, before: a, after: b, ...(name ? { detail: name } : {}) });
    };
    visit(before, after);
  };
  const mark = (marks: number[], step: number) => {
    if (!marks.includes(step)) marks.push(step);
  };
  for (const [subject, id] of Object.entries(subjects)) {
    const node = initial.nodes.find((n) => n.id === id);
    if (node) {
      nodes.set(subject, { subject, stencil: node.stencil, label: node.label, marks: [] });
      props.set(subject, { ...node.props });
    }
  }
  const subjectById = new Map(Object.entries(subjects).map(([subject, id]) => [id, subject]));
  for (const edge of initial.edges) {
    const from = subjectById.get(edge.from),
      to = subjectById.get(edge.to);
    if (from && to) edges.push({ from, to, marks: [], subject: subjectById.get(edge.id), label: edge.label });
  }
  const connect = (from: string, to: string, step: number, numbered = true) => {
    const existing = edges.find((e) => e.from === from && e.to === to);
    if (existing) {
      if (numbered) mark(existing.marks, step);
    } else if (nodes.has(from) && nodes.has(to)) {
      const subject = Object.entries(lesson.subjects).find(
        ([, spec]) => spec.edge?.[0] === from && spec.edge[1] === to,
      )?.[0];
      edges.push({ from, to, marks: numbered ? [step] : [], ...(subject ? { subject } : {}) });
    }
  };
  let drawing = false;
  for (const [index, step] of lesson.steps.entries()) {
    const number = index + 1;
    for (const demo of step.demo) {
      if (demo.kind === "add" || demo.kind === "insert" || demo.kind === "stencil") {
        drawing = true;
        const existing = nodes.get(demo.subject);
        nodes.set(demo.subject, {
          subject: demo.subject,
          stencil: demo.stencil,
          label: existing?.label ?? stencilLabel(getStencil(demo.stencil)),
          marks: [...(existing?.marks ?? []), number],
        });
        if (demo.kind === "add" && demo.after) connect(demo.after, demo.subject, number, false);
        if (demo.kind === "insert") {
          const old = edges.findIndex((e) => e.from === demo.edge[0] && e.to === demo.edge[1]);
          if (old >= 0) edges.splice(old, 1);
          connect(demo.edge[0], demo.subject, number, false);
          connect(demo.subject, demo.edge[1], number, false);
        }
      } else if (demo.kind === "connect") {
        drawing = true;
        connect(demo.from, demo.to, number);
      } else if (demo.kind === "reconnect") {
        const edge = edges.find((e) => e.from === demo.edge[0] && e.to === demo.edge[1]);
        if (edge && nodes.has(demo.to)) {
          drawing = true;
          edge.to = demo.to;
          mark(edge.marks, number);
        }
      } else if (demo.kind === "rename") {
        const node = nodes.get(demo.subject);
        if (node) {
          drawing = true;
          node.label = demo.label();
          mark(node.marks, number);
        }
        const edge = edges.find((e) => e.subject === demo.subject);
        if (edge) {
          drawing = true;
          edge.label = demo.label();
          mark(edge.marks, number);
        }
      } else if (demo.kind === "remove") {
        drawing = true;
        nodes.delete(demo.subject);
        for (let i = edges.length - 1; i >= 0; i--)
          if (edges[i].from === demo.subject || edges[i].to === demo.subject) edges.splice(i, 1);
      } else if (demo.kind === "prop" || demo.kind === "patch") {
        const edge = demo.edge;
        const key = demo.subject ?? demo.edge.join("→");
        const initialProps = !edge
          ? (props.get(key) ?? {})
          : (initial.edges.find((e) => e.from === subjects[edge[0]] && e.to === subjects[edge[1]])?.props ?? {});
        const before = props.get(key) ?? initialProps;
        const update = demo.kind === "prop" ? demo.props : patchProps(before, demo.patches);
        const after = { ...before, ...update };
        const paths =
          demo.kind === "prop" ? Object.keys(demo.props).map((key) => [key] as const) : demo.patches.map((p) => p.path);
        for (const path of paths) {
          const a = readPath(before, path),
            b = readPath(after, path);
          const selector = path.find((part) => typeof part === "object");
          const detail =
            typeof selector === "object" ? Object.values(selector.where).map(resolve).join(" · ") : undefined;
          recordChange(number, step.title(), a, b, detail);
        }
        props.set(key, after);
      } else if (demo.kind === "field") {
        const node = initial.nodes.find((n) => n.id === subjects[demo.subject]);
        recordChange(number, step.title(), node?.[demo.field], demo.value());
      } else if (demo.kind === "runSimulation") {
        run = initial.simulations?.find((s) => s.id === demo.id);
        inputs.clear();
      } else if (demo.kind === "inputs") {
        const saved =
          demo.input === "scale" ? resolveScale(run?.scale) : resolveMultiplier(run?.multipliers?.[demo.input]);
        recordChange(number, step.title(), inputs.get(demo.input) ?? saved, demo.value);
        inputs.set(demo.input, demo.value);
      }
    }
  }
  const kind = drawing || !changes.length ? (nodes.size ? "drawing" : "steps") : "settings";
  return { kind, nodes: [...nodes.values()], edges, changes };
}

/** The input this step teaches, omitting setup clicks and settlement Enter presses. */
export function stepInput(step: TutorialStep): string {
  for (const ui of step.solution) {
    if ("pane" in ui || "dblclick" in ui) return t("tutorials.handoff.doubleClick");
    if ("drag" in ui) return t("tutorials.handoff.drag");
    if ("boxSelect" in ui) return t("tutorials.handoff.drag");
    if ("rightclick" in ui) return t("tutorials.handoff.rightClick");
    if ("hover" in ui) return t("tutorials.handoff.hover");
    if ("pan" in ui) return t("tutorials.handoff.pan");
    if ("history" in ui) return `[ControlOrMeta]+[${ui.history === "undo" ? "Z" : "Y"}]`;
    if ("modClick" in ui)
      return `${ui.modifiers.map((key) => `[${key === "Control" ? "ControlOrMeta" : key}]`).join("+")} ${t("tutorials.handoff.click")}`;
    if ("press" in ui && (ui.press.includes("+") || ui.press.length === 1 || /^F\d+$/.test(ui.press)))
      return ui.press
        .split("+")
        .map((key) => `[${key}]`)
        .join("+");
    if ("fill" in ui || "type" in ui) return t("tutorials.handoff.type");
    if ("select" in ui) return t("tutorials.handoff.choose");
  }
  return (
    step.coach?.routes.find((route) => route.kind === "keyboard")?.summary() ??
    (step.solution.length ? t("tutorials.handoff.click") : t("tutorials.handoff.observe"))
  );
}

/** Flow columns preserve forks and direction; a cycle gets its own column, never an invented connecting wire. */
export function blueprintLayout(blueprint: Blueprint) {
  // A loose node belongs beside the flow, not in a second row that makes a small preview unreadable.
  const loose = blueprint.nodes.filter((n) => !blueprint.edges.some((e) => e.from === n.subject || e.to === n.subject));
  const remaining = new Set(blueprint.nodes.filter((n) => !loose.includes(n)).map((n) => n.subject));
  const positions = new Map<string, { x: number; y: number }>();
  let column = 0,
    rows = 1;
  while (remaining.size) {
    const ready = [...remaining].filter((id) => !blueprint.edges.some((e) => e.to === id && remaining.has(e.from)));
    if (!ready.length) ready.push(remaining.values().next().value!);
    ready.forEach((id, row) => {
      positions.set(id, { x: 16 + column * 176, y: 26 + row * 82 });
      remaining.delete(id);
    });
    rows = Math.max(rows, ready.length);
    column++;
  }
  for (const node of loose) positions.set(node.subject, { x: 16 + column++ * 176, y: 26 });
  return {
    positions,
    width: Math.max(176, column * 176),
    height: rows * 82 + (blueprint.edges.some((edge) => edge.label) ? 18 : 0),
  };
}
