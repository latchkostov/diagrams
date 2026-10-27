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

  test("production tutorials keep the sub-path without exposing test hooks", async ({ page, consoleErrors }) => {
    await page.goto("./?view=tutorials");
    await expect(page.getByTestId("view-tutorials")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("tutorials-view")).toBeVisible();
    await page.getByTestId("tutorial-open-mobile-api").click();
    await expect(page.getByTestId("tutorial-intro")).toBeVisible();
    await page.getByTestId("tutorial-start").click();
    await expect(page.getByTestId("tutorial-step")).toHaveAttribute("data-step", "add-app");
    expect(await page.evaluate(() => window.__tutorial)).toBeUndefined();
    expect(new URL(page.url()).pathname).toBe(BASE);
    await page.getByTestId("tutorial-exit").click();
    await expect(page.getByTestId("tutorials-view")).toBeVisible();
    await page.getByTestId("view-gallery").click();
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    await page.getByTestId("view-tutorials").click();
    await expect(page.getByTestId("tutorials-view")).toBeVisible();
    expectNoErrors(consoleErrors);
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
    await page.getByTestId("example-picker").click();
    await page.getByTestId("picker-browse-examples").click();
    await expect(page.getByTestId(/^example-card-/)).toHaveCount(publicExamples.length);
    expectNoErrors(consoleErrors);
  });

  test("with no storage variables, no provider is offered or contacted and the console stays clean", async ({
    page,
    consoleErrors,
  }) => {
    // The production deployment runs with no VITE_GOOGLE_*, VITE_ONEDRIVE_* or VITE_DROPBOX_* set.
    const PROVIDER_HOSTS =
      /(^|\.)(accounts\.google\.com|apis\.google\.com|googleapis\.com|login\.microsoftonline\.com|graph\.microsoft\.com|dropbox\.com|dropboxapi\.com)$/;
    const contacted: string[] = [];
    const warnings: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (PROVIDER_HOSTS.test(u.hostname)) contacted.push(r.url());
      // Provider code is split out and loads only when that provider is configured.
      if (/\/assets\/(gdrive|google|onedrive|dropbox|oauth|testProvider|StorageDialog)-/.test(u.pathname))
        contacted.push(r.url());
    });
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    const ex = publicExamples[0];
    // `storage=test` turns on the fake provider in dev builds only; production must ignore it.
    await page.goto(`./?view=canvas&example=${ex.slug}&storage=test`);
    await expect(page.getByTestId(`node-${ex.nodeIds[0]}`)).toBeVisible();
    await page.getByTestId("file-button").click();
    const menu = page.getByTestId("file-menu");
    await expect(menu.getByTestId("file-save")).toBeVisible();
    await expect(menu.getByTestId("file-open")).toBeVisible();
    for (const id of ["file-open-from", "file-save-to", "file-open-drive", "file-save-drive"])
      await expect(menu.getByTestId(id)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("save-status")).toHaveCount(0);
    // The OAuth callback and privacy pages ship with the build.
    for (const path of ["privacy.html", "terms.html", "auth.html"])
      expect((await page.request.get(`./${path}`)).status()).toBe(200);
    await page.goto("./privacy.html");
    await expect(page.getByTestId("privacy-title")).toHaveText("Privacy policy");
    expect(contacted).toEqual([]);
    expect(warnings).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("live view draws in its worker under the sub-path, in the app and in an embed", async ({
    page,
    consoleErrors,
  }) => {
    // The particle worker is a separate chunk found relative to the bundle (base "./"): a wrong
    // path would 404 (outside BASE, which beforeEach reports) and the fallback would take over.
    const workers: string[] = [];
    page.on("worker", (w) => workers.push(w.url()));
    await page.goto("./?view=canvas&example=kafka-order-pipeline&live=1");
    await expect(page.getByTestId("live-controls")).toBeVisible();
    const canvas = page.getByTestId("live-canvas");
    await expect(canvas).toHaveAttribute("data-renderer", "worker");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-particles")), { timeout: 10_000 })
      .toBeGreaterThan(10);
    await expect.poll(async () => Number(await canvas.getAttribute("data-frames"))).toBeGreaterThan(20);
    await expect(canvas).toHaveAttribute("data-renderer", "worker");
    expect(workers.some((u) => new URL(u).pathname.startsWith(`${BASE}assets/particleWorker-`))).toBe(true);

    // The same build framed by another page, as an embed.
    const embed = new URL("./?embed=1&example=kafka-order-pipeline&live=1", page.url()).href;
    await page.setContent(
      `<iframe data-testid="embed-frame" src="${embed}" style="width:1000px;height:640px;border:0"></iframe>`,
    );
    const frame = page.frameLocator('[data-testid="embed-frame"]');
    const embedded = frame.getByTestId("live-canvas");
    await expect(embedded).toHaveAttribute("data-renderer", "worker", { timeout: 15_000 });
    await expect
      .poll(async () => Number(await embedded.getAttribute("data-particles")), { timeout: 10_000 })
      .toBeGreaterThan(10);
    await expect.poll(async () => Number(await embedded.getAttribute("data-frames"))).toBeGreaterThan(20);
    await expect(embedded).toHaveAttribute("data-renderer", "worker");
    expectNoErrors(consoleErrors);
  });

  test("a production build has no Lab: ?view=lab opens the canvas, and its code never downloads", async ({
    page,
    consoleErrors,
  }) => {
    const scripts: string[] = [];
    page.on("request", (r) => r.resourceType() === "script" && scripts.push(r.url()));
    await page.goto("./?view=gallery");
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    await expect(page.getByTestId("view-lab")).toHaveCount(0);
    await page.goto("./?view=lab&preset=stress-10");
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("lab-view")).toHaveCount(0);
    await expect(page.getByTestId("view-lab")).toHaveCount(0);
    expect(scripts.filter((u) => /LabView/.test(u))).toEqual([]);
    expectNoErrors(consoleErrors);
  });
});
