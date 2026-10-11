import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";

// The native format (diagrams/v1): versioned validation with friendly messages, a migration hook
// for future formats, and preservation of fields this version doesn't know about (a newer app, or
// a hand-edited file, may add some; we keep them instead of silently dropping them).

export type NativeResult = { ok: true; diagram: DiagramFile; warnings: string[] } | { ok: false; error: string };

/**
 * Budgets for untrusted input (files, pastes, share links, Drive, storage). Generous for real
 * diagrams, small enough that a hostile payload can't freeze the tab or blow the stack later
 * (JSON.stringify of a deeply nested object throws RangeError).
 */
export const LIMITS = {
  /** Characters of text we're willing to parse (files are checked by size before reading). */
  maxTextChars: 8_000_000,
  /** Bytes a compressed payload (share link, draw.io page) may inflate to. */
  maxInflatedBytes: 16_000_000,
  maxDepth: 48,
  maxNodes: 5_000,
  maxEdges: 20_000,
  maxGroups: 1_000,
  maxSimulations: 200,
} as const;

/** Iterative depth check (no recursion, so it can't overflow on hostile input). */
export function exceedsDepth(value: unknown, max: number = LIMITS.maxDepth): boolean {
  const stack: [unknown, number][] = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (typeof v !== "object" || v === null) continue;
    if (d >= max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v))
      if (typeof child === "object" && child !== null) stack.push([child, d + 1]);
  }
  return false;
}

export const tooLargeMessage = (chars: number) =>
  `It's too large to open (${(chars / 1_000_000).toFixed(1)} MB; the limit is ${LIMITS.maxTextChars / 1_000_000} MB).`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Upgrades from older formats, keyed by the format they read. Each step returns the next format's
 * raw object; `migrate` chains them until it reaches DIAGRAM_FORMAT. Empty today: v1 is the first
 * shipped format. When v2 lands, add `"diagrams/v1": (raw) => ({ ...raw, format: "diagrams/v2", ... })`.
 */
export const MIGRATIONS: Record<string, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

class FormatError extends Error {}

