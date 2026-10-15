import { DIAGRAM_FORMAT, type Simulation, type DiagramFile } from "../model/types";
import {
  propsProblem,
  SIM_LIMITS,
  unsupportedPreset,
  invalidPlanningDelay,
  invalidEndpointReference,
} from "../model/simProps";

// The simulation settings' bounds, for the editors that share this chunk (the inspector, the Inputs panel).
export { SIM_LIMITS };
import { ANNOTATION_LIMITS, isColorValue, normalizeAnnotation } from "../model/annotations";
import { isHexColor } from "../model/colors";
import type { DiagramAnnotation } from "../model/types";
import { isDependency, isEdgeRelation, isRelationOrigin, sanitizeSettings } from "../model/relations";
import { sanitizeChecks } from "../model/checks";
import { idClaimer } from "../model/ids";
import { t } from "../i18n/core";
import { checkJsonSchema } from "../model/jsonSchema";
import { callerSchema, planningSchema } from "../model/admissionSchema";

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
  ...ANNOTATION_LIMITS,
  maxSimulations: 200,
  maxTimelineSteps: 10_000,
  maxTrafficProfiles: 2_000,
  maxRampStages: 10_000,
  maxExpectations: 10_000,
  maxMessageCount: 100_000,
  maxRatePerSec: SIM_LIMITS.ratePerSec,
  /** Scripted messages across all simulations, as played: real messages × Traffic multiplier ÷ the saved scale. */
  maxTrafficVolume: 200_000,
  maxSimulationMs: 600_000,
  maxPages: 100,
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
  for (let hops = 0; cur.format !== DIAGRAM_FORMAT && cur.format !== "diagrams/v2"; hops++) {
    const step = typeof cur.format === "string" ? MIGRATIONS[cur.format] : undefined;
    if (!step || hops > 20) {
      const found = cur.format;
      if (typeof found === "string" && /^diagrams\/v\d+$/.test(found)) {
        throw new FormatError(
          `This file uses ${found}, which is newer than this version of Live Diagrams understands (expected format "${DIAGRAM_FORMAT}"). Reload the page to get the latest version.`,
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
  if (
    raw.format === "diagrams/v2" &&
    (!isObj(raw.planning) ||
      (raw.planning.revision !== "p1" && raw.planning.revision !== "p2" && raw.planning.revision !== "p3"))
  )
    return {
      ok: false,
      error: t("planning.unsupportedRevision"),
    };
  if (raw.format === DIAGRAM_FORMAT && raw.planning !== undefined)
    return {
      ok: false,
      error: t("planning.formatRequired"),
    };
  if (raw.planning !== undefined) {
    try {
      checkJsonSchema(raw.planning, planningSchema);
      for (const field of ["sharedQuotas", "sharedAllocations"]) {
        const values = (raw.planning as Record<string, unknown>)[field];
        if (Array.isArray(values) && new Set(values.map((v: { id: string }) => v.id)).size !== values.length)
          return { ok: false, error: t("admission.unknown") };
      }
    } catch {
      return { ok: false, error: t("admission.unknown") };
    }
  }
  if (!Array.isArray(raw.nodes)) return { ok: false, error: "The diagram needs both a nodes and an edges list." };
  const counts: [unknown, number, string][] = [
    [raw.nodes, LIMITS.maxNodes, "nodes"],
    [raw.edges, LIMITS.maxEdges, "edges"],
    [raw.groups, LIMITS.maxGroups, "groups"],
    [raw.annotations, LIMITS.maxAnnotations, "annotations"],
    [raw.simulations, LIMITS.maxSimulations, "simulations"],
  ];
  for (const [list, max, what] of counts) {
    if (Array.isArray(list) && list.length > max)
      return { ok: false, error: `It has ${list.length} ${what}; the limit is ${max}.` };
  }
  if (Array.isArray(raw.simulations)) {
    const budget = simulationListBudget(raw.simulations);
    if (budget) return { ok: false, error: budget };
    for (const sim of raw.simulations) {
      if (!isObj(sim)) continue;
      const props = isObj(sim.setup) && isObj(sim.setup.props) ? sim.setup.props : {};
      for (const [id, value] of Object.entries(props))
        if (unsupportedPreset(value)) return { ok: false, error: t("planning.unsupportedPreset", { id }) };
      if (Array.isArray(sim.timeline))
        for (const step of sim.timeline) {
          const action = isObj(step) && isObj(step.action) ? step.action : undefined;
          if (action?.do === "props" && unsupportedPreset(action.props))
            return {
              ok: false,
              error: t("planning.unsupportedPreset", {
                id: typeof action.node === "string" ? action.node : "(invalid node)",
              }),
            };
        }
    }
  }
  if (exceedsDepth(raw))
    return { ok: false, error: `It's nested too deeply to be a diagram (more than ${LIMITS.maxDepth} levels).` };
  const warnings: string[] = [];
  // Shallow copies: repairs never mutate the caller's object.
  const d: Record<string, unknown> = { ...raw };
  // One id space for every element: edit ops, checks and the canvas look an id up across nodes, notes, boundaries
  // and connections. A repeated id stays with the first node (then note, boundary, connection) that has it; the
  // others become "id-2" (a suffix no element in the file uses), so references, which can't tell them apart, keep
  // their meaning. A boundary's members follow it (`group` only ever names a boundary); check ignores are copied.
  const original = new Set(
    [raw.nodes, raw.edges, d.groups, d.annotations].flatMap((l) => (Array.isArray(l) ? l.map((x) => x?.id) : [])),
  );
  const taken = new Set<string>();
  const renamed = new Map<string, string[]>();
  const claimId = idClaimer(taken, original);
  const claim = (id: string) => {
    const out = claimId(id);
    if (out !== id) {
      const to = renamed.get(id);
      if (to) to.push(out);
      else renamed.set(id, [out]);
      warnings.push(`Two elements shared the id "${id}"; one was renamed to "${out}".`);
    }
    return out;
  };
  if (typeof d.title !== "string" || !d.title.trim())
    d.title = typeof d.title === "number" ? String(d.title) : "Untitled diagram";
  if (d.description !== undefined && typeof d.description !== "string") delete d.description;
  if (d.color !== undefined) {
    if (typeof d.color !== "string" || !isColorValue(d.color)) {
      const shown = typeof d.color === "string" ? ` "${d.color.slice(0, 80)}${d.color.length > 80 ? "…" : ""}"` : "";
      warnings.push(`Unknown diagram colour${shown} was ignored.`);
      delete d.color;
    }
  }
  // Fails closed: any "private" that isn't plainly true or false keeps the diagram private.
  if (d.private === false) delete d.private;
  else if (d.private !== undefined && d.private !== true) {
    warnings.push(`"private" should be true or false; the diagram was kept private.`);
    d.private = true;
  }
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
          (g.height as number) < 0 ||
          [g.x, g.y, g.width, g.height].some((v) => isNum(v) && Math.abs(v) > LIMITS.maxCoordinate)
        ) {
          warnings.push(
            `${describe("Group", i, isObj(g) ? g.id : undefined)} was skipped: it needs an id, x, y, width and height.`,
          );
          return;
        }
        const out = { ...g };
        if (typeof out.label !== "string") out.label = typeof out.label === "number" ? String(out.label) : "";
        if (out.tone !== undefined && !TONES.has(out.tone as string) && !isHexColor(out.tone)) delete out.tone;
        if (out.group !== undefined && (typeof out.group !== "string" || !out.group.trim())) delete out.group;
        groups.push(out);
      });
    }
  }
  const groupIds = new Set(groups.map((g) => g.id as string));
  for (const g of groups) {
    if (g.group !== undefined && (!groupIds.has(g.group as string) || g.group === g.id)) delete g.group;
  }
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
    if (Math.abs(n.x) > LIMITS.maxCoordinate || Math.abs(n.y) > LIMITS.maxCoordinate)
      return { ok: false, error: `Node "${n.id}" exceeds the coordinate budget.` };
    const id = claim(n.id);
    const out: Record<string, unknown> = { ...n, id };
    ids.add(id);
    if (typeof out.label !== "string") out.label = typeof out.label === "number" ? String(out.label) : "";
    if (out.sublabel !== undefined && typeof out.sublabel !== "string") delete out.sublabel;
    if (out.group !== undefined && !groupIds.has(out.group as string)) {
      warnings.push(`Node "${n.id}" referred to a missing group and was taken out of it.`);
      delete out.group;
    }
    if (out.props !== undefined && !isObj(out.props)) delete out.props;
    if (unsupportedPreset(out.props))
      return {
        ok: false,
        error: t("planning.unsupportedPreset", { id: n.id }),
      };
    const problem = out.props === undefined ? undefined : propsProblem(out.props);
    if (problem) return { ok: false, error: `Node "${n.id}" has a simulation setting out of bounds: ${problem}.` };
    nodes.push(out);
  }
  d.nodes = nodes;

  // Annotations: documentation only, so a malformed one is skipped (with a warning), never fatal.
  // Ids share the node namespace; only shapes may be edge ends.
  const annotations: DiagramAnnotation[] = [];
  const rejectedAnnotationIds = new Set<string>();
  const shapeIds = new Set<string>();
  const annotationIds = new Set<string>();
  if (d.annotations !== undefined) {
    if (!Array.isArray(d.annotations)) {
      warnings.push("The annotations field wasn't a list and was ignored.");
    } else {
      d.annotations.forEach((a, i) => {
        const what = describe("Annotation", i, isObj(a) ? a.id : undefined);
        const out = normalizeAnnotation(a, undefined, (message) => warnings.push(`${what} ${message}`));
        if (!out) {
          if (isObj(a) && typeof a.id === "string") rejectedAnnotationIds.add(a.id);
          return;
        }
        out.id = claim(out.id);
        if (out.group !== undefined && !groupIds.has(out.group)) delete out.group;
        annotationIds.add(out.id);
        if (out.kind === "shape") shapeIds.add(out.id);
        annotations.push(out);
      });
    }
  }
  if (annotations.length) d.annotations = annotations;
  else delete d.annotations;
  const groupIdFor = new Map<unknown, string>();
  for (const g of groups) {
    const id = claim(g.id as string);
    if (!groupIdFor.has(g.id)) groupIdFor.set(g.id, id);
    g.id = id;
  }
  for (const n of nodes) if (n.group !== undefined) n.group = groupIdFor.get(n.group);
  for (const g of groups) {
    if (g.group !== undefined) {
      const mapped = groupIdFor.get(g.group);
      if (mapped && mapped !== g.id) g.group = mapped;
      else delete g.group;
    }
  }
  for (const a of annotations) {
    if (a.group !== undefined) {
      const mapped = groupIdFor.get(a.group);
      if (mapped) a.group = mapped;
      else delete a.group;
    }
  }

  const edges: Record<string, unknown>[] = [];
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
    if ([e.from, e.to].some((id) => rejectedAnnotationIds.has(id) && !ids.has(id) && !annotationIds.has(id))) {
      warnings.push(`Edge "${e.id}" ended on a skipped annotation and was skipped.`);
      continue;
    }
    const end = (id: string) => ids.has(id) || shapeIds.has(id);
    if (!end(e.from) || !end(e.to)) {
      const missing = !end(e.from) ? e.from : e.to;
      if (annotationIds.has(missing)) {
        // Texts, notes and zones take no edges: drop the edge, keep the file.
        warnings.push(`Edge "${e.id}" ended on a text, note or zone and was skipped; only shapes can be connected.`);
        continue;
      }
      return { ok: false, error: `Edge "${e.id}" points at a node that isn't in the file ("${missing}").` };
    }
    const out: Record<string, unknown> = { ...e, id: claim(e.id) };
    if (out.label !== undefined && typeof out.label !== "string") delete out.label;
    if (out.kind !== undefined && out.kind !== "async" && out.kind !== "sync") delete out.kind;
    if (out.sourceSide !== undefined && !SIDES.has(out.sourceSide as string)) delete out.sourceSide;
    if (out.targetSide !== undefined && !SIDES.has(out.targetSide as string)) delete out.targetSide;
    if (out.props !== undefined && !isObj(out.props)) delete out.props;
    if (invalidPlanningDelay(out.props))
      return { ok: false, error: t("planning.delayInvalid", { id: e.id, limit: SIM_LIMITS.timeMs }) };
    if (invalidEndpointReference(out.props)) return { ok: false, error: t("admission.endpointInvalid", { id: e.id }) };
    const caller = (out.props as Record<string, unknown> | undefined)?.caller;
    if (caller !== undefined) {
      try {
        checkJsonSchema(caller, callerSchema, "caller");
      } catch {
        return { ok: false, error: `Edge "${e.id}": caller must be a valid bounded caller policy.` };
      }
    }
    // A deny rule fails closed: anything that isn't true or false is read as deny, never as allow, and said.
    const deny = (out.props as Record<string, unknown> | undefined)?.deny;
    if (deny !== undefined && typeof deny !== "boolean") {
      warnings.push(
        `Edge "${e.id}" had a deny rule that wasn't true or false (${String(JSON.stringify(deny)).slice(0, 40)}); it's read as deny, so what's routed there is blocked. Set it to false to allow.`,
      );
      out.props = { ...(out.props as Record<string, unknown>), deny: true };
    }
    repairRelation(out, warnings);
    edges.push(out);
  }
  d.edges = edges;
  if (d.layerOrder !== undefined) {
    if (Array.isArray(d.layerOrder)) {
      const seen = new Set<string>();
      d.layerOrder = d.layerOrder.filter((id): id is string => {
        if (typeof id !== "string" || seen.has(id) || (!ids.has(id) && !annotationIds.has(id))) return false;
        seen.add(id);
        return true;
      });
    } else delete d.layerOrder;
  }

  if (d.simulations !== undefined) {
    if (!Array.isArray(d.simulations)) {
      warnings.push("The simulations field wasn't a list and was ignored.");
      delete d.simulations;
    } else {
      const sims: Record<string, unknown>[] = [];
      d.simulations.forEach((sim, i) => {
        const problem = simulationProblem(sim);
        if (problem)
          warnings.push(
            `${describe("Simulation", i, isObj(sim) ? (sim.title ?? sim.id) : undefined)} was skipped: ${problem}.`,
          );
        else {
          sims.push(sim as Record<string, unknown>);
          warnings.push(...simulationReferenceWarnings(sim as Simulation, ids));
        }
      });
      const budget = simulationBudgetProblem(sims);
      if (budget) return { ok: false, error: budget };
      if (sims.length) d.simulations = sims;
      else delete d.simulations;
    }
  }
  if (d.checks !== undefined) {
    // An ignore names its element by id: when elements shared one, each keeps it, within the sanitizer's bounds.
    const checks = sanitizeChecks(d.checks, taken, warnings, renamed);
    if (checks) d.checks = checks;
    else delete d.checks;
  }
  return { ok: true, diagram: d as unknown as DiagramFile, warnings };
}

