import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, gotoLive, expectTheme, pauseClock, waitForCameraIdle } from "./fixtures";
import { sampledContrast } from "./pngContrast";
import diagram from "../../src/examples/black-friday-commerce.json" with { type: "json" };

for (const theme of ["light", "dark"])
  test(`large Overview names every tile or aggregate, reserves headers and filters routes (${theme})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
      theme,
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=doors-open&paused=1");
    await expectTheme(page, theme);
    await pauseClock(page);
    await page.getByTestId("live-timeline-input").fill("204");
    await page.getByTestId("live-timeline-input").press("ArrowRight");
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-overview").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-overview", "");
    await expect(page.getByTestId("overview-dig-hint")).toHaveText("Select a service, or a zone name, to focus");
    const hiddenByGroup = new Map<string, number>();
    for (const node of diagram.nodes) {
      const wrapper = page.getByTestId(`rf__node-${node.id}`);
      const hidden = (await wrapper.getAttribute("data-detail-aggregate")) !== null;
      if (hidden) {
        await expect(page.getByTestId(`node-${node.id}`)).not.toBeVisible();
        if (node.group) hiddenByGroup.set(node.group, (hiddenByGroup.get(node.group) ?? 0) + 1);
      } else {
        await expect(page.getByTestId(`node-${node.id}`)).toBeVisible();
        const title = page.getByTestId(`overview-spotlight-${node.id}`);
        const name = page.getByTestId(`overview-name-${node.id}`);
        if (await title.count()) await expect(title).toHaveText(node.label);
        else {
          await expect(name).toBeVisible();
          await expect(name).not.toBeEmpty();
          expect(await name.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(10.5);
        }
      }
    }
    expect(hiddenByGroup.size).toBeGreaterThan(0);
    for (const group of diagram.groups) {
      const band = await page.getByTestId(`zone-focus-${group.id}`).boundingBox();
      const region = await page.getByTestId(`group-${group.id}`).boundingBox();
      if (!band || !region) throw new Error(`Missing region ${group.id}`);
      expect(band.x).toBeGreaterThanOrEqual(region.x - 0.5);
      expect(band.y).toBeGreaterThanOrEqual(region.y - 0.5);
      expect(band.x + band.width).toBeLessThanOrEqual(region.x + region.width + 0.5);
      expect(band.y + band.height).toBeLessThanOrEqual(region.y + region.height + 0.5);
    }
    for (const [group, count] of hiddenByGroup) {
      const header = page.getByTestId(`zone-focus-${group}`);
      await expect(header).toHaveAttribute("data-overview-count", String(count));
      expect((await header.allTextContents()).join(" ").replace(/\s+/g, " ")).toContain(
        `${count} ${count === 1 ? "service" : "services"}`,
      );
    }
    const headers = await page.getByTestId(/^zone-focus-/).evaluateAll((els) =>
      els.map((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    const cards = await page.getByTestId(/^node-/).evaluateAll((els) =>
      els
        .filter((el) => getComputedStyle(el).visibility === "visible")
        .map((el) => {
          const { x, y, width, height } = el.getBoundingClientRect();
          return { x, y, width, height };
        }),
    );
    for (const header of headers)
      for (const card of cards)
        expect(
          header.x < card.x + card.width &&
            card.x < header.x + header.width &&
            header.y < card.y + card.height &&
            card.y < header.y + header.height,
        ).toBe(false);
    const edges = await page.getByTestId(/^connection-stroke-/).evaluateAll((els) =>
      els.map((el) => {
        const wrapper = el.closest("[data-id]");
        const matrix = (el as SVGPathElement).getScreenCTM();
        if (!wrapper || !matrix) throw new Error("Expected an edge wrapper and screen transform");
        return {
          visible: getComputedStyle(el).visibility === "visible",
          main: wrapper.hasAttribute("data-live-main"),
          near: wrapper.hasAttribute("data-live-near"),
          weight: parseFloat(getComputedStyle(el).strokeWidth) * Math.hypot(matrix.a, matrix.b),
        };
      }),
    );
    expect(edges.some((e) => e.visible)).toBe(true);
    expect(edges.some((e) => !e.visible)).toBe(true);
    for (const edge of edges) {
      expect(edge.visible).toBe(edge.main || edge.near);
      if (edge.visible) expect(edge.weight).toBeGreaterThanOrEqual(1.49);
    }
    const regions = [];
    for (const id of ["group-aws", "group-storefront", "node-checkout-api", "node-web"]) {
      const box = await page.getByTestId(id).boundingBox();
      if (!box) throw new Error(`Missing ${id}`);
      regions.push({ x: box.x - 2, y: box.y + box.height / 2 - 4, width: 4, height: 8, ground: { x: 1410, y: 120 } });
    }
    const png = await page.screenshot();
    const contrast = await sampledContrast(page, png, regions);
    for (const ratio of contrast) expect(ratio, "PNG outline against board").toBeGreaterThanOrEqual(3);
    await info.attach("overview-outline-contrast", {
      body: JSON.stringify({ theme, contrast }),
      contentType: "application/json",
    });
    await info.attach(`07-live-large-overview-${theme}`, { body: png, contentType: "image/png" });
    if (process.env.OVERVIEW_CAPTURE_DIR) {
      await mkdir(process.env.OVERVIEW_CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.OVERVIEW_CAPTURE_DIR, `07-live-large-overview-${theme}.png`) });
    }
    await page.getByTestId("zone-focus-storefront").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("node-catalog-bff")).toBeVisible();
    await page.getByTestId("node-catalog-bff").click();
    await expect(page.getByTestId("inspector")).toBeVisible();
  });
