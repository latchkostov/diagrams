import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// Canvas palette: search first, family filter, collapsible categories, recently used on top.
// Selectors are data-testid only. Uses a public example (src/examples/aws-serverless-orders.json).

const SLUG = "aws-serverless-orders";

test.describe("palette", () => {
  test.beforeEach(async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId("palette-search")).toBeVisible();
  });

  test("search ranks matches (aliases included) and Enter adds the first", async ({ page, consoleErrors }) => {
    await page.getByTestId("palette-search").fill("sb");
    await expect(page.getByTestId("palette-results")).toBeVisible();
    await expect(page.getByTestId("palette-item-azure.service-bus.queue")).toBeVisible();
    await expect(page.getByTestId("palette-item-kafka.topic")).toHaveCount(0);

    await page.getByTestId("palette-search").fill("pg");
    await expect(page.getByTestId("palette-item-postgres")).toBeVisible();
    await page.getByTestId("palette-search").press("Enter");
    await expect(page.getByTestId("node-postgres-1")).toBeVisible();

    await page.getByTestId("palette-search").fill("zzz-nothing");
    await expect(page.getByTestId("palette-empty")).toBeVisible();
    await page.getByTestId("palette-search-clear").click();
    await expect(page.getByTestId("palette-section-messaging")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("family filter narrows the list and is remembered", async ({ page }) => {
    await page.getByTestId("palette-family").selectOption("aws");
    await expect(page.getByTestId("palette-item-aws.sqs")).toBeVisible();
    await expect(page.getByTestId("palette-item-azure.functions")).toHaveCount(0);
    await expect(page.getByTestId("palette-item-kafka.topic")).toHaveCount(0);

    // Search stays inside the family, and offers a way out.
    await page.getByTestId("palette-search").fill("service bus");
    await expect(page.getByTestId("palette-empty")).toBeVisible();
    await page.getByTestId("palette-all-families").click();
    await expect(page.getByTestId("palette-item-azure.service-bus.queue")).toBeVisible();

    await page.getByTestId("palette-family").selectOption("azure");
    await page.reload();
    await expect(page.getByTestId("palette-family")).toHaveValue("azure");
    // Compute starts folded on a first visit.
    await page.getByTestId("palette-section-compute").click();
    await expect(page.getByTestId("palette-item-azure.functions")).toBeVisible();
    await expect(page.getByTestId("palette-item-aws.sqs")).toHaveCount(0);
  });

  test("a first visit opens only the first category; categories collapse and stay collapsed", async ({ page }) => {
    // With 150+ stencils the rail starts as an overview: Messaging open, the rest folded with counts.
    await expect(page.getByTestId("palette-section-compute")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("palette-item-aws.lambda")).toHaveCount(0);
    const header = page.getByTestId("palette-section-messaging");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("palette-item-kafka.topic")).toBeVisible();
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("palette-item-kafka.topic")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("palette-section-messaging")).toHaveAttribute("aria-expanded", "false");
    // Search ignores folding.
    await page.getByTestId("palette-search").fill("kafka topic");
    await expect(page.getByTestId("palette-item-kafka.topic")).toBeVisible();
  });

  test("recently used stencils are pinned on top", async ({ page }) => {
    await expect(page.getByTestId("palette-recent")).toHaveCount(0);
    await page.getByTestId("palette-section-compute").click();
    await page.getByTestId("palette-section-data").click();
    await page.getByTestId("palette-item-aws.lambda").click();
    await expect(page.getByTestId("node-lambda-1")).toBeVisible();
    await page.getByTestId("palette-item-redis.cache").click();

    const recent = page.getByTestId("palette-recent");
    await expect(recent).toBeVisible();
    const order = await recent
      .getByTestId(/^palette-recent-item-/)
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(order).toEqual(["palette-recent-item-redis.cache", "palette-recent-item-aws.lambda"]);

    // A recent tile adds like any palette item, and survives a reload.
    await page.getByTestId("palette-recent-item-aws.lambda").click();
    await expect(page.getByTestId("node-lambda-2")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("palette-recent-item-aws.lambda")).toBeVisible();
  });

  test("palette items and node cursors match their behaviour", async ({ page }) => {
    const cursor = (testId: string) => page.getByTestId(testId).evaluate((el) => getComputedStyle(el).cursor);
    expect(await cursor("palette-item-aws.sqs")).toBe("grab");
    expect(await cursor("palette-section-messaging")).toBe("pointer");
    expect(await cursor("palette-search")).toBe("text");
    const node = page.getByTestId(/^node-/).first();
    expect(await node.evaluate((el) => getComputedStyle(el).cursor)).toBe("move");
  });
});
