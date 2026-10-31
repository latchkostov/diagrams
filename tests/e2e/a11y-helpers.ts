import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { waitForViewEntranceInPage } from "./view-entrance";

/** Shared WCAG scan; scopes use only the app's public test ids. */
export async function expectNoViolations(page: Page, scope?: string) {
  await page.evaluate(waitForViewEntranceInPage);
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (scope) axe = axe.include(`[data-testid="${scope}"]`);
  const { violations } = await axe.analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes.map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.replace(/\n/g, "\n      ")}`).join("\n"),
  );
  expect(report, report.join("\n")).toEqual([]);
}