const DEPENDENCY_WHEN = new Set(["startup", "cached", "request", "never"]);

/**
 * Relationships (docs/research/diagram-semantics.md §2.3). An unknown `relation` is dropped, so the
 * edge reads as a flow (the safe fallback). `props.settings` keeps only well-formed `{ key, secret? }`
 * entries (at most MAX_SETTINGS). `when` (a later phase) survives only on a dependency. On a
 * dependency, flow-only fields (kind, group, dlq, filter, share, emits) stay in the file untouched,
 * so switching back to a flow restores them; the simulation never sees the edge either way.
 */
function repairRelation(e: Record<string, unknown>, warnings: string[]): void {
  if (e.relation !== undefined && !isEdgeRelation(e.relation)) {
    warnings.push(`Edge "${String(e.id)}" had an unknown relationship "${String(e.relation)}"; it's drawn as a flow.`);
    delete e.relation;
  }
  if (e.when !== undefined && (!isDependency(e) || !DEPENDENCY_WHEN.has(e.when as string))) delete e.when;
  if (e.relationOrigin !== undefined && !isRelationOrigin(e.relationOrigin)) delete e.relationOrigin;
  const props = e.props as Record<string, unknown> | undefined;
  if (props?.settings !== undefined) {
    const settings = sanitizeSettings(props.settings);
    const next = { ...props };
    if (settings) next.settings = settings;
    else delete next.settings;
    if (Object.keys(next).length) e.props = next;
    else delete e.props;
  }
}

