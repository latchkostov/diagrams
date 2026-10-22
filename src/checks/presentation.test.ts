import { afterEach, expect, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../i18n/core";
import { planningP3Fixture } from "../lab/planningP3Fixture";
import { runChecks, RULES } from "./run";
import { presentFinding, presentRule } from "./presentation";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

it("the new rules' About text translates without changing their agent-facing English", async () => {
  const rules = RULES.filter((r) => ["blocked-threads", "scaling-blind", "call-timeout"].includes(r.id));
  const english = structuredClone(rules.map(({ id, name, about }) => ({ id, name, about })));
  state.l = "ar";
  state.c = (await catalogs.ar()).default as Catalog;
  expect(rules).toHaveLength(3);
  for (const rule of rules) {
    const shown = presentRule(rule);
    expect(shown.id).toBe(rule.id);
    expect(shown.name).not.toBe(rule.name);
    expect(shown.about).not.toBe(rule.about);
  }
  expect(rules.map(({ id, name, about }) => ({ id, name, about }))).toEqual(english);
});

it("managed capacity findings are deterministic across locales and translate cached results at render", async () => {
  const d = planningP3Fixture("generic.external-api");
  const english = runChecks(d);
  const finding = english.findings.find((f) => f.rule === "capacity")!;
  expect(finding.message).toContain("may be rejected.");
  const presentedEnglish = presentFinding(finding).message;
  state.l = "de";
  state.c = (await catalogs.de()).default as Catalog;
  expect(runChecks(d)).toEqual(english);
  const german = presentFinding(finding);
  expect(german.message).not.toEqual(finding.message);
  expect(german.message).toContain("abgelehnt");
  state.l = "en";
  state.c = undefined;
  expect(presentFinding(finding).message).toEqual(presentedEnglish);
});
