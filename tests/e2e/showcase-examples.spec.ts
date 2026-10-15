import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, pauseClock, waitForStableViewport, expectNoErrors } from "./fixtures";

const showcases = [
  { slug: "partitions-vs-subscriptions", signal: "log", field: "backlog" },
  { slug: "shared-api-quotas", signal: "answer", field: "rejected" },
  { slug: "serverless-burst-buffer", signal: "direct", field: "rejected" },
  { slug: "measured-order-capacity", signal: "queue", field: "backlog", sim: "triple" },
  { slug: "contoso-dmz", signal: "firewall", field: "blocked" },
  { slug: "shared-worker-pool", signal: "order-log", field: "backlog" },
] as const;

async function positive(page: Page, node: string, field: string) {
  const badge = page.getByTestId(`node-badge-${node}`);
  await expect(badge).toBeVisible();
  await expect.poll(async () => Number(await badge.getAttribute(`data-${field}`))).toBeGreaterThan(0);
}

// Read the actual rendered node and label boxes; only data-testid selectors.
async function overlaps(page: Page) {
  return page.evaluate(() => {
    const boxes = (selector: string) =>
      [...document.querySelectorAll(selector)].map((el) => ({
        id: el.getAttribute("data-testid"),
        box: el.getBoundingClientRect(),
      }));
    const nodes = boxes('[data-testid^="rf__node-"]:not([data-testid^="rf__node-group:"])');
    const boundaries = boxes('[data-testid^="rf__node-group:"]');
    const labels = boxes('[data-testid^="edge-label-"]');
    const hits: string[] = [];
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left + 0.5 < b.right && b.left + 0.5 < a.right && a.top + 0.5 < b.bottom && b.top + 0.5 < a.bottom;
    for (let i = 0; i < boundaries.length; i++)
      for (const other of boundaries.slice(i + 1))
        if (hit(boundaries[i].box, other.box)) hits.push(`${boundaries[i].id} / ${other.id}`);
    for (let i = 0; i < nodes.length; i++)
      for (const other of nodes.slice(i + 1))
        if (hit(nodes[i].box, other.box)) hits.push(`${nodes[i].id} / ${other.id}`);
    for (let i = 0; i < labels.length; i++)
      for (const other of [...nodes, ...labels.slice(i + 1)])
        if (hit(labels[i].box, other.box)) hits.push(`${labels[i].id} / ${other.id}`);
    return hits;
  });
}