const OPS = new Set(["<", "<=", "==", ">=", ">"]);
const WHEN = new Set(["always", "eventually", "end", "at"]);
const STATUS = new Set(["up", "paused", "down"]);
const METRICS = new Set([
  "processed",
  "backlog",
  "inFlight",
  "failed",
  "deadLettered",
  "dropped",
  "blocked",
  "rejected",
  "throughput",
  "lag",
]);
const optString = (v: unknown) => v === undefined || typeof v === "string";
const nonnegative = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => isNum(v) && v >= 0 && v <= max;
const time = (v: unknown) => nonnegative(v, LIMITS.maxSimulationMs);
const optTime = (v: unknown) => v === undefined || time(v);
const count = (v: unknown) => nonnegative(v, LIMITS.maxMessageCount) && Number.isSafeInteger(v);
const rate = (v: unknown) => nonnegative(v, LIMITS.maxRatePerSec);
const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Structural validation only: unresolved references remain repairable editor metadata. */
export function simulationProblem(sim: unknown): string | undefined {
  if (!isObj(sim)) return "it isn't an object";
  if (typeof sim.id !== "string" || !sim.id || typeof sim.title !== "string") return "it needs an id and title";
  if (!optString(sim.description) || (sim.seed !== undefined && !isNum(sim.seed)) || !optTime(sim.durationMs))
    return "description, seed or durationMs is invalid";
  if (sim.scale !== undefined && (!isNum(sim.scale) || sim.scale < 1)) return "scale must be at least 1";
  if (
    sim.multipliers !== undefined &&
    (!isObj(sim.multipliers) ||
      [sim.multipliers.traffic, sim.multipliers.capacity].some((v) => v !== undefined && !nonnegative(v, 100)))
  )
    return "multipliers must be bounded nonnegative numbers";
  if (!Array.isArray(sim.traffic)) return "it needs a traffic list";
  for (const t of sim.traffic) {
    if (
      !isObj(t) ||
      typeof t.id !== "string" ||
      typeof t.node !== "string" ||
      !optString(t.label) ||
      !optString(t.messageType)
    )
      return "every traffic entry needs string id, node, label and messageType fields";
    const sh = t.shape;
    if (!isObj(sh)) return "every traffic entry needs a shape";
    switch (sh.kind) {
      case "burst":
        if (!count(sh.count) || !optTime(sh.atMs) || !optTime(sh.spreadMs))
          return "burst count or timing is invalid or exceeds its budget";
        break;
      case "constant":
        if (!rate(sh.ratePerSec) || !optTime(sh.fromMs) || !time(sh.durationMs))
          return "constant rate or timing is invalid or exceeds its budget";
        break;
      case "ramp":
        if (
          !optTime(sh.fromMs) ||
          (sh.startRate !== undefined && !rate(sh.startRate)) ||
          !Array.isArray(sh.stages) ||
          !sh.stages.every((st) => isObj(st) && time(st.durationMs) && rate(st.targetRate))
        )
          return "ramp stages need bounded durationMs and targetRate";
        break;
      case "spike":
        if (!rate(sh.baseRate) || !rate(sh.peakRate) || !time(sh.atMs) || !time(sh.peakMs) || !time(sh.durationMs))
          return "spike rates or timing are invalid or exceed their budget";
        break;
      default:
        return "every traffic entry needs a shape (burst, constant, ramp or spike)";
    }
  }
  if (sim.timeline !== undefined) {
    if (!Array.isArray(sim.timeline)) return "the timeline must be a list";
    for (const step of sim.timeline) {
      if (!isObj(step) || !time(step.atMs) || !isObj(step.action))
        return "every timeline step needs bounded atMs and an action";
      const a = step.action;
      if (a.do !== "note" && typeof a.node !== "string") return "a timeline action needs a node";
      switch (a.do) {
        case "note":
          if (
            typeof a.text !== "string" ||
            (a.focus !== undefined && !strings(a.focus)) ||
            (a.pause !== undefined && typeof a.pause !== "boolean")
          )
            return "notes need text, a string-array focus and a boolean pause";
          break;
        case "status":
          if (!STATUS.has(a.status as string)) return "a status action needs up, paused or down";
          break;
        case "props":
          {
            const problem = propsProblem(a.props);
            if (problem) return `a props action needs valid engine properties (${problem})`;
          }
          break;
        case "inject":
          if (!count(a.count) || !optString(a.messageType) || !optTime(a.spreadMs))
            return "an inject action needs a bounded count, messageType and spreadMs";
          break;
        case "trace":
          break;
        default:
          return "unknown timeline action";
      }
    }
  }
  if (sim.expectations !== undefined) {
    if (!Array.isArray(sim.expectations)) return "expectations must be a list";
    for (const x of sim.expectations) {
      if (
        !isObj(x) ||
        typeof x.id !== "string" ||
        typeof x.label !== "string" ||
        !isObj(x.metric) ||
        !OPS.has(x.op as string) ||
        !isNum(x.value)
      )
        return "every expectation needs an id, label, metric, operator and value";
      const m = x.metric;
      if (
        m.system !== undefined
          ? m.system !== "inSystem" || m.node !== undefined || m.field !== undefined || m.group !== undefined
          : typeof m.node !== "string" || !METRICS.has(m.field as string) || !optString(m.group)
      )
        return "invalid expectation metric";
      if (
        (x.when !== undefined && !WHEN.has(x.when as string)) ||
        !optTime(x.atMs) ||
        (x.when === "at" && !time(x.atMs))
      )
        return "invalid expectation when or atMs";
    }
  }
  if (sim.setup !== undefined) {
    if (!isObj(sim.setup)) return "setup must be an object";
    if (
      sim.setup.status !== undefined &&
      (!isObj(sim.setup.status) || !Object.values(sim.setup.status).every((v) => STATUS.has(v as string)))
    )
      return "setup status must map node ids to up, paused or down";
    if (sim.setup.props !== undefined) {
      if (!isObj(sim.setup.props)) return "setup props must map node ids to valid engine properties";
      for (const [id, props] of Object.entries(sim.setup.props)) {
        const problem = propsProblem(props);
        if (problem) return `setup props for ${JSON.stringify(id)} must be valid engine properties (${problem})`;
      }
    }
  }
  return undefined;
}

