import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stencils } from "../stencils/registry";
import { stencilRole } from "../stencils/roles";
import { tutorials } from "./catalog";
import { tutorialIds } from "./catalog/ids";
import { tutorialMetadata } from "./metadata";
import type { Check, Demo, TutorialStep, UiStep } from "./types";

/**
 * The authoring lint: every tutorial is checked against the app it teaches, so a renamed test id, a missing message
 * or a step that can't be done fails here rather than in front of a learner. The generated e2e
 * (tests/e2e/tutorials.spec.ts) then plays each one through the real UI.
 */

/** Every test id the app's source can render, as literal text or template prefixes (never the private examples). */
const source = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (path.replaceAll("\\", "/").includes("src/examples/private")) continue;
      if (statSync(path).isDirectory()) walk(path);
      // Tutorial declarations aren't evidence of a rendered control, including the Lab's runtime data.
      else if (
        /\.tsx?$/.test(name) &&
        !/\.test\.tsx?$/.test(name) &&
        !path.includes(join("src", "tutorials")) &&
        !path.endsWith(join("lab", "tutorialRuntimeFixture.ts"))
      )
        out.push(readFileSync(path, "utf8"));
    }
  };
  walk("src");
  return out.join("\n");
})();

const stencilIds = new Set(stencils.map((s) => s.id));
/**
 * A test id is known when the source renders it: quoted whole, or built from a template's fixed prefix ("palette-item-"
 * before a placeholder) and a known rest (a stencil id, another quoted part). A subject (`{app}`) stands for a node id.
 */
function knownTestId(id: string): boolean {
  if (!id) return true;
  if (/^\{\w+\}/.test(id)) return knownTestId(id.replace(/^\{\w+\}/, ""));
  if (source.includes(`"${id}"`) || source.includes(`'${id}'`) || stencilIds.has(id)) return true;
  for (let i = id.length - 1; i > 0; i--) {
    if (!"-:".includes(id[i - 1])) continue;
    if (source.includes(id.slice(0, i) + "${") && knownTestId(id.slice(i))) return true;
  }
  return false;
}

const subjectsIn = (check: Check): string[] =>
  check.kind === "prop" || check.kind === "fault"
    ? check.edge
      ? [...check.edge]
      : [check.subject]
    : check.kind === "member"
      ? [check.subject, check.boundary]
      : check.kind === "metric"
        ? [check.subject, ...(check.edge ?? [])]
        : check.kind === "node" || check.kind === "label" || check.kind === "processed"
          ? [check.subject]
          : check.kind === "edge" || check.kind === "relation"
            ? [check.from, check.to]
            : check.kind === "all"
              ? check.checks.flatMap(subjectsIn)
              : [];
const demoSubjects = (d: Demo): string[] =>
  d.kind === "add"
    ? [d.subject, ...(d.after ? [d.after] : [])]
    : d.kind === "prop" || d.kind === "fault"
      ? d.edge
        ? [...d.edge]
        : [d.subject]
      : d.kind === "group"
        ? [...d.subjects, d.boundary]
        : d.kind === "select"
          ? [...d.subjects]
          : d.kind === "connect" || d.kind === "relation"
            ? [d.from, d.to]
            : d.kind === "rename"
              ? [d.subject]
              : [];
const testIdsOf = (s: UiStep): string[] =>
  "click" in s
    ? [s.click]
    : "dblclick" in s
      ? [s.dblclick]
      : "hover" in s
        ? [s.hover]
        : "fill" in s
          ? [s.fill]
          : "drag" in s
            ? [s.drag, s.to]
            : [];
const templates = (testId: string) => [...testId.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const words = (step: TutorialStep) => [step.title, step.goal, step.hint, step.done].filter((w) => !!w);

describe("tutorial catalog", () => {
  it("has unique ids and a version, listed for the generated e2e", () => {
    const ids = tutorials.map((t) => t.id);
    expect(ids).toEqual([...tutorialIds]);
    expect(tutorialMetadata.map((x) => x.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of tutorials) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.version).toBeGreaterThanOrEqual(1);
      expect(t.steps.length).toBeGreaterThan(0);
      expect(new Set(t.steps.map((s) => s.id)).size).toBe(t.steps.length);
    }
  });

  for (const tutorial of tutorials)
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
        const known = stencilIds;
        for (const spec of Object.values(tutorial.subjects)) {
          for (const id of spec.stencils ?? []) expect(known, id).toContain(id);
          if (!spec.stencils && !spec.boundary) expect(spec.role).toBeDefined();
        }
        for (const step of tutorial.steps) {
          const used = [
            ...subjectsIn(step.check),
            ...step.demo.flatMap(demoSubjects),
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
          const moment = step.sticky || step.demo.length === 0;
          if (moment)
            expect(
              [
                "processed",
                "live",
                "metric",
                "simulation",
                "expectation",
                "fault",
                "trace",
                "slowmo",
                "note",
                "mode",
                "all",
              ],
              step.id,
            ).toContain(step.check.kind);
          if (!step.demo.length) expect(step.sticky, `${step.id}: moments are explicitly sticky`).toBe(true);
          if (containsLabel(step.check)) expect(step.settle, step.id).toBe("naming");
          expect(step.solution.length, `${step.id} has a solution path for its e2e`).toBeGreaterThan(0);
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
  return check.kind === "simulation"
    ? [check.id]
    : check.kind === "expectation"
      ? [check.simulation]
      : check.kind === "all"
        ? check.checks.flatMap(simulationIds)
        : [];
}
