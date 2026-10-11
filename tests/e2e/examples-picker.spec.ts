import { test, expect, publicExamples, expectNoErrors } from "./fixtures";

// With 15+ examples, the picker and the start card group them by theme so neither becomes a wall of
// titles: the picker has one group per theme, and the start card shows a few featured examples with
// "All examples" for the rest.

const THEMES = ["streaming", "data", "cloud", "integration", "reliability"];

test.describe("examples by theme", () => {
  test("the picker groups every public example under exactly one theme", async ({ page, consoleErrors }) => {
    await page.goto("./");
    const picker = page.getByTestId("example-picker");
    await expect(picker).toBeVisible();
    // Your diagrams first, then the themes in order.
    const groups = await picker
      .locator("optgroup")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(groups.filter((g) => g !== "picker-group-examples")).toEqual([
      "picker-group-yours",
      ...THEMES.map((t) => `picker-group-${t}`),
    ]);
    const themed = new Map<string, string>();
    for (const theme of THEMES) {
      const slugs = await page
        .getByTestId(`picker-group-${theme}`)
        .locator("option")
        .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
      expect(slugs.length, theme).toBeGreaterThan(0);
      for (const slug of slugs) {
        expect(themed.has(slug), `${slug} is in two themes`).toBe(false);
        themed.set(slug, theme);
      }
    }
    for (const ex of publicExamples) expect(themed.has(ex.slug), `${ex.slug} has a theme`).toBe(true);

    // Picking from a theme group opens that example.
    const target = publicExamples.find((ex) => themed.get(ex.slug) === "reliability");
    if (!target) throw new Error("no reliability example");
    await picker.selectOption(target.slug);
    await expect(page.getByTestId(`node-${target.nodeIds[0]}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the start card shows featured examples, and All examples opens the rest by theme", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("./");
    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    const rows = card.getByTestId(/^start-example-.*(?<!-thumb)$/);
    const featured = await rows.count();
    expect(featured).toBeGreaterThan(0);
    expect(featured).toBeLessThan(publicExamples.length);

    const all = page.getByTestId("start-all-examples");
    await expect(all).toHaveAttribute("aria-expanded", "false");
    await expect(all).toHaveText(/All examples/);
    await all.click();
    await expect(all).toHaveAttribute("aria-expanded", "true");
    await expect(rows).toHaveCount(publicExamples.length);
    for (const theme of ["event-streaming", "data-ai", "cloud-apps", "integration", "reliability"])
      await expect(page.getByTestId(`start-theme-${theme}`)).toBeVisible();
    // Fewer folds it back to the featured few.
    await all.click();
    await expect(rows).toHaveCount(featured);

    // A featured example opens from the card.
    const first = await rows.first().getAttribute("data-testid");
    const slug = (first ?? "").slice("start-example-".length);
    await rows.first().click();
    await expect(page.getByTestId("example-picker")).toHaveValue(slug);
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });
});