export function simulationReferenceWarnings(sim: Simulation, nodeIds: Set<string>): string[] {
  const refs = new Set([
    ...sim.traffic.map((t) => t.node),
    ...(sim.timeline ?? []).flatMap(({ action }) => (action.do === "note" ? (action.focus ?? []) : [action.node])),
    ...Object.keys(sim.setup?.props ?? {}),
    ...Object.keys(sim.setup?.status ?? {}),
    ...(sim.expectations ?? []).flatMap((x) => ("node" in x.metric ? [x.metric.node] : [])),
  ]);
  return [...refs]
    .filter((id) => !nodeIds.has(id))
    .map(
      (id) =>
        `Simulation "${sim.title}" refers to missing node "${id}"; repair the reference in the simulation editor.`,
    );
}

function simulationListBudget(raw: unknown[]): string | undefined {
  let profiles = 0,
    steps = 0,
    stages = 0,
    expectations = 0;
  for (const sim of raw) {
    if (!isObj(sim)) continue;
    profiles += Array.isArray(sim.traffic) ? sim.traffic.length : 0;
    steps += Array.isArray(sim.timeline) ? sim.timeline.length : 0;
    expectations += Array.isArray(sim.expectations) ? sim.expectations.length : 0;
    if (
      profiles > LIMITS.maxTrafficProfiles ||
      steps > LIMITS.maxTimelineSteps ||
      expectations > LIMITS.maxExpectations
    )
      return "The simulations exceed the document's traffic, timeline or expectation budget.";
    for (const t of Array.isArray(sim.traffic) ? sim.traffic : []) {
      if (isObj(t) && isObj(t.shape) && Array.isArray(t.shape.stages)) stages += t.shape.stages.length;
      if (stages > LIMITS.maxRampStages) return "The simulations exceed the document's ramp-stage budget.";
    }
  }
  return undefined;
}

