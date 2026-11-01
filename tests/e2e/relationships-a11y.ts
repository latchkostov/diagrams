import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { waitForViewEntranceInPage } from "./view-entrance";

/** Audit settled relationship surfaces, retaining the menu's own fade acknowledgement. */
export async function expectNoRelationshipViolations(page: Page, scope?: string) {
  await page.evaluate(waitForViewEntranceInPage);
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (scope) await expect(page.getByTestId(scope)).toHaveCSS("opacity", "1");
  if (scope) axe = axe.include(`[data-testid="${scope}"]`);
  const { violations } = await axe.analyze();
  const report = violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
  expect(report, report.join("\n")).toEqual([]);
}
