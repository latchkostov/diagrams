import { test, expect, expectNoErrors, pageLoadTimeout } from "./fixtures";
import { expectNoViolations } from "./a11y-helpers";

test("syllabus: finish, inspect seals, reset a chapter and Undo", async ({ page, consoleErrors }) => {
  await page.goto("./?view=tutorials");
  await expect(page.getByTestId("tutorials-resume")).toContainText("Start here: 1.1", { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("tutorials-overall")).toContainText("0 of 49 lessons · 0 of 7 seals");
  await expect(page.getByTestId("tutorials-chapter-basics")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("tutorial-open-mobile-api")).toHaveAccessibleName(/^Start 1\.1 .*Not started/);
  await expectNoViolations(page, "tutorials-view");
  await page.getByTestId("tutorials-resume-open").click();
  await page.getByTestId("tutorial-start").click();
  // A Skip can replay reference milestones; follow the rendered step, as the lesson sweep does.
  while ((await page.getByTestId("tutorial-step").getAttribute("data-phase")) === "step") {
    const step = await page.getByTestId("tutorial-step").getAttribute("data-step");
    await page.getByTestId("tutorial-skip").click();
    await expect(page.getByTestId("tutorial-step")).not.toHaveAttribute("data-step", step ?? "");
  }
  await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-phase", "finished");
  await page.getByTestId("tutorial-done-exit").click();
  const today = await page.evaluate(() => new Date().toLocaleDateString("en", { day: "numeric", month: "short" }));
  await expect(page.getByTestId("tutorial-status-mobile-api")).toHaveText(`Done · ${today}`);
  await expect(page.getByTestId("tutorial-open-mobile-api")).toHaveAccessibleName(/^Review 1\.1 .*Done/);
  await page.getByTestId("tutorials-seals").click();
  await expect(page.getByTestId("tutorials-seal-chapter-basics")).toContainText("Not yet · 1 of 12");
  await expect(page.getByTestId("tutorials-seal-whole-syllabus")).toContainText("Not yet · 1 of 49");
  await expectNoViolations(page, "tutorials-view");
  await page.getByTestId("tutorials-seals-back").click();
  await page.getByTestId("tutorials-reset-basics").click();
  await expect(page.getByTestId("tutorials-reset-dialog")).toHaveAttribute("role", "alertdialog");
  await expect(page.getByTestId("tutorials-reset-scope-track")).toBeChecked();
  await expect(page.getByTestId("tutorials-reset-counts")).toHaveText(
    "1 finished lesson, 0 in progress and 0 seals will be reset.",
  );
  await expectNoViolations(page, "tutorials-reset-dialog");
  await page.getByTestId("tutorials-reset-confirm").click();
  await expect(page.getByTestId("tutorial-status-mobile-api")).toHaveText("3 min · Level 1");
  // Undo is still useful after another surface unmounts and remounts the hub.
  await page.getByTestId("view-gallery").click();
  await page.getByTestId("view-tutorials").click();
  await page.getByTestId("tutorials-reset-undo").click();
  await expect(page.getByTestId("tutorial-status-mobile-api")).toHaveText(`Done · ${today}`);
  await expect(page.getByTestId("tutorials-overall")).toContainText("1 of 49 lessons");
  await page.reload();
  await expect(page.getByTestId("tutorial-status-mobile-api")).toHaveText(`Done · ${today}`);
  // The header opens the same dialog, with an explicit Everything scope.
  await page.getByTestId("tutorials-more").click();
  await page.getByTestId("context-menu-item-tutorials-reset").click();
  await expect(page.getByTestId("tutorials-reset-scope-all")).toBeChecked();
  await page.getByTestId("tutorials-reset-scope-lesson").check();
  await page.getByTestId("tutorials-reset-cancel").click();
  await expect(page.getByTestId("tutorials-more")).toBeFocused();
  await page.getByTestId("tutorials-more").click();
  await page.getByTestId("context-menu-item-tutorials-reset").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tutorials-more")).toBeFocused();
  await expect(page.getByTestId("tutorial-status-mobile-api")).toHaveText(`Done · ${today}`);
  expectNoErrors(consoleErrors);
});