/** Document-wide budgets bound initialization and traffic even across many small simulations. */
function simulationBudgetProblem(raw: Record<string, unknown>[]): string | undefined {
  let profiles = 0,
    steps = 0,
    stages = 0,
    expectations = 0,
    volume = 0;
  for (const sim of raw as unknown as Simulation[]) {
    profiles += sim.traffic.length;
    steps += sim.timeline?.length ?? 0;
    expectations += sim.expectations?.length ?? 0;
    let messages = 0;
    for (const { shape: sh } of sim.traffic) {
      if (sh.kind === "burst") messages += sh.count;
      else if (sh.kind === "constant") messages += (sh.ratePerSec * sh.durationMs) / 1000;
      else if (sh.kind === "spike") messages += (Math.max(sh.baseRate, sh.peakRate) * sh.durationMs) / 1000;
      else {
        stages += sh.stages.length;
        let previous = sh.startRate ?? 0;
        for (const stage of sh.stages) {
          messages += (Math.max(previous, stage.targetRate) * stage.durationMs) / 1000;
          previous = stage.targetRate;
        }
      }
    }
    for (const { action } of sim.timeline ?? []) if (action.do === "inject") messages += action.count;
    // What playback draws: a saved scale samples real messages into dots, so a big rate costs no more to play.
    const scale = isNum(sim.scale) && sim.scale >= 1 ? sim.scale : 1;
    volume += (messages * Math.max(1, sim.multipliers?.traffic ?? 1)) / scale;
  }
  if (
    profiles > LIMITS.maxTrafficProfiles ||
    steps > LIMITS.maxTimelineSteps ||
    stages > LIMITS.maxRampStages ||
    expectations > LIMITS.maxExpectations
  )
    return "The simulations exceed the document's traffic, timeline, ramp-stage or expectation budget.";
  if (!Number.isFinite(volume) || volume > LIMITS.maxTrafficVolume)
    return "The simulations exceed the document's total traffic volume budget.";
  return undefined;
}

