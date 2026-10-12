// Checks a diagrams/v1 diagram the way the app will read it, and stricter where a mistake would make a
// worse diagram. Every message says where the problem is and how to fix it. Standard library only.
import { readFileSync } from "node:fs";

/** Stencil ids, enums, limits and property schemas, generated from the app (`pnpm schemas`). */
export const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8"));

const STENCILS = new Map(spec.stencils.map((s) => [s.id, s]));
const E = spec.enums;
const L = spec.limits;
const KNOWN_TOP = [
  "$schema",
  "format",
  "title",
  "description",
  "direction",
  "groups",
  "nodes",
  "edges",
  "simulations",
  "annotations",
  "layerOrder",
];
const BROKERS = new Set(["topic", "queue", "stream"]);

/** Drops a leading byte-order mark, which some editors write. */
export const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
const q = (v) => JSON.stringify(v);
const list = (values) => values.map((v) => q(v)).join(", ");
const roleOf = (stencil) => STENCILS.get(stencil)?.role ?? "processor";

function exceedsDepth(value, max) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (typeof v !== "object" || v === null) continue;
    if (d >= max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, d + 1]);
  }
  return false;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** Up to three stencils that look like what was meant. */
export function suggestStencils(wanted, label = "") {
  const words = (s) =>
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1);
  const asked = words(wanted);
  const hint = words(label);
  const scored = spec.stencils.map((s) => {
    const own = new Set([...words(s.id), ...words(s.label), ...(s.aliases ?? []).flatMap(words)]);
    let score = asked.filter((w) => own.has(w)).length * 3 + hint.filter((w) => own.has(w)).length;
    const d = editDistance(String(wanted).toLowerCase(), s.id);
    if (d <= 3) score += 6 - d;
    if ((s.aliases ?? []).some((a) => a.toLowerCase() === String(wanted).toLowerCase())) score += 5;
    return { s, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .slice(0, 3)
    .map((x) => x.s);
}

/** Checks a value against one of the generated property schemas (type, range, enum). */
function propProblem(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((s) => !propProblem(value, s)) ? undefined : "has the wrong type";
  if (schema.type === "number" || schema.type === "integer") {
    if (!isNum(value) || (schema.type === "integer" && !Number.isInteger(value))) return `must be a ${schema.type}`;
    if (isNum(schema.minimum) && value < schema.minimum) return `must be at least ${schema.minimum}`;
    if (isNum(schema.maximum) && value > schema.maximum) return `must be at most ${schema.maximum}`;
  } else if (schema.type === "string") {
    if (!isStr(value)) return "must be a string";
    if (schema.enum && !schema.enum.includes(value)) return `must be one of ${list(schema.enum)}`;
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") return "must be true or false";
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || (schema.items?.type === "string" && !value.every(isStr)))
      return "must be a list of strings";
  } else if (schema.type === "object") {
    if (!isObj(value) || (schema.additionalProperties?.type === "string" && !Object.values(value).every(isStr)))
      return "must be an object of strings";
  }
  return undefined;
}

function checkProps(props, schemas, where, errors) {
  if (props === undefined) return;
  if (!isObj(props)) return void errors.push(`${where}: "props" must be an object.`);
  for (const [key, value] of Object.entries(props)) {
    const schema = schemas[key];
    const problem = schema && propProblem(value, schema);
    if (problem) errors.push(`${where}: props.${key} ${problem} (it is ${q(value)}).`);
  }
}

const peak = (shape) => {
  const p = (n) => (isNum(n) ? Math.max(0, n) : 0);
  switch (shape?.kind) {
    case "constant":
      return p(shape.ratePerSec);
    case "spike":
      return Math.max(p(shape.baseRate), p(shape.peakRate));
    case "ramp":
      return Math.max(p(shape.startRate), ...(shape.stages ?? []).map((s) => p(s?.targetRate)));
    case "burst":
      return (p(shape.count) * 1000) / (p(shape.spreadMs) ? Math.max(1, p(shape.spreadMs)) : 1000);
    default:
      return 0;
  }
};

/** The `scale` the app would choose (src/sim/scale.ts autoScale): about 60 animated dots a second at most. */
export function suggestedScale(sim, nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  const traffic = Array.isArray(sim.traffic) ? sim.traffic : [];
  let rate = traffic.reduce((sum, t) => sum + (ids.has(t?.node) ? peak(t.shape) : 0), 0);
  for (const step of Array.isArray(sim.timeline) ? sim.timeline : [])
    if (step?.action?.do === "inject" && ids.has(step.action.node))
      rate += peak({ kind: "burst", count: step.action.count, spreadMs: step.action.spreadMs });
  const multiplier = isNum(sim.multipliers?.traffic) ? Math.max(0, sim.multipliers.traffic) : 1;
  const required = (rate * multiplier) / 60;
  if (!(required > 1)) return 1;
  const power = 10 ** Math.floor(Math.log10(required));
  return [1, 2, 5, 10].find((v) => v * power >= required) * power;
}

/** Messages a simulation sends in total (rate × duration, bursts and injections). */
function volume(sim) {
  let messages = 0;
  for (const { shape: sh } of sim.traffic ?? []) {
    if (!isObj(sh)) continue;
    if (sh.kind === "burst") messages += sh.count ?? 0;
    else if (sh.kind === "constant") messages += ((sh.ratePerSec ?? 0) * (sh.durationMs ?? 0)) / 1000;
    else if (sh.kind === "spike")
      messages += (Math.max(sh.baseRate ?? 0, sh.peakRate ?? 0) * (sh.durationMs ?? 0)) / 1000;
    else if (sh.kind === "ramp") {
      let previous = sh.startRate ?? 0;
      for (const st of sh.stages ?? []) {
        messages += (Math.max(previous, st?.targetRate ?? 0) * (st?.durationMs ?? 0)) / 1000;
        previous = st?.targetRate ?? 0;
      }
    }
  }
  for (const step of sim.timeline ?? []) if (step?.action?.do === "inject") messages += step.action.count ?? 0;
  return messages * Math.max(1, isNum(sim.multipliers?.traffic) ? sim.multipliers.traffic : 1);
}

function checkSimulation(sim, i, nodeIds, nodes, errors, warnings) {
  const where = `simulations[${i}]${isObj(sim) && isStr(sim.title) ? ` ${q(sim.title)}` : ""}`;
  const err = (m) => errors.push(`${where}: ${m}`);
  if (!isObj(sim)) return err("must be an object.");
  if (!isStr(sim.id) || !sim.id) err('needs an "id".');
  if (!isStr(sim.title)) err('needs a "title".');
  const time = (v) => isNum(v) && v >= 0 && v <= L.maxSimulationMs;
  const optTime = (v) => v === undefined || time(v);
  const count = (v) => Number.isSafeInteger(v) && v >= 0 && v <= L.maxMessageCount;
  const rate = (v) => isNum(v) && v >= 0 && v <= L.maxRatePerSec;
  const nodeRef = (id, what) => {
    if (!nodeIds.has(id)) err(`${what} refers to ${q(id)}, which isn't a node id.`);
  };
  if (!optTime(sim.durationMs)) err(`"durationMs" must be 0 to ${L.maxSimulationMs} ms.`);
  if (sim.scale !== undefined && (!isNum(sim.scale) || sim.scale < 1)) err('"scale" must be a number of at least 1.');
  if (!Array.isArray(sim.traffic)) err('needs a "traffic" list (it may be empty).');
  for (const [j, t] of (Array.isArray(sim.traffic) ? sim.traffic : []).entries()) {
    const w = `traffic[${j}]`;
    if (!isObj(t) || !isStr(t.id) || !isStr(t.node)) {
      err(`${w} needs an "id", a "node" and a "shape".`);
      continue;
    }
    nodeRef(t.node, `${w}.node`);
    const sh = t.shape;
    const bad = (m) => err(`${w}.shape: ${m}`);
    if (!isObj(sh)) bad('needs a "kind": burst, constant, ramp or spike.');
    else if (sh.kind === "burst") {
      if (!count(sh.count)) bad(`"count" must be a whole number up to ${L.maxMessageCount}.`);
      if (!optTime(sh.atMs) || !optTime(sh.spreadMs)) bad('"atMs" and "spreadMs" must be valid times in ms.');
    } else if (sh.kind === "constant") {
      if (!rate(sh.ratePerSec)) bad(`"ratePerSec" must be 0 to ${L.maxRatePerSec}.`);
      if (!time(sh.durationMs) || !optTime(sh.fromMs)) bad('needs "durationMs" (and an optional "fromMs") in ms.');
    } else if (sh.kind === "ramp") {
      if (!optTime(sh.fromMs) || (sh.startRate !== undefined && !rate(sh.startRate)))
        bad('"fromMs" or "startRate" is invalid.');
      if (!Array.isArray(sh.stages) || !sh.stages.every((s) => isObj(s) && time(s.durationMs) && rate(s.targetRate)))
        bad('"stages" must be a list of { "durationMs", "targetRate" }.');
    } else if (sh.kind === "spike") {
      if (![sh.baseRate, sh.peakRate].every(rate) || ![sh.atMs, sh.peakMs, sh.durationMs].every(time))
        bad('needs "baseRate", "peakRate", "atMs", "peakMs" and "durationMs".');
    } else bad(`unknown kind ${q(sh.kind)}; use burst, constant, ramp or spike.`);
  }
  if (sim.timeline !== undefined && !Array.isArray(sim.timeline)) err('"timeline" must be a list.');
  for (const [j, step] of (Array.isArray(sim.timeline) ? sim.timeline : []).entries()) {
    const w = `timeline[${j}]`;
    if (!isObj(step) || !time(step.atMs) || !isObj(step.action)) {
      err(`${w} needs "atMs" (0 to ${L.maxSimulationMs}) and an "action".`);
      continue;
    }
    const a = step.action;
    if (a.do !== "note") {
      if (!isStr(a.node)) err(`${w}.action needs a "node".`);
      else nodeRef(a.node, `${w}.action.node`);
    }
    if (a.do === "note") {
      if (!isStr(a.text)) err(`${w}: a note needs "text".`);
      if (a.focus !== undefined && !(Array.isArray(a.focus) && a.focus.every(isStr)))
        err(`${w}: "focus" must be a list of node ids.`);
      for (const id of Array.isArray(a.focus) ? a.focus.filter(isStr) : []) nodeRef(id, `${w}.action.focus`);
      if (a.pause !== undefined && typeof a.pause !== "boolean") err(`${w}: "pause" must be true or false.`);
    } else if (a.do === "status") {
      if (!E.status.includes(a.status)) err(`${w}: "status" must be one of ${list(E.status)}.`);
    } else if (a.do === "props") {
      checkProps(a.props, spec.nodeProps, `${w}.action`, errors);
      if (!isObj(a.props)) err(`${w}: a props action needs "props".`);
    } else if (a.do === "inject") {
      if (!count(a.count)) err(`${w}: "count" must be a whole number up to ${L.maxMessageCount}.`);
      if (!optTime(a.spreadMs)) err(`${w}: "spreadMs" must be a time in ms.`);
    } else if (a.do !== "trace") err(`${w}: unknown action ${q(a.do)}; use status, props, inject, note or trace.`);
  }
  if (sim.expectations !== undefined && !Array.isArray(sim.expectations)) err('"expectations" must be a list.');
  for (const [j, x] of (Array.isArray(sim.expectations) ? sim.expectations : []).entries()) {
    const w = `expectations[${j}]`;
    if (!isObj(x) || !isStr(x.id) || !isStr(x.label) || !isObj(x.metric) || !isNum(x.value)) {
      err(`${w} needs "id", "label", "metric", "op" and a numeric "value".`);
      continue;
    }
    if (!E.op.includes(x.op)) err(`${w}: "op" must be one of ${list(E.op)}.`);
    const m = x.metric;
    if (m.system !== undefined) {
      if (m.system !== "inSystem") err(`${w}: a system metric is { "system": "inSystem" }.`);
    } else {
      if (!isStr(m.node)) err(`${w}.metric needs a "node".`);
      else nodeRef(m.node, `${w}.metric.node`);
      if (!E.metric.includes(m.field)) err(`${w}.metric: "field" must be one of ${list(E.metric)}.`);
    }
    if (x.when !== undefined && !E.when.includes(x.when)) err(`${w}: "when" must be one of ${list(E.when)}.`);
    if (x.when === "at" && !time(x.atMs)) err(`${w}: "when": "at" needs "atMs".`);
  }
  if (sim.setup !== undefined) {
    if (!isObj(sim.setup)) err('"setup" must be an object.');
    else {
      for (const [id, status] of Object.entries(isObj(sim.setup.status) ? sim.setup.status : {})) {
        nodeRef(id, "setup.status");
        if (!E.status.includes(status)) err(`setup.status.${id} must be one of ${list(E.status)}.`);
      }
      for (const [id, p] of Object.entries(isObj(sim.setup.props) ? sim.setup.props : {})) {
        nodeRef(id, "setup.props");
        checkProps(p, spec.nodeProps, `${where} setup.props.${id}`, errors);
      }
    }
  }
  if (Array.isArray(sim.traffic)) {
    // Short bursts may animate many dots briefly; sustained traffic should stay near 60 dots a second.
    const scale = isNum(sim.scale) && sim.scale >= 1 ? sim.scale : 1;
    const sustained = sim.traffic
      .filter((t) => isObj(t) && t.shape?.kind !== "burst")
      .reduce((s, t) => s + peak(t.shape), 0);
    const biggestBurst = Math.max(
      0,
      ...sim.traffic.filter((t) => isObj(t) && t.shape?.kind === "burst").map((t) => t.shape.count ?? 0),
      ...(Array.isArray(sim.timeline) ? sim.timeline : []).map((s) =>
        s?.action?.do === "inject" ? (s.action.count ?? 0) : 0,
      ),
    );
    if (sustained / scale > 120 || biggestBurst / scale > 1000) {
      const suggested = suggestedScale(sim, nodes);
      warnings.push(
        `${where}: at "scale": ${scale} live view would animate too many dots. Add "scale": ${suggested} (one dot stands for ${suggested} messages).`,
      );
    }
  }
}

/**
 * Checks a parsed diagram. Returns { errors, warnings, summary }: the diagram is valid when there are no
 * errors. Warnings point at things that work but read badly or behave unexpectedly in live view.
 */
export function checkDiagram(d) {
  const errors = [];
  const warnings = [];
  if (!isObj(d)) return { errors: ["The file must hold one JSON object: the diagram."], warnings, summary: "" };
  if (d.format !== spec.format)
    errors.push(`"format" must be ${q(spec.format)}${d.format ? `, not ${q(d.format)}` : ""}.`);
  if (!isStr(d.title) || !d.title.trim()) errors.push('Add a "title" (a short string).');
  if (d.description !== undefined && !isStr(d.description)) errors.push('"description" must be a string.');
  if (d.direction !== undefined && !E.direction.includes(d.direction))
    errors.push(`"direction" must be ${list(E.direction)}.`);
  for (const key of Object.keys(d))
    if (!KNOWN_TOP.includes(key)) warnings.push(`Unknown top-level field ${q(key)}: the app keeps it but ignores it.`);
  if (!Array.isArray(d.nodes)) errors.push('"nodes" must be a list.');
  if (!Array.isArray(d.edges)) errors.push('"edges" must be a list (it may be empty: "edges": []).');
  if (errors.length && (!Array.isArray(d.nodes) || !Array.isArray(d.edges))) return { errors, warnings, summary: "" };
  const counts = [
    ["nodes", L.maxNodes],
    ["edges", L.maxEdges],
    ["groups", L.maxGroups],
    ["annotations", L.maxAnnotations],
    ["simulations", L.maxSimulations],
  ];
  for (const [key, max] of counts)
    if (Array.isArray(d[key]) && d[key].length > max)
      errors.push(`${q(key)} has ${d[key].length} entries; the limit is ${max}.`);
  if (exceedsDepth(d, L.maxDepth)) errors.push(`The diagram is nested more than ${L.maxDepth} levels deep.`);
  for (const key of ["groups", "annotations", "simulations", "layerOrder"])
    if (d[key] !== undefined && !Array.isArray(d[key])) errors.push(`${q(key)} must be a list.`);

  const groups = Array.isArray(d.groups) ? d.groups : [];
  const annotations = Array.isArray(d.annotations) ? d.annotations : [];
  const ids = new Map(); // id -> what owns it
  const claim = (id, what, where) => {
    if (ids.has(id)) errors.push(`${where}: the id ${q(id)} is already used by ${ids.get(id)}. Ids must be unique.`);
    else ids.set(id, what);
  };
  const box = (o) => ["x", "y", "width", "height"].every((k) => isNum(o[k]));
  const tooFar = (...vals) => vals.some((v) => isNum(v) && Math.abs(v) > L.maxCoordinate);
  let unplacedGroups = 0;
  let unplacedNodes = 0;

  // Boundaries
  const groupIds = new Set();
  groups.forEach((g, i) => {
    const where = `groups[${i}]${isObj(g) && isStr(g.id) ? ` ${q(g.id)}` : ""}`;
    if (!isObj(g) || !isStr(g.id) || !g.id) return void errors.push(`${where}: a boundary needs an "id".`);
    claim(g.id, `boundary ${q(g.id)}`, where);
    groupIds.add(g.id);
    if (!isStr(g.label)) errors.push(`${where}: add a "label".`);
    if (g.tone !== undefined && !E.tone.includes(g.tone))
      errors.push(`${where}: "tone" must be one of ${list(E.tone)}.`);
    if (!box(g)) unplacedGroups++;
    else if (g.width < 0 || g.height < 0 || tooFar(g.x, g.y, g.width, g.height))
      errors.push(`${where}: its box is out of range.`);
  });

  // Nodes
  const nodes = [];
  d.nodes.forEach((n, i) => {
    const where = `nodes[${i}]${isObj(n) && isStr(n.id) ? ` ${q(n.id)}` : ""}`;
    if (!isObj(n) || !isStr(n.id) || !n.id) return void errors.push(`${where}: a node needs an "id".`);
    claim(n.id, `node ${q(n.id)}`, where);
    nodes.push(n);
    if (!isStr(n.stencil)) errors.push(`${where}: add a "stencil" id from reference/stencils.md.`);
    else if (!STENCILS.has(n.stencil)) {
      const near = suggestStencils(n.stencil, n.label);
      errors.push(
        `${where}: unknown stencil ${q(n.stencil)}.${near.length ? ` Did you mean ${near.map((s) => `${s.id} (${s.label})`).join(", ")}?` : ""} Stencil ids are in reference/stencils.md.`,
      );
    }
    if (!isStr(n.label)) errors.push(`${where}: add a "label" (a string).`);
    else if (!n.label.trim()) warnings.push(`${where}: the label is empty.`);
    else if (n.label.length > 28)
      warnings.push(
        `${where}: the label is ${n.label.length} characters and will be cut off; move detail to "sublabel".`,
      );
    if (n.sublabel !== undefined && !isStr(n.sublabel)) errors.push(`${where}: "sublabel" must be a string.`);
    else if (isStr(n.sublabel) && n.sublabel.length > 56)
      warnings.push(`${where}: the sublabel is ${n.sublabel.length} characters; about 56 fit on two lines.`);
    if (!isNum(n.x) || !isNum(n.y)) unplacedNodes++;
    else if (tooFar(n.x, n.y)) errors.push(`${where}: x and y must be within ±${L.maxCoordinate}.`);
    if (n.group !== undefined && !groupIds.has(n.group))
      errors.push(`${where}: "group" is ${q(n.group)}, but there's no boundary with that id in "groups".`);
    checkProps(n.props, spec.nodeProps, where, errors);
  });
  if (unplacedNodes)
    errors.push(
      `${unplacedNodes} of ${nodes.length} nodes have no x and y. Run: node scripts/layout.mjs <file> (it lays the diagram out in place).`,
    );
  if (unplacedGroups)
    errors.push(`${unplacedGroups} boundaries have no box (x, y, width, height). Run: node scripts/layout.mjs <file>.`);
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Annotations
  const shapeIds = new Set();
  annotations.forEach((a, i) => {
    const where = `annotations[${i}]${isObj(a) && isStr(a.id) ? ` ${q(a.id)}` : ""}`;
    if (!isObj(a) || !isStr(a.id) || !a.id) return void errors.push(`${where}: an annotation needs an "id".`);
    claim(a.id, `annotation ${q(a.id)}`, where);
    if (!E.annotationKind.includes(a.kind)) errors.push(`${where}: "kind" must be one of ${list(E.annotationKind)}.`);
    if (!isStr(a.text)) errors.push(`${where}: add "text".`);
    if (!box(a))
      errors.push(
        `${where}: needs x, y, width and height.${a.kind === "note" || a.kind === "text" ? " Run node scripts/layout.mjs <file> to place it." : ""}`,
      );
    if (a.kind === "shape") shapeIds.add(a.id);
    for (const [key, values] of [
      ["shape", E.annotationShape],
      ["color", E.annotationColor],
      ["textSize", E.textSize],
    ])
      if (a[key] !== undefined && !values.includes(a[key]))
        errors.push(`${where}: "${key}" must be one of ${list(values)}.`);
  });

  // Edges
  const edgeIds = new Set();
  const seenPairs = new Set();
  const flowOut = new Map();
  d.edges.forEach((e, i) => {
    const where = `edges[${i}]${isObj(e) && isStr(e.id) ? ` ${q(e.id)}` : ""}`;
    if (!isObj(e) || !isStr(e.id) || !e.id || !isStr(e.from) || !isStr(e.to))
      return void errors.push(`${where}: an edge needs an "id", a "from" and a "to".`);
    if (edgeIds.has(e.id)) errors.push(`${where}: another edge already has the id ${q(e.id)}.`);
    else if (ids.has(e.id)) errors.push(`${where}: the id ${q(e.id)} is already used by ${ids.get(e.id)}.`);
    edgeIds.add(e.id);
    for (const end of ["from", "to"]) {
      const id = e[end];
      if (nodeIds.has(id) || shapeIds.has(id)) continue;
      const owner = ids.get(id);
      errors.push(
        owner
          ? `${where}: "${end}" is ${owner}; edges connect nodes (or shape annotations).`
          : `${where}: "${end}" is ${q(id)}, which isn't a node id.`,
      );
    }
    if (e.from === e.to) warnings.push(`${where}: it connects ${q(e.from)} to itself.`);
    if (e.kind !== undefined && !E.edgeKind.includes(e.kind))
      errors.push(`${where}: "kind" must be ${list(E.edgeKind)}.`);
    if (e.relation !== undefined && !E.relation.includes(e.relation))
      errors.push(`${where}: "relation" must be one of ${list(E.relation)} (leave it out for a flow).`);
    for (const side of ["sourceSide", "targetSide"])
      if (e[side] !== undefined && !E.side.includes(e[side]))
        errors.push(`${where}: "${side}" must be one of ${list(E.side)}.`);
    if (e.label !== undefined && !isStr(e.label)) errors.push(`${where}: "label" must be a string.`);
    checkProps(e.props, spec.edgeProps, where, errors);
    const pair = `${e.from}\u0000${e.to}\u0000${e.relation ?? "flow"}`;
    if (seenPairs.has(pair)) warnings.push(`${where}: a second edge from ${q(e.from)} to ${q(e.to)}.`);
    seenPairs.add(pair);
    if ((e.relation ?? "flow") === "flow") flowOut.set(e.from, (flowOut.get(e.from) ?? 0) + 1);
  });
  // A broker nobody consumes from fills up in live view, unless it's a dead-letter destination.
  const dlqTargets = new Set(d.edges.filter((e) => isObj(e) && e.props?.dlq === true).map((e) => e.to));
  for (const n of nodes) {
    if (!isStr(n.stencil) || !BROKERS.has(roleOf(n.stencil)) || flowOut.get(n.id) || dlqTargets.has(n.id)) continue;
    if (/dlq|dead.?letter|poison|quarantine/i.test(`${n.label ?? ""} ${n.sublabel ?? ""}`)) continue;
    warnings.push(`Node ${q(n.id)} (${roleOf(n.stencil)}) has no consumer, so messages pile up there in live view.`);
  }

  // Boundary boxes should hold their members.
  for (const g of groups) {
    if (!isObj(g) || !box(g)) continue;
    const members = nodes.filter((n) => n.group === g.id);
    if (!members.length) warnings.push(`Boundary ${q(g.id)} has no member nodes (set "group": ${q(g.id)} on them).`);
    for (const n of members)
      if (
        isNum(n.x) &&
        isNum(n.y) &&
        (n.x < g.x || n.y < g.y || n.x + 220 > g.x + g.width || n.y + 72 > g.y + g.height)
      )
        warnings.push(
          `Node ${q(n.id)} is outside its boundary ${q(g.id)}'s box. Run node scripts/layout.mjs <file> --force, or widen the box.`,
        );
  }

  if (Array.isArray(d.layerOrder))
    for (const id of d.layerOrder)
      if (!nodeIds.has(id) && !annotations.some((a) => a?.id === id))
        warnings.push(`"layerOrder" names ${q(id)}, which isn't a node or annotation; the app drops it.`);

  // Simulations
  const sims = Array.isArray(d.simulations) ? d.simulations : [];
  const simIds = new Set();
  sims.forEach((sim, i) => {
    checkSimulation(sim, i, nodeIds, nodes, errors, warnings);
    if (isObj(sim) && isStr(sim.id)) {
      if (simIds.has(sim.id)) errors.push(`simulations[${i}]: another simulation already has the id ${q(sim.id)}.`);
      simIds.add(sim.id);
    }
  });
  const total = sims.filter(isObj).reduce((sum, sim) => sum + volume(sim), 0);
  if (total > L.maxTrafficVolume)
    errors.push(
      `The simulations send about ${Math.round(total)} messages in all; the limit is ${L.maxTrafficVolume}. Lower the rates or durations.`,
    );

  const text = JSON.stringify(d);
  if (text.length > L.maxTextChars)
    errors.push(`The diagram is ${text.length} characters; the limit is ${L.maxTextChars}.`);
  if (nodes.length > 30)
    warnings.push(`${nodes.length} nodes: consider a smaller diagram, or split it into several, so it stays readable.`);

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const summary = `${plural(nodes.length, "node")}, ${plural(d.edges.length, "edge")}${groups.length ? `, ${plural(groups.length, "boundary", "boundaries")}` : ""}${sims.length ? `, ${plural(sims.length, "simulation")}` : ""}`;
  return { errors, warnings, summary };
}

/** Reads and checks a .diagram.json file. Never throws for a bad file: problems come back as errors. */
export function checkFile(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    return { errors: [`Can't read ${file}: ${err.message}`], warnings: [], summary: "" };
  }
  let data;
  try {
    data = JSON.parse(stripBom(text));
  } catch (err) {
    return { errors: [`It isn't valid JSON: ${err.message}`], warnings: [], summary: "" };
  }
  return { ...checkDiagram(data), diagram: data };
}