for (const theme of ["light", "dark"] as const)
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ])
    test.describe(`${theme} ${viewport.width}`, () => {
      test.use({ colorScheme: theme, viewport });
      for (const showcase of showcases)
        test(`${showcase.slug} shows its feature in Live`, async ({ page, consoleErrors }, info) => {
          const simulation = "sim" in showcase ? `&sim=${showcase.sim}` : "";
          await page.clock.install();
          await gotoLive(page, `./?view=canvas&example=${showcase.slug}&live=1${simulation}`);
          await waitForStableViewport(page);
          await pauseClock(page);
          if (viewport.width === 390) {
            const title = await page.getByTestId("diagram-card").boundingBox();
            const toggle = await page.getByTestId("live-toggle").boundingBox();
            expect(title).not.toBeNull();
            expect(toggle).not.toBeNull();
            if (!title || !toggle) throw new Error("Expected visible title and Live toggle");
            expect(title.height).toBeLessThan(toggle.height * 2);
            const titleText = page.getByTestId("diagram-title");
            expect(await titleText.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
            const bar = await page.getByTestId("live-controls").boundingBox();
            expect(bar).not.toBeNull();
            if (!bar) throw new Error("Expected visible playback bar");
            for (const id of [
              "live-play",
              "live-restart",
              "live-speed",
              "live-sim-picker",
              "live-capacity",
              "live-more",
            ]) {
              const control = await page.getByTestId(id).boundingBox();
              expect(control, id).not.toBeNull();
              if (!control) throw new Error(`Expected visible ${id}`);
              expect(control.x, id).toBeGreaterThanOrEqual(bar.x);
              expect(control.x + control.width, id).toBeLessThanOrEqual(bar.x + bar.width);
              expect(
                await page.getByTestId(id).evaluate((el) => {
                  const r = el.getBoundingClientRect();
                  return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
                }),
                `${id} is not covered by a side rail`,
              ).toBe(true);
            }
          }
          await page.getByTestId("live-restart").click();
          await page.clock.runFor(8000);
          await positive(page, showcase.signal, showcase.field);
          if (showcase.slug === "partitions-vs-subscriptions") {
            await expect(page.getByTestId("capacity-idle-log-readers")).toHaveAttribute("data-idle", "5");
            await expect(page.getByTestId("capacity-idle-receipts")).toHaveCount(0);
            await positive(page, "receipts", "processed");
            await positive(page, "audit", "processed");
          }
          if (showcase.slug === "shared-api-quotas") {
            await positive(page, "review", "rejected");
            await positive(page, "payments", "rejected");
            await expect(page.getByTestId("node-rejected-answer")).toContainText("Rejected");
            await expect(page.getByTestId("node-badge-answer")).toHaveAttribute("data-failed", "0");
          }
          if (showcase.slug === "serverless-burst-buffer") {
            await positive(page, "queue", "backlog");
            await positive(page, "async-results", "processed");
            await expect(page.getByTestId("node-badge-async")).toHaveAttribute("data-rejected", "0");
          }
          if (showcase.slug === "contoso-dmz") {
            await positive(page, "database", "processed");
            await expect(page.getByTestId("node-badge-admin")).toHaveAttribute("data-processed", "0");
            await expect(page.getByTestId("node-badge-firewall")).toHaveAttribute("data-failed", "0");
          }
          if (showcase.slug === "shared-worker-pool") await positive(page, "refund-log", "backlog");
          expect(await overlaps(page)).toEqual([]);
          const filename = `${showcase.slug}-${theme}-${viewport.width}.png`;
          const folder = join(process.cwd(), "docs/research/showcase-examples");
          mkdirSync(folder, { recursive: true });
          await page.mouse.move(0, 0);
          const body = await page.screenshot({ path: join(folder, filename) });
          await info.attach(filename, { body, contentType: "image/png" });
          if (viewport.width === 390) {
            // Exercise the controls after capturing the normal opening state: Inputs enables the heat map.
            await page.getByTestId("live-play").click();
            await page.getByTestId("live-play").click();
            await page.getByTestId("live-capacity").click();
            await expect(page.getByTestId("live-capacity")).toHaveAttribute("aria-pressed", "true");
            await page.getByTestId("live-capacity").click();
            await expect(page.getByTestId("live-capacity")).toHaveAttribute("aria-pressed", "false");
            await page.getByTestId("live-more").click();
            await expect(page.getByTestId("live-more-menu")).toBeVisible();
            await page.keyboard.press("Escape");
          }
          expectNoErrors(consoleErrors);
        });
    });

test.describe("mobile title card", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("keeps checks and reset available while folding the description", async ({ page }) => {
    await gotoCanvas(page, "partitions-vs-subscriptions");
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await page.getByTestId("node-receipts").click();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("reset-diagram")).toBeVisible();
    await page.getByTestId("reset-diagram").click();
    await expect(page.getByTestId("reset-diagram")).toHaveCount(0);
    for (const id of ["example-picker", "view-button", "file-button", "theme-toggle"]) {
      const control = page.getByTestId(id);
      await control.focus();
      await expect(control).toBeFocused();
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error(`Expected visible ${id}`);
      // Scroll offsets round to device pixels; allow their subpixel remainder.
      expect(bounds.x, id).toBeGreaterThanOrEqual(-0.5);
      expect(bounds.x + bounds.width, id).toBeLessThanOrEqual(390.5);
    }
  });
});
