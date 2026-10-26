import { afterEach, expect, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../i18n";
import { stencils } from "../stencils/registry";
import { searchStencils } from "../lib/stencilDisplaySearch";
import { allTutorials } from "./catalog";
import type { Check } from "./types";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

const locales = ["en", ...Object.keys(catalogs).filter((code) => code !== "en-XA")];
async function language(code: string) {
  state.l = code;
  state.c = code === "en" ? undefined : ((await catalogs[code]()).default as Catalog);
}

const leaves = (check: Check): Check[] => (check.kind === "all" ? check.checks.flatMap(leaves) : [check]);

it.each(locales)("%s: tutorial instructions contain the exact values their checks require", async (code) => {
  await language(code);
  for (const tutorial of allTutorials) {
    for (const step of tutorial.steps) {
      for (const check of leaves(step.check)) {
        const values: string[] = [];
        if (check.kind === "label" || (check.kind === "field" && check.is)) values.push(check.is!());
        if (check.kind === "prop" && Array.isArray(check.prop)) {
          for (const segment of check.prop)
            if (typeof segment === "object" && "where" in segment && typeof segment.where.key === "string")
              values.push(segment.where.key);
        }
        for (const value of values)
          expect.soft(step.goal(), `${code}/${tutorial.id}/${step.id}: ${value}`).toContain(value);
      }
    }
  }
});

it.each(locales)("localized tutorial guides find their intended stencil (%s)", async (code) => {
  await language(code);
  for (const tutorial of allTutorials) {
    for (const step of tutorial.steps) {
      const intended = step.demo.filter((demo) => demo.kind === "add" || demo.kind === "insert");
      const queries: { text: string; enter: boolean }[] = [];
      if (step.guide?.quickAdd) queries.push({ text: step.guide.quickAdd(), enter: true });
      for (const [i, action] of step.solution.entries()) {
        if (
          ("fill" in action &&
            (["quick-add-search", "palette-search"].includes(action.fill) ||
              (action.fill === "command-input" && intended.length > 0))) ||
          ("type" in action && typeof action.type === "function")
        ) {
          const text = "fill" in action ? action.text : action.type;
          const next = step.solution[i + 1];
          queries.push({
            text: typeof text === "function" ? text() : text,
            enter: !!next && "press" in next && next.press === "Enter",
          });
        }
      }
      expect(queries.length, `${tutorial.id}/${step.id}: every search has an intended stencil`).toBeLessThanOrEqual(
        intended.length,
      );
      for (const [i, query] of queries.entries()) {
        if (
          ["quick-add/add-app", "api-gateway/add-app", "command-palette/add", "insert-on-edge/insert"].includes(
            `${tutorial.id}/${step.id}`,
          )
        )
          expect.soft(step.goal(), `${code}/${tutorial.id}/${step.id}: instructed search`).toContain(query.text);
        const target = intended[i].stencil;
        const found = searchStencils(stencils, query.text).map((s) => s.id);
        const context = `${code}/${tutorial.id}/${step.id}: ${JSON.stringify(query.text)} -> ${target}`;
        expect.soft(found, context).toContain(target);
        if (query.enter) expect.soft(found[0], context).toBe(target);
      }
    }
  }
});