/** Parses diagrams/v1 JSON text. */
export function parseNative(text: string): NativeResult {
  if (text.length > LIMITS.maxTextChars) return { ok: false, error: tooLargeMessage(text.length) };
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "That file isn't valid JSON. Choose a .diagram.json file exported from Live Diagrams." };
  }
  return validateDiagram(data);
}

/** Serialises a diagram the way every native export writes it. */
export const serializeNative = (d: DiagramFile) => JSON.stringify(d, null, 2) + "\n";

// ---------------------------------------------------------------- unknown-field preservation

const KNOWN_TOP = new Set([
  "planning",
  "format",
  "title",
  "description",
  "color",
  "direction",
  "groups",
  "nodes",
  "edges",
  "simulations",
  "annotations",
  "layerOrder",
  "checks",
  // Never carried over from a stored original: exports add it from the diagram's privacy (withPrivacyField).
  "private",
]);
const KNOWN_NODE = new Set(["id", "stencil", "label", "sublabel", "x", "y", "group", "props"]);
const KNOWN_EDGE = new Set([
  "id",
  "from",
  "to",
  "label",
  "kind",
  "relation",
  "relationOrigin",
  "sourceSide",
  "targetSide",
  "props",
]);
const KNOWN_GROUP = new Set(["id", "label", "tone", "x", "y", "width", "height"]);
const KNOWN_ANNOTATION = new Set(["id", "kind", "text", "x", "y", "width", "height", "shape", "color", "textSize"]);

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
    ...(current.annotations
      ? { annotations: mergeById(current.annotations, original.annotations, KNOWN_ANNOTATION) }
      : {}),
  };
  return top.length ? ({ ...out, ...Object.fromEntries(top) } as DiagramFile) : out;
}