/** Brings any supported raw object up to the current format, or throws with a helpful message. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let cur = raw;
  for (let hops = 0; cur.format !== DIAGRAM_FORMAT; hops++) {
    const step = typeof cur.format === "string" ? MIGRATIONS[cur.format] : undefined;
    if (!step || hops > 20) {
      const found = cur.format;
      if (typeof found === "string" && /^diagrams\/v\d+$/.test(found)) {
        throw new FormatError(
          `This file uses ${found}, which is newer than this version of Diagrams understands (expected format "${DIAGRAM_FORMAT}"). Reload the page to get the latest version.`,
        );
      }
      const shown = typeof found === "string" ? `"${found}"` : "missing";
      throw new FormatError(
        `Expected format "${DIAGRAM_FORMAT}", but it was ${shown}. Export a diagram from this app to get a compatible file.`,
      );
    }
    cur = step(cur);
  }
  return cur;
}

const SIDES = new Set(["top", "right", "bottom", "left"]);
const TONES = new Set(["azure", "aws", "gcp", "k8s", "onprem", "neutral"]);

const describe = (kind: string, index: number, id: unknown) =>
  `${kind} #${index + 1}${typeof id === "string" && id ? ` ("${id}")` : ""}`;

/** Validates (and gently repairs) a parsed object. Unknown fields are kept untouched. */
export function validateDiagram(data: unknown): NativeResult {
  if (!isObj(data)) return { ok: false, error: "That file doesn't contain a diagram object." };
  let raw: Record<string, unknown>;
  try {
    raw = migrate(data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!Array.isArray(raw.nodes)) return { ok: false, error: "The diagram needs both a nodes and an edges list." };
  if (exceedsDepth(raw))
    return { ok: false, error: `It's nested too deeply to be a diagram (more than ${LIMITS.maxDepth} levels).` };
  const counts: [unknown, number, string][] = [
    [raw.nodes, LIMITS.maxNodes, "nodes"],
    [raw.edges, LIMITS.maxEdges, "edges"],
    [raw.groups, LIMITS.maxGroups, "groups"],
    [raw.simulations, LIMITS.maxSimulations, "simulations"],
  ];
  for (const [list, max, what] of counts) {
    if (Array.isArray(list) && list.length > max)
      return { ok: false, error: `It has ${list.length} ${what}; the limit is ${max}.` };
  }
  const warnings: string[] = [];
  // Shallow copies: repairs never mutate the caller's object.
  const d: Record<string, unknown> = { ...raw };
  if (typeof d.title !== "string" || !d.title.trim())
    d.title = typeof d.title === "number" ? String(d.title) : "Untitled diagram";
  if (d.description !== undefined && typeof d.description !== "string") delete d.description;
  if (d.direction !== undefined && d.direction !== "LR" && d.direction !== "TB") {
    warnings.push(`Unknown direction "${String(d.direction)}" was ignored.`);
    delete d.direction;
  }

  // Groups: drop malformed ones rather than refusing the file.
  const groups: Record<string, unknown>[] = [];
  if (d.groups !== undefined) {
    if (!Array.isArray(d.groups)) {
      warnings.push("The groups field wasn't a list and was ignored.");
    } else {
      d.groups.forEach((g, i) => {
        if (
          !isObj(g) ||
          typeof g.id !== "string" ||
          !g.id ||
          ![g.x, g.y, g.width, g.height].every(isNum) ||
          (g.width as number) < 0 ||
          (g.height as number) < 0
        ) {
          warnings.push(
            `${describe("Group", i, isObj(g) ? g.id : undefined)} was skipped: it needs an id, x, y, width and height.`,
          );
          return;
        }
        if (groups.some((x) => x.id === g.id)) {
          warnings.push(`A second group with the id "${g.id}" was skipped.`);
          return;
        }
        const out = { ...g };
        if (typeof out.label !== "string") out.label = typeof out.label === "number" ? String(out.label) : "";
        if (out.tone !== undefined && !TONES.has(out.tone as string)) delete out.tone;
        groups.push(out);
      });
    }
  }
  const groupIds = new Set(groups.map((g) => g.id as string));
  if (groups.length) d.groups = groups;
  else delete d.groups;

  const nodes: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < (raw.nodes as unknown[]).length; i++) {
    const n = (raw.nodes as unknown[])[i];
    if (!isObj(n) || typeof n.id !== "string" || !n.id || typeof n.stencil !== "string" || !isNum(n.x) || !isNum(n.y)) {
      return {
        ok: false,
        error: `Every node needs an id, a stencil, and numeric x and y. ${describe("Node", i, isObj(n) ? n.id : undefined)} doesn't.`,
      };
    }
    if (ids.has(n.id)) return { ok: false, error: `Two nodes share the id "${n.id}". Node ids must be unique.` };
    ids.add(n.id);
    const out = { ...n };
    if (typeof out.label !== "string") out.label = typeof out.label === "number" ? String(out.label) : "";
    if (out.sublabel !== undefined && typeof out.sublabel !== "string") delete out.sublabel;
    if (out.group !== undefined && !groupIds.has(out.group as string)) {
      warnings.push(`Node "${n.id}" referred to a missing group and was taken out of it.`);
      delete out.group;
    }
    if (out.props !== undefined && !isObj(out.props)) delete out.props;
    nodes.push(out);
  }
  d.nodes = nodes;

  const edges: Record<string, unknown>[] = [];
  const edgeIds = new Set<string>();
  const rawEdges = raw.edges === undefined ? [] : raw.edges;
  if (!Array.isArray(rawEdges)) return { ok: false, error: "The diagram needs both a nodes and an edges list." };
  for (let i = 0; i < rawEdges.length; i++) {
    const e = rawEdges[i];
    if (!isObj(e) || typeof e.id !== "string" || typeof e.from !== "string" || typeof e.to !== "string") {
      return {
        ok: false,
        error: `Every edge needs an id, a from and a to. ${describe("Edge", i, isObj(e) ? e.id : undefined)} doesn't.`,
      };
    }
    if (!ids.has(e.from) || !ids.has(e.to)) {
      const missing = !ids.has(e.from) ? e.from : e.to;
      return { ok: false, error: `Edge "${e.id}" points at a node that isn't in the file ("${missing}").` };
    }
    const out = { ...e };
    if (edgeIds.has(e.id)) {
      let k = 2;
      while (edgeIds.has(`${e.id}-${k}`)) k++;
      out.id = `${e.id}-${k}`;
      warnings.push(`Two edges shared the id "${e.id}"; one was renamed to "${out.id}".`);
    }
    edgeIds.add(out.id as string);
    if (out.label !== undefined && typeof out.label !== "string") delete out.label;
    if (out.kind !== undefined && out.kind !== "async" && out.kind !== "sync") delete out.kind;
    if (out.sourceSide !== undefined && !SIDES.has(out.sourceSide as string)) delete out.sourceSide;
    if (out.targetSide !== undefined && !SIDES.has(out.targetSide as string)) delete out.targetSide;
    if (out.props !== undefined && !isObj(out.props)) delete out.props;
    edges.push(out);
  }
  d.edges = edges;

  if (d.simulations !== undefined) {
    if (!Array.isArray(d.simulations)) {
      warnings.push("The simulations field wasn't a list and was ignored.");
      delete d.simulations;
    } else {
      const sims: Record<string, unknown>[] = [];
      d.simulations.forEach((sim, i) => {
        const problem = simulationProblem(sim, ids);
        if (problem)
          warnings.push(
            `${describe("Simulation", i, isObj(sim) ? (sim.title ?? sim.id) : undefined)} was skipped: ${problem}.`,
          );
        else sims.push(sim as Record<string, unknown>);
      });
      if (sims.length) d.simulations = sims;
      else delete d.simulations;
    }
  }
  return { ok: true, diagram: d as unknown as DiagramFile, warnings };
}

