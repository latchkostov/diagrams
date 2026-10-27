import { visibilityFixtures } from "./visibility.fixture";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stencils } from "../stencils/registry";
import { stencilRole } from "../stencils/roles";
import { allTutorials as tutorials } from "./catalog";
import { tutorialEntries } from "./catalog/ids";
import { tutorialMetadata } from "./metadata";
import type { Check, Demo, MetricExpr, PathSegment, PropPath, SubjectSpec, TutorialStep, UiStep } from "./types";
import { UNSAFE_KEYS } from "./paths";
import { tutorialFixtures } from "../test/tutorialFixtures";

/**
 * The authoring lint: every tutorial is checked against the app it teaches, so a renamed test id, a missing message
 * or a step that can't be done fails here rather than in front of a learner. The generated e2e
 * (tests/e2e/tutorials.spec.ts) then plays each one through the real UI.
 */

/**
 * Whether a source file counts as evidence that the app renders a control: never tests, and never tutorial
 * declarations (the catalog, the Lab's runtime lessons, the runner's fixture lessons), which only name controls.
 */
const isEvidence = (path: string) => {
  const at = path.replaceAll("\\", "/");
  return (
    /\.tsx?$/.test(at) &&
    !/\.test\.tsx?$/.test(at) &&
    (!at.includes("src/tutorials/") || at.endsWith("tutorials/TutorialApp.tsx")) &&
    !at.endsWith("lab/tutorialRuntimeFixture.ts") &&
    !at.endsWith("test/tutorialFixtures.ts")
  );
};
/** Every test id the app's source can render, as literal text or template prefixes (never the private examples). */
const source = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (path.replaceAll("\\", "/").includes("src/examples/private")) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (isEvidence(path)) out.push(readFileSync(path, "utf8"));
    }
  };
  walk("src");
  // Readout rows share a template with two literal prefixes (hover and docked inspector).
  // Expand those alternatives so each still needs the real template suffix and a known section key.
  return out.join("\n").replace(/\$\{\w+ \? "([^"]+)" : "([^"]+)"\}([^`\n]*)/g, "$1$3\n$2$3");
})();

const stencilIds = new Set(stencils.map((s) => s.id));
/**
 * A test id is known when the source renders it: quoted whole, or built from a template's fixed prefix ("palette-item-"
 * before a placeholder) and a known rest (a stencil id, another quoted part). A subject (`{app}`) stands for a node id.
 */
function knownTestId(id: string): boolean {
  if (!id) return true;
  if (/^\{\w+(?:->\w+)?\}/.test(id)) return knownTestId(id.replace(/^\{\w+(?:->\w+)?\}/, ""));
  if (source.includes(`"${id}"`) || source.includes(`'${id}'`) || stencilIds.has(id)) return true;
  for (let i = id.length - 1; i > 0; i--) {
    if (!"-:".includes(id[i - 1])) continue;
    if (source.includes(id.slice(0, i) + "${") && knownTestId(id.slice(i))) return true;
  }
  return false;
}

/** The subjects a Live number reads. */
const metricSubjects = (e: MetricExpr | number): string[] =>
  typeof e === "number"
    ? []
    : "sinceStep" in e
      ? metricSubjects(e.sinceStep)
      : "every" in e
        ? e.every.within
          ? [e.every.within]
          : []
        : "prop" in e
          ? e.edge
            ? [...e.edge]
            : [e.subject]
          : "node" in e
            ? [e.node]
            : "edge" in e
              ? [...e.edge]
              : "nodes" in e
                ? [...e.nodes]
                : "edges" in e
                  ? e.edges.flat()
                  : "from" in e
                    ? [e.from]
                    : [];
const subjectsIn = (check: Check): string[] =>
  check.kind === "compare"
    ? [...metricSubjects(check.left), ...metricSubjects(check.right)]
    : check.kind === "readout"
      ? check.edge
        ? [...check.edge]
        : check.subject
          ? [check.subject]
          : []
      : check.kind === "selection" || check.kind === "aligned"
        ? [...(check.subjects ?? [])]
        : check.kind === "mode"
          ? check.subject
            ? [check.subject]
            : []
          : check.kind === "prop" || check.kind === "fault"
            ? check.edge
              ? [...check.edge]
              : [check.subject]
            : check.kind === "member"
              ? [check.subject, check.boundary]
              : check.kind === "metric"
                ? [check.subject, ...(check.edge ?? [])]
                : check.kind === "node" ||
                    check.kind === "label" ||
                    check.kind === "processed" ||
                    check.kind === "field"
                  ? [check.subject]
                  : check.kind === "edge" || check.kind === "relation"
                    ? [check.from, check.to]
                    : check.kind === "all"
                      ? check.checks.flatMap(subjectsIn)
                      : [];
const demoSubjects = (d: Demo): string[] =>
  (d.kind === "slowmo" || d.kind === "inject") && d.subject
    ? [d.subject]
    : d.kind === "add"
      ? [d.subject, ...(d.after ? [d.after] : [])]
      : d.kind === "prop" || d.kind === "fault" || d.kind === "patch"
        ? d.edge
          ? [...d.edge]
          : [d.subject]
        : d.kind === "member"
          ? [d.subject, d.boundary]
          : d.kind === "align"
            ? [...(d.subjects ?? [])]
            : d.kind === "group"
              ? [...d.subjects, d.boundary]
              : d.kind === "select"
                ? [...d.subjects]
                : d.kind === "connect" || d.kind === "relation"
                  ? [d.from, d.to]
                  : d.kind === "insert"
                    ? [...d.edge, d.subject]
                    : d.kind === "reconnect"
                      ? [...d.edge, d.to]
                      : d.kind === "field" || d.kind === "name" || d.kind === "rename"
                        ? [d.subject]
                        : [];
const testIdsOf = (s: UiStep): string[] =>
  "open" in s
    ? [s.open]
    : "modClick" in s
      ? [s.modClick]
      : "rightclick" in s
        ? [s.rightclick]
        : "boxSelect" in s
          ? [s.boxSelect, ...s.around]
          : "select" in s
            ? [s.select]
            : "pane" in s
              ? ["canvas-pane"]
              : "click" in s
                ? [s.click]
                : "dblclick" in s
                  ? [s.dblclick]
                  : "hover" in s
                    ? [s.hover]
                    : "fill" in s
                      ? [s.fill]
                      : "drag" in s
                        ? [s.drag, s.to]
                        : "type" in s && "text" in s
                          ? [s.type]
                          : [];
/** The subjects a test id names: `{api}`, or both ends of `{api->config}`. */
const templates = (testId: string) =>
  [...testId.matchAll(/\{(\w+)(?:->(\w+))?\}/g)].flatMap((m) => (m[2] ? [m[1], m[2]] : [m[1]]));
const words = (step: TutorialStep) =>
  [step.title, step.goal, step.hint, step.done, ...(typeof step.settle === "object" ? [step.settle.tip] : [])].filter(
    (w) => !!w,
  );

const checksIn = (check: Check): Check[] => (check.kind === "all" ? check.checks.flatMap(checksIn) : [check]);
/** What's wrong with a path, if anything: a typo'd index or a prototype key reads nothing, silently. */
function pathProblem(path: PropPath): string | undefined {
  const keyProblem = (key: string) =>
    !key ? "an empty key" : UNSAFE_KEYS.has(key) ? `the prototype key ${key}` : undefined;
  const segment = (part: PathSegment, i: number): string | undefined =>
    typeof part === "string"
      ? keyProblem(part)
      : typeof part === "number"
        ? Number.isInteger(part) && part >= 0
          ? i === 0
            ? "an index before a key"
            : undefined
          : `the index ${part}`
        : Object.keys(part.where).length
          ? Object.keys(part.where).map(keyProblem).find(Boolean)
          : "an empty where";
  return path.map(segment).find(Boolean);
}
const sinceIn = (e: MetricExpr | number) => typeof e === "object" && "sinceStep" in e;

/** An order-based selector can claim any membership-selected boundary: the two forms cannot safely coexist. */
function boundaryProblem(subjects: Readonly<Record<string, SubjectSpec>>): string | undefined {
  const specs = Object.values(subjects);
  if (specs.some((s) => s.boundary === true) && specs.some((s) => typeof s.boundary === "object"))
    return "mixed boundary selectors";
  for (const spec of specs) {
    if (typeof spec.boundary !== "object") continue;
    const members = spec.boundary.members;
    if (!members.length || new Set(members).size !== members.length) return "empty or repeated members";
    if (members.some((name) => !subjects[name] || subjects[name].boundary || subjects[name].edge))
      return "membership must name node subjects";
  }
}

describe("authoring evidence", () => {
  it("rejects ambiguous mixed boundary selectors and invalid membership references", () => {
    const node = { stencils: ["generic.service"] };
    expect(boundaryProblem({ node, cell: { boundary: true } })).toBeUndefined();
    expect(boundaryProblem({ node, cell: { boundary: { members: ["node"] } } })).toBeUndefined();
    expect(boundaryProblem({ node, first: { boundary: true }, second: { boundary: { members: ["node"] } } })).toBe(
      "mixed boundary selectors",
    );
    for (const member of ["missing", "cell", "edge"])
      expect(
        boundaryProblem({ node, cell: { boundary: { members: [member] } }, edge: { edge: ["node", "node"] } }),
      ).toBe("membership must name node subjects");
    expect(boundaryProblem({ node, cell: { boundary: { members: ["node", "node"] } } })).toBe(
      "empty or repeated members",
    );
  });

  it("rejects selectors declared only in tutorial data, the runner's fixtures included", () => {
    expect(isEvidence("src/test/tutorialFixtures.ts")).toBe(false);
    expect(isEvidence("src/lab/tutorialRuntimeFixture.ts")).toBe(false);
    expect(isEvidence("src/tutorials/catalog/mobileApi.ts")).toBe(false);
    expect(isEvidence("src/tutorials/TutorialApp.tsx")).toBe(true);
    expect(isEvidence("src/live/ControlBar.tsx")).toBe(true);
    // An id only a fixture names: its declaration isn't a control.
    expect(readFileSync("src/test/tutorialFixtures.ts", "utf8")).toContain('"fixture-study"');
    expect(knownTestId("fixture-study")).toBe(false);
    expect(knownTestId("live-toggle")).toBe(true);
    expect(knownTestId("hover-section-latency")).toBe(true);
    expect(knownTestId("hover-section-nonexistent-section")).toBe(false);
  });
});

describe("tutorial catalog", () => {
  it("publishes every study with its authored load", () => {
    const studies = tutorials.filter((tutorial) => tutorial.study);
    expect(studies.filter((tutorial) => tutorial.quarantined)).toEqual([]);
    expect(studies.map((tutorial) => tutorial.id)).toEqual([
      "study-checkout",
      "study-dispatch",
      "study-payments",
      "study-fanout",
      "study-rag",
      "study-cells",
    ]);
    for (const tutorial of studies) {
      expect(typeof tutorial.start).toBe("function");
      const diagram = typeof tutorial.start === "function" ? tutorial.start() : undefined;
      for (const run of diagram?.simulations ?? []) {
        expect(run.multipliers?.traffic ?? 1, `${tutorial.id}/${run.id} traffic`).toBe(
          tutorial.id === "study-checkout" ? 10 : 1,
        );
        expect(run.multipliers?.capacity ?? 1, `${tutorial.id}/${run.id} capacity`).toBe(1);
      }
    }
    expect(tutorialMetadata.some((tutorial) => tutorial.id === "study-checkout")).toBe(true);
  });

  it("has unique ids and a version, listed for the generated e2e", () => {
    const ids = tutorials.map((t) => t.id);
    expect(ids).toEqual(tutorialEntries.map((t) => t.id));
    expect(tutorialMetadata.map((x) => x.id)).toEqual(tutorials.filter((t) => !t.quarantined).map((t) => t.id));
    expect(tutorialEntries).toEqual(
      tutorials.map(({ id, quarantined }) => ({ id, ...(quarantined ? { quarantined } : {}) })),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of tutorials) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.version).toBeGreaterThanOrEqual(1);
      expect(t.steps.length).toBeGreaterThan(0);
      expect(new Set(t.steps.map((s) => s.id)).size).toBe(t.steps.length);
    }
  });

  // The runner's fixture lessons (src/test/tutorialFixtures.ts) meet the same rules as the catalog's.
  for (const tutorial of [...tutorials, ...tutorialFixtures, ...visibilityFixtures])
    describe(tutorial.id, () => {
      const subjects = new Set(Object.keys(tutorial.subjects));

      it("says everything in words from the catalog", () => {
        for (const text of [
          tutorial.title(),
          tutorial.summary(),
          tutorial.finish.text(),
          ...(typeof tutorial.start === "function" ? [tutorial.start().title] : []),
        ])
          expect(text.trim()).not.toBe("");
        for (const step of tutorial.steps) {
          for (const w of words(step)) expect(w!().trim()).not.toBe("");
          for (const target of step.targets) expect(target.tip().trim()).not.toBe("");
          // A message key that isn't in the catalog renders as its key: never ship one.
          for (const w of words(step)) expect(w!()).not.toMatch(/^tutorials\./);
        }
      });

      it("names only subjects it defines, and only stencils that exist", () => {
        expect(boundaryProblem(tutorial.subjects)).toBeUndefined();
        const known = stencilIds;
        const names = Object.keys(tutorial.subjects);
        for (const [i, spec] of Object.values(tutorial.subjects).entries()) {
          for (const id of spec.stencils ?? []) expect(known, id).toContain(id);
          if (spec.edge) for (const name of spec.edge) expect(subjects).toContain(name);
          // Topology selectors read subjects already resolved: those declared earlier.
          for (const name of [...(spec.downstreamOf ? [spec.downstreamOf] : []), ...(spec.between ?? [])])
            expect(names.slice(0, i), `${names[i]}: ${name}`).toContain(name);
          if (!spec.stencils && !spec.boundary && !spec.edge) expect(spec.role).toBeDefined();
        }
        for (const step of tutorial.steps) {
          const used = [
            ...subjectsIn(step.check),
            ...step.demo.flatMap(demoSubjects),
            ...(typeof step.settle === "object" ? step.settle.subjects : []),
            ...step.targets.flatMap((t) => [...templates(t.testId), ...(t.selected ? [t.selected] : [])]),
            ...step.solution.flatMap(testIdsOf).flatMap(templates),
          ];
          for (const name of used) expect(subjects, `${step.id}: ${name}`).toContain(name);
          for (const d of step.demo) if (d.kind === "add") expect(known, d.stencil).toContain(d.stencil);
        }
      });

      it("adds each subject with a stencil that resolves to it", () => {
        for (const step of tutorial.steps)
          for (const d of step.demo) {
            if (d.kind !== "add") continue;
            const spec = tutorial.subjects[d.subject];
            const fits = spec.stencils ? spec.stencils.includes(d.stencil) : stencilRole(d.stencil) === spec.role;
            expect(fits, `${step.id} adds ${d.stencil} for ${d.subject}`).toBe(true);
          }
      });

      it("points only at test ids the app renders", () => {
        for (const step of tutorial.steps) {
          expect(step.targets.length, `${step.id} has somewhere to point`).toBeGreaterThan(0);
          for (const id of [...step.targets.map((t) => t.testId), ...step.solution.flatMap(testIdsOf)])
            expect(knownTestId(id), `${step.id}: ${id}`).toBe(true);
        }
      });

      it("can be done for you, or is a moment the runner waits for", () => {
        for (const step of tutorial.steps) {
          // Sticky edits record a gesture whose result a later step deliberately replaces.
          const moment = step.demo.length === 0;
          if (moment)
            expect(
              [
                "processed",
                "live",
                "metric",
                "compare",
                "simulation",
                "expectation",
                "fault",
                "trace",
                "slowmo",
                "note",
                "mode",
                "all",
                "dependencies",
                "presenting",
                "sharing",
                "acknowledge",
                "readout",
                "liveView",
                "inputs",
                "selection",
                "aligned",
              ],
              step.id,
            ).toContain(step.check.kind);
          if (!step.demo.length) expect(step.sticky, `${step.id}: moments are explicitly sticky`).toBe(true);
          if (containsLabel(step.check)) expect(step.settle, step.id).toBe("naming");
          // An annotation's text is typed in its editor: the step waits for it to close, as a name waits for Enter.
          if (step.check.kind === "annotation") expect(step.settle, step.id).toBe("annotation");
          // A demo lists edits only: the settlement's own action is the runner's (completionSweep.test.ts).
          if (typeof step.settle === "object")
            expect(
              step.demo.map((d) => d.kind),
              `${step.id}: Skip selects for the settlement`,
            ).not.toContain("select");
          expect(step.solution.length, `${step.id} has a solution path for its e2e`).toBeGreaterThan(0);
        }
      });

      it("writes prop paths, patches and Live numbers that can hold", () => {
        for (const step of tutorial.steps) {
          for (const check of checksIn(step.check)) {
            if (check.kind === "prop") {
              if (typeof check.prop === "string") {
                // "settings.4.secret" is a key with dots in it, never a path: write ["settings", 4, "secret"].
                expect(check.prop, `${step.id}: a dotted prop`).not.toContain(".");
                expect(UNSAFE_KEYS.has(check.prop), `${step.id}: ${check.prop}`).toBe(false);
              } else expect(pathProblem(check.prop), `${step.id}: ${JSON.stringify(check.prop)}`).toBeUndefined();
              if (check.measure === "length")
                expect(Number.isInteger(check.value) && check.value >= 0, `${step.id}: a length`).toBe(true);
            }
            if (check.kind === "compare") {
              // A delta since the step began has no baseline once another step is current: it must latch.
              if (sinceIn(check.left) || sinceIn(check.right))
                expect(step.sticky, `${step.id}: sinceStep needs a sticky step`).toBe(true);
              if (typeof check.right === "number") expect(Number.isFinite(check.right), step.id).toBe(true);
              for (const e of [check.left, check.right]) {
                const value = typeof e === "object" && "sinceStep" in e ? e.sinceStep : e;
                if (typeof value !== "object" || !("every" in value)) continue;
                expect(!!value.every.stencils?.length || !!value.every.role, `${step.id}: every needs a spec`).toBe(
                  true,
                );
                for (const id of value.every.stencils ?? []) expect(stencilIds, id).toContain(id);
              }
            }
          }
          // Live's own controls, pressed by Skip: the step checks what they change, so Skip can finish it.
          const checks = checksIn(step.check);
          for (const demo of step.demo) {
            if (demo.kind === "traffic")
              expect(
                checks.some((c) => c.kind === "simulation" && c.traffic === demo.on),
                `${step.id}: a traffic demo's step checks that traffic`,
              ).toBe(true);
            if (demo.kind === "trace")
              expect(
                checks.some((c) => c.kind === "trace"),
                `${step.id}: a trace demo's step checks the trace`,
              ).toBe(true);
            if (demo.kind === "slowmo")
              expect(
                checks.some((c) => c.kind === "slowmo"),
                `${step.id}: a slow-motion demo's step checks slow motion`,
              ).toBe(true);
            if (demo.kind === "openView")
              expect(
                checks.some((c) => c.kind === "liveView" && c.view === demo.view && c.open),
                `${step.id}: opening ${demo.view} is checked as open`,
              ).toBe(true);
            if (demo.kind === "inputs")
              expect(
                checks.some((c) => c.kind === "inputs" && c.input === demo.input),
                `${step.id}: setting ${demo.input} is checked`,
              ).toBe(true);
            // Skip continues the note the step is about: the step checks it was continued, at that run's time.
            if (demo.kind === "continueNote")
              expect(
                checks.some((c) => c.kind === "note" && !c.waiting) &&
                  checks.some((c) => c.kind === "simulation" && c.id === demo.simulation),
                `${step.id}: a continued note is checked as continued, in its run`,
              ).toBe(true);
            if (demo.kind === "saveSimulation") {
              expect(demo.id, step.id).toMatch(/^[a-z0-9-]+$/);
              expect(
                checks.some((c) => c.kind === "savedSimulation" || (c.kind === "simulation" && !!c.saved)),
                `${step.id}: an authored simulation is checked by what it is`,
              ).toBe(true);
            }
          }
          // Restore clears a Fault an earlier step made: that step latches, or clearing it would undo it.
          for (const check of checks)
            if (check.kind === "fault" && check.absent) {
              const target = JSON.stringify(check.edge ?? check.subject);
              const earlier = tutorial.steps
                .slice(0, tutorial.steps.indexOf(step))
                .find((s) =>
                  checksIn(s.check).some(
                    (c) => c.kind === "fault" && !c.absent && JSON.stringify(c.edge ?? c.subject) === target,
                  ),
                );
              expect(earlier?.sticky, `${step.id}: the Fault it clears is set by a sticky step first`).toBe(true);
            }
          for (const demo of step.demo) {
            if (demo.kind !== "patch") continue;
            expect(demo.patches.length, `${step.id}: a patch with nothing in it`).toBeGreaterThan(0);
            // A run can override only a connection's caller fields and a node's props.
            if (demo.runs && demo.edge)
              expect(
                demo.patches.every((patch) => patch.path[0] === "caller" && typeof patch.path[1] === "string"),
                `${step.id}: a connection's run repair edits caller fields`,
              ).toBe(true);
            if (demo.runs)
              expect(new Set(demo.runs.map((run) => JSON.stringify(run))).size, `${step.id}: a run named twice`).toBe(
                demo.runs.length,
              );
            for (const patch of demo.patches) {
              expect(pathProblem(patch.path), `${step.id}: ${JSON.stringify(patch.path)}`).toBeUndefined();
              if (patch.op === "ensureItem") {
                expect(Object.keys(patch.match).length, `${step.id}: ensureItem matches nothing`).toBeGreaterThan(0);
                for (const key of [...Object.keys(patch.match), ...Object.keys(patch.with ?? {})])
                  expect(UNSAFE_KEYS.has(key), `${step.id}: ${key}`).toBe(false);
              } else expect(patch.value, `${step.id}: ${patch.op} writes nothing`).not.toBeUndefined();
            }
          }
        }
      });

      it("runs only simulations its start has, or that an earlier step saves", () => {
        if (typeof tutorial.start !== "function") return;
        const known = new Set((tutorial.start().simulations ?? []).map((sim) => sim.id));
        for (const step of tutorial.steps) {
          for (const demo of step.demo) {
            if (demo.kind === "runSimulation" || demo.kind === "continueNote" || demo.kind === "patch") {
              const ids =
                demo.kind === "runSimulation"
                  ? [demo.id]
                  : demo.kind === "continueNote"
                    ? [demo.simulation]
                    : (demo.runs ?? []).filter((run): run is string => typeof run === "string");
              for (const id of ids) expect(known, `${step.id}: ${id}`).toContain(id);
            }
            if (demo.kind === "saveSimulation") known.add(demo.id);
          }
          for (const id of simulationIds(step.check)) expect(known, `${step.id}: ${id}`).toContain(id);
        }
      });

      it("starts only from public examples and simulations they contain", () => {
        if (typeof tutorial.start === "function") return;
        // Read the public index as text: importing it in Node would evaluate Vite's dev-only glob.
        const index = readFileSync("src/examples/index.ts", "utf8");
        const slug = tutorial.start.example;
        expect([...index.matchAll(/slug: "([a-z0-9-]+)"/g)].map((m) => m[1])).toContain(slug);
        expect(slug).toMatch(/^[a-z0-9-]+$/);
        const file = JSON.parse(readFileSync(join("src/examples", `${slug}.json`), "utf8")) as {
          simulations?: { id: string }[];
        };
        const ids = file.simulations?.map((s) => s.id) ?? [];
        if (tutorial.start.simulation) expect(ids).toContain(tutorial.start.simulation);
        for (const step of tutorial.steps)
          for (const id of simulationIds(step.check)) expect(ids, step.id).toContain(id);
        for (const step of tutorial.steps)
          for (const demo of step.demo) if (demo.kind === "runSimulation") expect(ids, step.id).toContain(demo.id);
      });
    });
});

function containsLabel(check: Check): boolean {
  return check.kind === "label" || (check.kind === "all" && check.checks.some(containsLabel));
}
function simulationIds(check: Check): string[] {
  // A simulation the learner authors (saved) isn't in the start's; the demo that saves it says its id.
  return check.kind === "simulation"
    ? check.id
      ? [check.id]
      : []
    : check.kind === "expectation"
      ? [check.simulation]
      : check.kind === "all"
        ? check.checks.flatMap(simulationIds)
        : [];
}
