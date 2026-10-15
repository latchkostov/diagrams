import { afterEach, expect, it } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../i18n/core";
import { planningP3Fixture } from "../lab/planningP3Fixture";
import { runChecks } from "./run";
import { presentFinding } from "./presentation";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
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