const SHAPES = new Set(["burst", "constant", "ramp", "spike"]);
const ACTIONS = new Set(["status", "props", "inject", "note"]);
const OPS = new Set(["<", "<=", "==", ">=", ">"]);
const WHEN = new Set(["always", "eventually", "end", "at"]);
const STATUS = new Set(["up", "paused", "down"]);
const optNum = (v: unknown) => v === undefined || isNum(v);

/** Why a saved simulation can't be played (its shape; deeper semantics are the runner's job). */
function simulationProblem(sim: unknown, nodeIds: Set<string>): string | undefined {
  if (!isObj(sim)) return "it isn't an object";
  if (typeof sim.id !== "string" || !sim.id) return "it needs an id";
  if (typeof sim.title !== "string") return "it needs a title";
  if (!optNum(sim.seed) || !optNum(sim.durationMs)) return "seed and durationMs must be numbers";
  if (!Array.isArray(sim.traffic)) return "it needs a traffic list";
  for (const t of sim.traffic) {
    if (!isObj(t) || typeof t.id !== "string" || typeof t.node !== "string")
      return "every traffic entry needs an id and a node";
    if (!nodeIds.has(t.node)) return `traffic starts at "${t.node}", which isn't in the diagram`;
    const sh = t.shape;
    if (!isObj(sh) || !SHAPES.has(sh.kind as string))
      return "every traffic entry needs a shape (burst, constant, ramp or spike)";
    if (!Object.entries(sh).every(([k, v]) => k === "kind" || k === "stages" || isNum(v)))
      return "traffic numbers must be finite";
    if (
      sh.kind === "ramp" &&
      (!Array.isArray(sh.stages) || !sh.stages.every((st) => isObj(st) && isNum(st.durationMs) && isNum(st.targetRate)))
    ) {
      return "ramp stages need durationMs and targetRate";
    }
  }
  if (sim.timeline !== undefined) {
    if (!Array.isArray(sim.timeline)) return "the timeline must be a list";
    for (const step of sim.timeline) {
      if (!isObj(step) || !isNum(step.atMs) || !isObj(step.action) || !ACTIONS.has(step.action.do as string))
        return "every timeline step needs atMs and an action";
      const a = step.action;
      if (a.do === "note" ? typeof a.text !== "string" : typeof a.node !== "string")
        return "a timeline action is missing its node or text";
      if (a.do === "status" && !STATUS.has(a.status as string)) return "a status action needs up, paused or down";
    }
  }
  if (sim.expectations !== undefined) {
    if (!Array.isArray(sim.expectations)) return "expectations must be a list";
    for (const x of sim.expectations) {
      if (!isObj(x) || typeof x.id !== "string" || !isObj(x.metric) || !OPS.has(x.op as string) || !isNum(x.value))
        return "every expectation needs an id, a metric, an operator and a value";
      if (x.when !== undefined && !WHEN.has(x.when as string)) return "an expectation has an unknown when";
    }
  }
  if (sim.setup !== undefined && !isObj(sim.setup)) return "setup must be an object";
  return undefined;
}

