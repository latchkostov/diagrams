import { test, expect, gotoCanvas, publicExamples, expectNoErrors } from "./fixtures";

// First run and starting a diagram: the bare URL opens a blank canvas with the start card, the
// card's three ways in, File > New diagram (with Undo), the one-time hint and the node tooltip.

test.describe("first run", () => {
  test("a bare URL opens your (blank) diagram with the start card", async ({ page, consoleErrors }) => {
    await page.goto("./");
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveValue("imported");
    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    // Only public examples are offered.
    for (const ex of publicExamples) await expect(page.getByTestId(`start-example-${ex.slug}`)).toBeVisible();
    await expect(page.getByTestId(/^start-example-/)).toHaveCount(publicExamples.length);
    // Nothing to simulate yet: no Live toggle, no minimap.
    await expect(page.getByTestId("live-toggle")).toHaveCount(0);
    await expect(page.getByTestId("canvas-minimap")).toHaveCount(0);

    await page.getByTestId(`start-example-${publicExamples[0].slug}`).click();
    await expect(page.getByTestId("example-picker")).toHaveValue(publicExamples[0].slug);
    await expect(page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Start blank opens the stencil search; adding a node retires the card", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    await expect(page.getByTestId("palette-search")).toBeFocused();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("canvas-empty")).toHaveCount(0);
    await expect(page.getByTestId("live-toggle")).toBeVisible();
  });

  test("the start card's import buttons open the file and paste flows", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-paste").click();
    await expect(page.getByTestId("paste-dialog")).toBeVisible();
  });

  test("File > New diagram replaces your diagram, with Undo", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-toggle")).toBeVisible();

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    await page.getByTestId("new-diagram-undo").click();
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    await expect(page.getByTestId("live-toggle")).toBeVisible();
  });

  test("the one-time hint retires on dismiss and stays gone", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const hint = page.getByTestId("first-run-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("saved simulation");
    await page.getByTestId("first-run-hint-dismiss").click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(hint).toHaveCount(0);
  });

  test("nodes show the app tooltip, not a native title", async ({ page }) => {
    const ex = publicExamples.find((e) => e.slug === "kafka-order-pipeline") ?? publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const node = page.getByTestId(`node-${ex.nodeIds[0]}`);
    expect(await node.evaluate((el) => el.querySelectorAll("[title]").length)).toBe(0);
    await node.hover();
    await expect(page.getByTestId("node-tooltip")).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("node-tooltip")).toHaveCount(0);
  });
});
