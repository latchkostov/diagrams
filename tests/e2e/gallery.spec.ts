import type { Page } from "@playwright/test";
import { test, expect, gotoGallery, expectNoErrors } from "./fixtures";

const tiles = (page: Page) => page.getByTestId(/^stencil-tile-/);
/** Which diagram "Add to current diagram" targets (written by the canvas, read by the gallery). */
const LAST_CANVAS_KEY = "diagrams.lastCanvas.v1";
const chipCount = async (page: Page, testId: string) =>
  Number((await page.getByTestId(testId).textContent())!.match(/(\d+)\s*$/)![1]);

test.describe("gallery", () => {
  test("loads every stencil and reports the count", async ({ page, consoleErrors }) => {
    await gotoGallery(page);
    const count = await tiles(page).count();
    expect(count).toBeGreaterThan(50);
    await expect(page.getByTestId("stencil-count")).toContainText(`${count} stencils from`);
    await expect(page.getByTestId("stencil-count")).not.toContainText("missing");
    expectNoErrors(consoleErrors);
  });

  test("search filters the tiles", async ({ page }) => {
    await gotoGallery(page);
    const total = await tiles(page).count();
    await page.getByTestId("gallery-search").fill("kafka");
    await expect(page.getByTestId("stencil-tile-kafka.topic")).toBeVisible();
    await expect(page.getByTestId("stencil-tile-postgres")).toHaveCount(0);
    const filtered = await tiles(page).count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);
    await expect(page.getByTestId("stencil-count")).toHaveText(`${filtered} of ${total} stencils`);

    await page.getByTestId("gallery-search").fill("zzz-no-such-stencil");
    await expect(tiles(page)).toHaveCount(0);
    await expect(page.getByTestId("stencil-count")).toHaveText(`0 of ${total} stencils`);
  });

  test("alias search finds stencils by everyday shorthand", async ({ page }) => {
    await gotoGallery(page);
    await page.getByTestId("gallery-search").fill("sb");
    await expect(page.getByTestId("stencil-tile-azure.service-bus.queue")).toBeVisible();
    await expect(page.getByTestId("stencil-tile-azure.service-bus.topic")).toBeVisible();
    await expect(tiles(page)).toHaveCount(2);

    await page.getByTestId("gallery-search").fill("pg");
    await expect(page.getByTestId("stencil-tile-postgres")).toBeVisible();
    await expect(page.getByTestId("stencil-tile-azure.app-gateway")).toHaveCount(0);

    await page.getByTestId("gallery-search").fill("lambda");
    await expect(page.getByTestId("stencil-tile-aws.lambda")).toBeVisible();
  });

  test("empty results explain and offer a way back", async ({ page }) => {
    await gotoGallery(page);
    const total = await tiles(page).count();
    await page.getByTestId("family-chip-aws").click();
    await page.getByTestId("gallery-search").fill("kafka topic");
    await expect(page.getByTestId("gallery-empty")).toBeVisible();
    await page.getByTestId("empty-all-families").click();
    await expect(page.getByTestId("stencil-tile-kafka.topic")).toBeVisible();
    await page.getByTestId("gallery-search").fill("zzz");
    await page.getByTestId("empty-clear").click();
    await expect(tiles(page)).toHaveCount(total);
  });

  test("slash focuses search", async ({ page }) => {
    await gotoGallery(page);
    await page.keyboard.press("/");
    await expect(page.getByTestId("gallery-search")).toBeFocused();
  });

  test("family filter narrows results and toggles off", async ({ page }) => {
    await gotoGallery(page);
    const total = await tiles(page).count();
    const aws = await chipCount(page, "family-chip-aws");
    await page.getByTestId("family-chip-aws").click();
    await expect(page.getByTestId("family-chip-aws")).toHaveAttribute("aria-pressed", "true");
    await expect(tiles(page)).toHaveCount(aws);
    await expect(page.getByTestId("stencil-tile-aws.sqs")).toBeVisible();
    await expect(page.getByTestId("stencil-tile-kafka.topic")).toHaveCount(0);
    await page.getByTestId("family-chip-aws").click();
    await expect(tiles(page)).toHaveCount(total);

    const azure = await chipCount(page, "family-chip-azure");
    await page.getByTestId("family-chip-azure").click();
    await expect(tiles(page)).toHaveCount(azure);
    await expect(page.getByTestId("stencil-tile-entra-id")).toBeVisible();
    await page.getByTestId("family-chip-all").click();
    await expect(tiles(page)).toHaveCount(total);
  });

  test("family counts follow the search", async ({ page }) => {
    await gotoGallery(page);
    await page.getByTestId("gallery-search").fill("queue");
    await expect(page.getByTestId("family-chip-aws")).toHaveText(/AWS\s*1$/);
    await expect(page.getByTestId("family-chip-gcp")).toHaveText(/Google Cloud\s*0$/);
  });

  test("the vendor menu filters to one vendor", async ({ page }) => {
    await gotoGallery(page);
    const total = await tiles(page).count();
    await page.getByTestId("vendor-overflow").click();
    await expect(page.getByTestId("vendor-menu")).toBeVisible();
    await page.getByTestId("vendor-menu-search").fill("rabbit");
    await page.getByTestId("context-menu-item-vendor:rabbitmq").click();
    await expect(page.getByTestId("vendor-menu")).toHaveCount(0);
    await expect(page.getByTestId("vendor-filter")).toContainText("RabbitMQ");
    await expect(tiles(page)).toHaveCount(2);
    await expect(page.getByTestId("family-chip-streaming")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("vendor-filter-clear").click();
    await expect(tiles(page)).toHaveCount(total);
  });

  test("a tile opens the details drawer; Esc closes it and returns focus", async ({ page, consoleErrors }) => {
    await gotoGallery(page);
    await page.getByTestId("stencil-tile-kafka.topic").click();
    const drawer = page.getByTestId("stencil-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("data-stencil", "kafka.topic");
    await expect(drawer.getByTestId("drawer-preview")).toBeVisible();
    await expect(drawer).toContainText("Every outgoing connection");
    await expect(drawer.getByTestId("drawer-copy-id")).toContainText("kafka.topic");

    await drawer.getByTestId("drawer-next").click();
    await expect(drawer).toHaveAttribute("data-stencil", "kafka.cluster");
    await drawer.getByTestId("drawer-prev").click();
    await expect(drawer).toHaveAttribute("data-stencil", "kafka.topic");

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByTestId("stencil-tile-kafka.topic")).toBeFocused();

    // Keyboard: Enter on a focused tile opens it too.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("stencil-drawer")).toBeVisible();
    await page.getByTestId("drawer-close").click();
    await expect(page.getByTestId("stencil-drawer")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("right-click on a tile shows the app menu, not the browser's", async ({ page }) => {
    await gotoGallery(page);
    const tile = page.getByTestId("stencil-tile-aws.sqs");
    const prevented = await tile.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
    const menu = page.getByTestId("tile-menu");
    await expect(menu).toBeVisible();
    for (const id of ["tile-add", "tile-details", "tile-copy-id", "tile-copy-json"]) {
      await expect(page.getByTestId(`context-menu-item-${id}`)).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await tile.click({ button: "right" });
    await page.getByTestId("context-menu-item-tile-details").click();
    await expect(page.getByTestId("stencil-drawer")).toHaveAttribute("data-stencil", "aws.sqs");
  });

  test("Add to current diagram lands a node on the canvas", async ({ page, consoleErrors }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "kafka-order-pipeline"), LAST_CANVAS_KEY);
    await gotoGallery(page);
    await page.getByTestId("stencil-tile-aws.sqs").click();
    await page.getByTestId("drawer-add").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("diagram-title")).toHaveText("Kafka order pipeline");
    await expect(page.getByTestId("node-sqs-1")).toBeVisible();
    // A normal, undoable edit.
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("node-sqs-1")).toHaveCount(0);
    // And it became a recent stencil in the palette.
    await expect(page.getByTestId("palette-recent-item-aws.sqs")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("the quick add button on a tile adds it without opening details", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "aws-fanout"), LAST_CANVAS_KEY);
    await gotoGallery(page);
    await page.getByTestId("stencil-tile-postgres").hover();
    await page.getByTestId("tile-add-postgres").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("node-postgres-1")).toBeVisible();
  });

  test("dragging a tile onto the drop dock adds it to the diagram", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "aws-fanout"), LAST_CANVAS_KEY);
    await gotoGallery(page);
    await expect(page.getByTestId("gallery-drop-target")).toHaveCount(0);
    const tile = page.getByTestId("stencil-tile-redis.cache");
    await tile.scrollIntoViewIfNeeded();
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + 80);
    const dock = page.getByTestId("gallery-drop-target");
    await expect(dock).toBeVisible();
    const target = (await dock.boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("node-cache-1")).toBeVisible();
  });

  test("cursors match behaviour: tiles grab, ids copy, nothing shows a text cursor", async ({ page }) => {
    await gotoGallery(page);
    const cursor = (testId: string) => page.getByTestId(testId).evaluate((el) => getComputedStyle(el).cursor);
    expect(await cursor("stencil-tile-kafka.topic")).toBe("grab");
    expect(await cursor("tile-stage-kafka.topic")).not.toBe("text");
    expect(await cursor("tile-copy-kafka.topic")).toBe("copy");
    expect(await cursor("family-chip-aws")).toBe("pointer");
    expect(await cursor("gallery-search")).toBe("text");
    const texty = await page.getByTestId("gallery-view").evaluate((root) =>
      [...root.querySelectorAll("*")]
        .filter((el) => getComputedStyle(el).cursor === "text" && !el.closest("input, label"))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(texty).toEqual([]);
  });

  test("every stencil tile shows an icon that actually loaded", async ({ page }) => {
    await gotoGallery(page);
    // Scoped by testid; the only <img> in a tile is the stencil icon.
    const broken = await tiles(page).evaluateAll(async (els) => {
      const bad: string[] = [];
      for (const el of els) {
        const imgs = [...el.querySelectorAll("img")];
        if (!imgs.length) {
          bad.push(`${el.getAttribute("data-testid")}: no <img>`);
          continue;
        }
        for (const img of imgs) {
          if (!img.complete)
            await new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            });
          if (!(img.naturalWidth > 0)) bad.push(`${el.getAttribute("data-testid")}: ${img.getAttribute("src")}`);
        }
      }
      return bad;
    });
    expect(broken, broken.join("\n")).toEqual([]);
  });

  test("category rail lists every category with a count", async ({ page }) => {
    await gotoGallery(page);
    for (const c of ["messaging", "compute", "data", "network", "observability", "security", "clients", "generic"]) {
      await expect(page.getByTestId(`rail-${c}`)).toBeEnabled();
      await expect(page.getByTestId(`gallery-section-${c}`)).toBeVisible();
    }
  });
});