/** Parses diagrams/v1 JSON text. */
export function parseNative(text: string): NativeResult {
  if (text.length > LIMITS.maxTextChars) return { ok: false, error: tooLargeMessage(text.length) };
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "That file isn't valid JSON. Choose a .diagram.json file exported from Diagrams." };
  }
  return validateDiagram(data);
}

/** Serialises a diagram the way every native export writes it. */
export const serializeNative = (d: DiagramFile) => JSON.stringify(d, null, 2) + "\n";

// ---------------------------------------------------------------- unknown-field preservation

const KNOWN_TOP = new Set(["format", "title", "description", "direction", "groups", "nodes", "edges", "simulations"]);
const KNOWN_NODE = new Set(["id", "stencil", "label", "sublabel", "x", "y", "group", "props"]);
const KNOWN_EDGE = new Set(["id", "from", "to", "label", "kind", "sourceSide", "targetSide", "props"]);
const KNOWN_GROUP = new Set(["id", "label", "tone", "x", "y", "width", "height"]);

function extras(obj: object, known: Set<string>): [string, unknown][] {
  return Object.entries(obj).filter(([k]) => !known.has(k));
}

function mergeById<T extends { id: string }>(
  current: T[] | undefined,
  original: T[] | undefined,
  known: Set<string>,
): T[] | undefined {
  if (!current || !original?.length) return current;
  const byId = new Map(original.map((o) => [o.id, o]));
  return current.map((c) => {
    const o = byId.get(c.id);
    if (!o) return c;
    const add = extras(o, known).filter(([k]) => !(k in c));
    return add.length ? { ...c, ...Object.fromEntries(add) } : c;
  });
}

/**
 * The canvas only carries the fields it knows. Re-attach the unknown ones from the original file
 * (top level, and per node / edge / group by id) so exports stay lossless.
 */
export function preserveUnknown(current: DiagramFile, original: DiagramFile | undefined): DiagramFile {
  if (!original) return current;
  const top = extras(original, KNOWN_TOP).filter(([k]) => !(k in current));
  const out: DiagramFile = {
    ...current,
    nodes: mergeById(current.nodes, original.nodes, KNOWN_NODE)!,
    edges: mergeById(current.edges, original.edges, KNOWN_EDGE)!,
    ...(current.groups ? { groups: mergeById(current.groups, original.groups, KNOWN_GROUP) } : {}),
  };
  return top.length ? ({ ...out, ...Object.fromEntries(top) } as DiagramFile) : out;
}
