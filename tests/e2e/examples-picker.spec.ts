import type { Locator } from "@playwright/test";
import { test, expect, publicExamples, expectNoErrors, pageLoadTimeout } from "./fixtures";

// With 15+ examples, the picker and the start card group them by theme so neither becomes a wall of
// titles: the picker has one group per theme, and the start card shows a few featured examples with
// "All examples" for the rest.

/** Every public example's intended theme, in display order (src/examples/themes.ts and index.ts). */
const BY_THEME: Record<string, string[]> = {
  streaming: [
    "kafka-order-pipeline",
    "cqrs-event-sourcing",
    "cdc-analytics",
    "iot-telemetry",
    "partitions-vs-subscriptions",
    "shared-worker-pool",
  ],
  data: [
    "event-driven-data-platform",
    "nightly-batch-elt",
    "gcp-streaming-analytics",
    "rag-assistant",
    "shared-api-quotas",
  ],
  cloud: ["aws-serverless-orders", "aws-fanout", "aks-app-config-key-vault", "serverless-burst-buffer"],
  integration: ["webhook-ingestion", "notification-fanout", "azure-service-bus-integration"],
  reliability: [
    "outbox-saga-checkout",
    "multi-region-active-active",
    "branch-to-datacentre",
    "measured-order-capacity",
    "contoso-dmz",
  ],
};
const THEMES = Object.keys(BY_THEME);

/** The examples the collapsed start card offers, in order. */
const FEATURED = ["kafka-order-pipeline", "event-driven-data-platform", "rag-assistant", "aws-serverless-orders"];

/** The slugs behind the matching test IDs, in DOM order. */
async function slugs(rows: Locator, prefix: string) {
  const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""));
  return ids.map((id) => id.slice(prefix.length));
}

const startRows = (scope: Locator) => scope.getByTestId(/^start-example-.*(?<!-thumb)$/);

test.describe("examples by theme", () => {
  test("every public example has an intended theme", () => {
    expect(Object.values(BY_THEME).flat().sort()).toEqual(publicExamples.map((ex) => ex.slug).sort());
  });

  test("the picker groups every public example under exactly one theme", async ({ page, consoleErrors }) => {
    await page.goto("./");
    const picker = page.getByTestId("example-picker");
    await expect(picker).toBeVisible();
    // Your diagrams first, then the themes in order.
    const groups = await slugs(picker.getByTestId(/^picker-group-/), "picker-group-");
    expect(groups.filter((g) => g !== "examples")).toEqual(["yours", ...THEMES]);

    // Picking from a theme group opens that example.
    const target = publicExamples.find((ex) => ex.slug === BY_THEME.reliability[0]);
    if (!target) throw new Error("no reliability example");
    await picker.selectOption(target.slug);
    await expect(page.getByTestId(`node-${target.nodeIds[0]}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("examples appear under their intended themes", async ({ page, consoleErrors }) => {
    await page.goto("./");
    await expect(page.getByTestId("example-picker")).toBeVisible();
    for (const theme of THEMES) {
      const options = page.getByTestId(`picker-group-${theme}`).getByTestId(/^picker-option-/);
      expect(await slugs(options, "picker-option-"), `picker: ${theme}`).toEqual(BY_THEME[theme]);
    }

    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    await page.getByTestId("start-all-examples").click();
    await expect(startRows(card)).toHaveCount(publicExamples.length);
    expect(await slugs(card.getByTestId(/^start-theme-/), "start-theme-")).toEqual(THEMES);
    for (const theme of THEMES) {
      const rows = startRows(card.getByTestId(`start-theme-${theme}`));
      expect(await slugs(rows, "start-example-"), `start card: ${theme}`).toEqual(BY_THEME[theme]);
    }
    expectNoErrors(consoleErrors);
  });

  test("the collapsed start card shows exactly the featured examples", async ({ page, consoleErrors }) => {
    await page.goto("./");
    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    const rows = startRows(card);
    const notFeatured = publicExamples.map((ex) => ex.slug).filter((slug) => !FEATURED.includes(slug));
    const expectFeaturedOnly = async () => {
      await expect(rows).toHaveCount(FEATURED.length);
      expect(await slugs(rows, "start-example-")).toEqual(FEATURED);
      for (const slug of notFeatured) await expect(card.getByTestId(`start-example-${slug}`)).toHaveCount(0);
    };
    await expectFeaturedOnly();

    const all = page.getByTestId("start-all-examples");
    await expect(all).toHaveAttribute("aria-expanded", "false");
    await expect(all).toHaveText(/All examples/);
    await all.click();
    await expect(all).toHaveAttribute("aria-expanded", "true");
    await expect(rows).toHaveCount(publicExamples.length);
    // Fewer folds it back to the featured few.
    await all.click();
    await expectFeaturedOnly();

    // A featured example opens from the card.
    await card.getByTestId(`start-example-${FEATURED[1]}`).click();
    await expect(page.getByTestId("example-picker")).toHaveValue(FEATURED[1]);
    // Selection updates before its lazy diagram has arrived, especially during concurrent builds.
    const selected = publicExamples.find((e) => e.slug === FEATURED[1]);
    if (!selected) throw new Error("Missing featured example");
    await expect(page.getByTestId(`node-${selected.nodeIds[0]}`)).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });
});
