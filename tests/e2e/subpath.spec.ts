import { test, expect, publicExamples, expectNoErrors } from "./fixtures";

/**
 * Runs against the production build served by `vite preview --base /tools/diagrams/` (project
 * "subpath" in playwright.config.ts): the app must work when embedded under a sub-path, ship no
 * private examples, and keep the Lab off the nav while still reachable by URL.
 */
const BASE = "/tools/diagrams/";

test.describe("production build under a sub-path", () => {
  test.beforeEach(async ({ page, consoleErrors }) => {
    page.on("response", (r) => {
      if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} for ${r.url()}`);
    });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.hostname === "localhost" && !u.pathname.startsWith(BASE))
        consoleErrors.push(`Request outside ${BASE}: ${u.pathname}`);
    });
  });

  test("gallery loads with every icon", async ({ page, consoleErrors }) => {
    await page.goto("./?view=gallery");
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    const tiles = page.getByTestId(/^stencil-tile-/);
    expect(await tiles.count()).toBeGreaterThan(50);
    const broken = await tiles.evaluateAll(async (els) => {
      const bad: string[] = [];
      for (const el of els)
        for (const img of el.querySelectorAll("img")) {
          if (!img.complete)
            await new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            });
          if (!(img.naturalWidth > 0)) bad.push(el.getAttribute("data-testid") ?? "missing test id");
        }
      return bad;
    });
    expect(broken).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("canvas renders examples; only public examples ship", async ({ page, consoleErrors }) => {
    const ex = publicExamples[0];
    await page.goto(`./?view=canvas&example=${ex.slug}`);
    for (const id of ex.nodeIds) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
    const options = await page
      .getByTestId("example-picker")
      .evaluate((el) => [...(el as HTMLSelectElement).options].map((o) => o.value));
    // "imported" is your own diagram's slot (blank until you start one); the rest are the public examples.
    expect(options.filter((o) => o !== "imported").sort()).toEqual(publicExamples.map((e) => e.slug).sort());
    expectNoErrors(consoleErrors);
  });

  test("Lab is hidden from the nav but works by URL", async ({ page, consoleErrors }) => {
    await page.goto("./?view=gallery");
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    await expect(page.getByTestId("view-lab")).toHaveCount(0);
    await page.goto("./?view=lab&preset=stress-10");
    await expect(page.getByTestId("lab-view")).toBeVisible();
    await expect(page.getByTestId("lab-render-time")).toHaveAttribute("data-ms", /^\d+$/);
    await expect(page.getByTestId(/^node-n\d+$/)).toHaveCount(10);
    // No private example presets in production.
    const links = await page.getByTestId(/^lab-preset-link-example-/).evaluateAll((els) =>
      els.map((e) => {
        const id = e.getAttribute("data-testid");
        if (!id) throw new Error("Example link has no test id");
        return id.slice("lab-preset-link-example-".length);
      }),
    );
    expect(links.sort()).toEqual(publicExamples.map((e) => e.slug).sort());
    expectNoErrors(consoleErrors);
  });
});
