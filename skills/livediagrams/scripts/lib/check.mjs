// Checks a diagrams/v1 diagram the way the app will read it, and stricter where a mistake would make a
// worse diagram. Every message says where the problem is and how to fix it. Standard library only, plus
// the app's own validator (./app.mjs, bundled by `pnpm schemas`): a diagram that passes here opens in the
// app exactly as written, with nothing dropped or repaired.
import { readFileSync } from "node:fs";
import { annotationGeometryError, LIMITS as L, simulationProblem, validateDiagram } from "./app.mjs";

/** Stencil ids, enums and property schemas, generated from the app (`pnpm schemas`). */
export const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8"));

const STENCILS = new Map(spec.stencils.map((s) => [s.id, s]));
const E = spec.enums;
const KNOWN_TOP = [
  "$schema",
  "format",
  "planning",
  "title",
  "description",
  "direction",
  "groups",
  "nodes",
  "edges",
  "simulations",
  "annotations",
  "layerOrder",
  "checks",
  "private",
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

/** Node ids a structurally valid simulation refers to, with where. */
function simulationRefs(sim) {
  const refs = [];
  sim.traffic.forEach((t, j) => refs.push([t.node, `traffic[${j}].node`]));
  (sim.timeline ?? []).forEach(({ action: a }, j) => {
    if (a.do === "note") (a.focus ?? []).forEach((id) => refs.push([id, `timeline[${j}].action.focus`]));
    else refs.push([a.node, `timeline[${j}].action.node`]);
  });
  for (const id of Object.keys(sim.setup?.status ?? {})) refs.push([id, "setup.status"]);
  for (const id of Object.keys(sim.setup?.props ?? {})) refs.push([id, "setup.props"]);
  (sim.expectations ?? []).forEach((x, j) => {
    if ("node" in x.metric) refs.push([x.metric.node, `expectations[${j}].metric.node`]);
  });
  return refs;
}

/**
 * The app's own structural check first (an invalid simulation is silently dropped when the app opens the
 * file), then references and live-view advice, which only ever see a structurally valid simulation.
 */
function checkSimulation(sim, i, nodeIds, nodes, errors, warnings) {
  const where = `simulations[${i}]${isObj(sim) && isStr(sim.title) ? ` ${q(sim.title)}` : ""}`;
  const problem = simulationProblem(sim);
  if (problem) return void errors.push(`${where}: ${problem}. The app would drop this simulation.`);
  for (const [id, what] of simulationRefs(sim))
    if (!nodeIds.has(id)) errors.push(`${where}: ${what} refers to ${q(id)}, which isn't a node id.`);
  // Short bursts may animate many dots briefly; sustained traffic should stay near 60 dots a second.
  const scale = sim.scale ?? 1;
  const multiplier = sim.multipliers?.traffic ?? 1;
  const sustained = sim.traffic.filter((t) => t.shape.kind !== "burst").reduce((s, t) => s + peak(t.shape), 0);
  const biggestBurst = Math.max(
    0,
    ...sim.traffic.filter((t) => t.shape.kind === "burst").map((t) => t.shape.count),
    ...(sim.timeline ?? []).map(({ action: a }) => (a.do === "inject" ? a.count : 0)),
  );
  if ((sustained * multiplier) / scale > 120 || (biggestBurst * multiplier) / scale > 1000) {
    const suggested = suggestedScale(sim, nodes);
    warnings.push(
      `${where}: at "scale": ${scale}${multiplier !== 1 ? ` with a traffic multiplier of ${multiplier}` : ""}, live view would animate too many dots. Use "scale": ${suggested} (one dot stands for ${suggested} messages).`,
    );
  }
}

/** The first path where two JSON values differ (an absent key equals undefined), or undefined. */
function firstDifference(a, b, path = "") {
  if (Object.is(a, b)) return undefined;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return path || "(the whole file)";
  if (Array.isArray(a) && a.length !== b.length) return `${path} (its length)`;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[key] === undefined && b[key] === undefined) continue;
    const at = Array.isArray(a) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    const diff = firstDifference(a[key], b[key], at);
    if (diff) return diff;
  }
  return undefined;
}

/**
 * Runs the app's own file validator: what it refuses, and anything it would drop, rename or repair when
 * the file or share link opens. A diagram with no problems here opens exactly as written.
 */
function appProblems(d) {
  const app = validateDiagram(d);
  if (!app.ok) return [`The app would refuse this file: ${app.error}`];
  const problems = app.warnings.map((w) => `The app would change this when it opens the file: ${w}`);
  if (problems.length) return problems;
  // Empty optional lists are dropped on open, which loses nothing.
  const emptyList = (key) => Array.isArray(d[key]) && !d[key].length;
  const written = Object.fromEntries(
    Object.entries(JSON.parse(JSON.stringify(d))).filter(([key]) =>
      ["groups", "annotations", "simulations"].includes(key) ? !emptyList(key) : true,
    ),
  );
  const diff = firstDifference(written, JSON.parse(JSON.stringify(app.diagram)));
  return diff ? [`The app would drop or change ${diff} when it opens the file. Remove it or fix its value.`] : [];
}

/**
 * Checks a parsed diagram. Returns { errors, warnings, summary }: the diagram is valid when there are no
 * errors. Warnings point at things that work but read badly or behave unexpectedly in live view.
 */
export function checkDiagram(d) {
  const errors = [];
  const warnings = [];
  if (!isObj(d)) return { errors: ["The file must hold one JSON object: the diagram."], warnings, summary: "" };
  if (d.format !== spec.format && d.format !== "diagrams/v2")
    errors.push(`"format" must be ${q(spec.format)}${d.format ? `, not ${q(d.format)}` : ""}.`);
  if (!isStr(d.title) || !d.title.trim()) errors.push('Add a "title" (a short string).');
  if (d.description !== undefined && !isStr(d.description)) errors.push('"description" must be a string.');
  if (d.direction !== undefined && !E.direction.includes(d.direction))
    errors.push(`"direction" must be ${list(E.direction)}.`);
  // The app keeps a diagram private unless "private" is plainly false; an agent writes true or leaves it out.
  if (d.private !== undefined && d.private !== true)
    errors.push('"private" must be true (a Private diagram), or leave it out.');
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
  if (exceedsDepth(d, L.maxDepth))
    return { errors: [`The diagram is nested more than ${L.maxDepth} levels deep.`], warnings, summary: "" };
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
    else {
      const geometry = annotationGeometryError(a);
      if (geometry)
        errors.push(
          `${where}: ${geometry.replace(/ Move the selection.*| Choose a smaller.*/, "")} The app would drop it.`,
        );
      else if (a.kind === "shape") shapeIds.add(a.id);
    }
    if (a.shape !== undefined && a.kind !== "shape") errors.push(`${where}: only a "shape" annotation takes "shape".`);
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

  const text = JSON.stringify(d);
  if (text.length > L.maxTextChars)
    errors.push(`The diagram is ${text.length} characters; the limit is ${L.maxTextChars}.`);
  // Last, the app's own reading: document-wide budgets, and anything it would refuse, drop or repair.
  if (!errors.length) errors.push(...appProblems(d));
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
  try {
    return { ...checkDiagram(data), diagram: data };
  } catch (err) {
    // A bug here must still leave a report, and let the next file be checked.
    return {
      errors: [
        `The checker failed on this file (${err.message}). Run validate.mjs on a simpler version to narrow it down.`,
      ],
      warnings: [],
      summary: "",
    };
  }
}
