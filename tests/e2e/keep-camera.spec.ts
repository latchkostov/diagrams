import commerce from "../../src/examples/black-friday-commerce.json" with { type: "json" };
import recommendations from "../../src/examples/recommendations-feature-store.json" with { type: "json" };
import charging from "../../src/examples/ev-charging-network.json" with { type: "json" };
import delivery from "../../src/examples/delivery-dispatch.json" with { type: "json" };
import { cameraRegionsFixture } from "../../src/lab/cameraRegionsFixture";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  goToNode,
  waitForCameraIdle,
  waitForStableBox,
  viewportTransform,
  cameraJournal,
  cameraJournalMark,
  pauseClock,
  STORAGE_KEYS,
} from "./fixtures";

async function zoomTo(page: Page, target: number) {
  const bounds = await page.getByTestId("canvas-wrap").boundingBox();
  if (!bounds) throw new Error("Expected canvas");
  const zoom = Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]);
  const factor = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 0.02 : 0.002));
  await page.getByTestId("canvas-pane").dispatchEvent("wheel", {
    deltaY: Math.log2(zoom / target) / factor,
    ctrlKey: true,
    clientX: bounds.x + bounds.width / 2,
    clientY: bounds.y + bounds.height / 2,
    bubbles: true,
  });
  await waitForCameraIdle(page);
  await expect
    .poll(async () => Number((await viewportTransform(page)).match(/scale\(([^)]+)\)/)?.[1]))
    .toBeCloseTo(target, 3);
}

for (const width of [1440, 390])
  test(`entering Live keeps the camera centred on a part at 100% (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoCanvas(page, "recommendations-feature-store");
    await goToNode(page, "home-api");
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Shift+Digit0");
    await waitForCameraIdle(page);
    const before = await viewportTransform(page);
    const mark = await cameraJournalMark(page);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await waitForCameraIdle(page);
    expect(await viewportTransform(page)).toBe(before);
    expect((await cameraJournal(page, mark)).filter((e) => e.moved)).toEqual([]);
  });

test("entering Live with nothing visible fits exactly once", async ({ page }) => {
  await gotoCanvas(page, "recommendations-feature-store");
  await waitForCameraIdle(page);
  await page.getByTestId("canvas-pane").dispatchEvent("wheel", { deltaX: 100000, deltaY: 100000, bubbles: true });
  await waitForCameraIdle(page);
  const mark = await cameraJournalMark(page);
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await waitForCameraIdle(page);
  const fits = (await cameraJournal(page, mark)).filter((e) => e.command === "fit");
  expect(fits).toHaveLength(1);
  await expect(page.getByTestId("card-title").first()).toBeInViewport();
  await page.getByTestId("live-view-menu").click();
  await page.keyboard.press("Escape");
  await waitForCameraIdle(page);
  expect((await cameraJournal(page, mark)).filter((e) => e.command === "fit")).toHaveLength(1);
});

test("Following an off-screen narration subject pans at the current zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=black-friday-commerce&sim=doors-open&paused=1");
  await pauseClock(page);
  await page.getByTestId("live-timeline-input").fill("273");
  await page.getByTestId("live-timeline-input").press("ArrowRight");
  await expect(page.getByTestId("live-note-text")).toBeVisible();
  await page.clock.resume();
  await goToNode(page, "web");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("Shift+Digit0");
  await waitForCameraIdle(page);
  await pauseClock(page);
  const mark = await cameraJournalMark(page);
  await page.getByTestId("live-view-menu").click();
  await page.getByTestId("view-follow").click();
  await page.getByTestId("canvas-wrap").evaluate((root) => {
    const zooms: number[] = [];
    (root as HTMLElement & { keepcamZooms?: number[] }).keepcamZooms = zooms;
    const sample = () => {
      zooms.push(Number(root.style.getPropertyValue("--rf-zoom-exact")));
      if (zooms.length < 16) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.clock.runFor(300);
  const zooms = await page
    .getByTestId("canvas-wrap")
    .evaluate((root) => (root as HTMLElement & { keepcamZooms?: number[] }).keepcamZooms ?? []);
  expect(zooms).toHaveLength(16);
  for (const zoom of zooms) expect(zoom).toBeCloseTo(1, 4);
  await page.clock.fastForward(1000);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(32);
        return page.getByTestId("canvas-wrap").getAttribute("data-camera-state");
      },
      { intervals: [0] },
    )
    .toBe("idle");
  const moves = (await cameraJournal(page, mark)).filter((e) => e.moved);
  expect(moves.length).toBeGreaterThan(0);
  for (const move of moves) {
    expect(move.command).toBe("follow");
    expect(move.from.zoom).toBe(1);
    expect(move.to?.zoom).toBe(1);
    expect(move.to).not.toEqual(move.from);
  }
});

for (const example of [
  "black-friday-commerce",
  "recommendations-feature-store",
  "delivery-dispatch",
  "ev-charging-network",
] as const)
  for (const zoom of ["fit", 0.35] as const)
    test(`all showcase region titles remain readable and clear (${example}, ${zoom})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoCanvas(page, example);
      await page.getByTestId("canvas-wrap").focus();
      await page.keyboard.press("Shift+Digit1");
      await waitForCameraIdle(page);
      if (zoom !== "fit") await zoomTo(page, zoom);
      for (const live of [false, true]) {
        if (live) {
          await page.getByTestId("live-toggle").click();
          await expect(page.getByTestId("live-controls")).toBeVisible();
          await waitForCameraIdle(page);
        }
        const diagram = {
          "black-friday-commerce": commerce,
          "recommendations-feature-store": recommendations,
          "delivery-dispatch": delivery,
          "ev-charging-network": charging,
        }[example];
        const expected = [
          ...diagram.groups.map((g) => `boundary:${g.id}`),
          ...diagram.annotations.filter((a) => a.kind === "zone" && a.text.trim()).map((a) => `zone:${a.id}`),
        ].sort();
        await expect
          .poll(() =>
            page.getByTestId("canvas-wrap").evaluate((root) =>
              [
                ...root.querySelectorAll<HTMLElement>(
                  '[data-testid^="zone-focus-"], [data-testid^="group-label-"], [data-testid^="annotation-label-"]',
                ),
              ]
                .filter((el) => {
                  const box = el.getBoundingClientRect();
                  return (
                    box.width > 0 &&
                    box.height > 0 &&
                    getComputedStyle(el).visibility !== "hidden" &&
                    el.textContent?.trim()
                  );
                })
                .map((el) =>
                  (el.dataset.testid ?? "")
                    .replace(/^zone-focus-|^group-label-/, "boundary:")
                    .replace(/^annotation-label-/, "zone:"),
                )
                .sort(),
            ),
          )
          .toEqual(expected);
        const overlaps = await page.getByTestId("canvas-wrap").evaluate((root) => {
          const visible = (el: Element) => getComputedStyle(el).visibility !== "hidden";
          const titles = [
            ...root.querySelectorAll(
              '[data-testid^="zone-focus-"], [data-testid^="group-label-"], [data-testid^="annotation-label-"]',
            ),
          ].filter(visible);
          const titleHits = titles.flatMap((title, i) => {
            const a = title.getBoundingClientRect();
            return titles
              .slice(i + 1)
              .filter((other) => {
                const b = other.getBoundingClientRect();
                return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
              })
              .map((other) => [title.getAttribute("data-testid"), other.getAttribute("data-testid")]);
          });
          const cards = [...root.querySelectorAll('[data-testid^="node-"]')].filter(
            (el) => el.querySelector('[data-testid="card-title"]') && visible(el),
          );
          return [
            ...titleHits,
            ...titles.flatMap((title) => {
              const a = title.getBoundingClientRect();
              return cards
                .filter((card) => {
                  const b = card.getBoundingClientRect();
                  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
                })
                .map((card) => [title.getAttribute("data-testid"), card.getAttribute("data-testid")]);
            }),
          ];
        });
        expect(overlaps).toEqual([]);
        const crossed = await page.getByTestId("canvas-wrap").evaluate((root) => {
          const titles = [
            ...root.querySelectorAll(
              '[data-testid^="zone-focus-"], [data-testid^="group-label-"], [data-testid^="annotation-label-"]',
            ),
          ]
            .filter((el) => getComputedStyle(el).visibility !== "hidden")
            .map((el) => ({ id: el.getAttribute("data-testid"), box: el.getBoundingClientRect() }));
          return [...root.querySelectorAll<SVGPathElement>('[data-testid^="connection-stroke-"]')].flatMap((path) => {
            if (getComputedStyle(path).visibility === "hidden") return [];
            const matrix = path.getScreenCTM();
            if (!matrix) return [];
            const length = path.getTotalLength();
            const hits = new Set<string>();
            for (let at = 0; at <= length; at += 1 / Math.hypot(matrix.a, matrix.b)) {
              const p = path.getPointAtLength(at).matrixTransform(matrix);
              for (const { id, box } of titles)
                if (id && p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom) hits.add(id);
            }
            return [...hits].map((id) => [id, path.getAttribute("data-testid")]);
          });
        });
        expect(crossed).toEqual([]);
      }
    });

test("Live preserves the forty-percent showcase camera", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: "light" })),
  );
  await gotoCanvas(page, "recommendations-feature-store");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("Shift+Digit1");
  await waitForCameraIdle(page);
  await zoomTo(page, 0.4);
  const before = await viewportTransform(page);
  const folder = "C:/Users/latch/bin/codex-tasks/redesign-2026-10/build/keepcam";
  if (process.env.KEEPCAM_CAPTURE) await page.screenshot({ path: `${folder}/${process.env.KEEPCAM_CAPTURE}-edit.png` });
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await waitForCameraIdle(page);
  if (process.env.KEEPCAM_CAPTURE) await page.screenshot({ path: `${folder}/${process.env.KEEPCAM_CAPTURE}-live.png` });
  expect(await viewportTransform(page)).toBe(before);
});

for (const inset of [0, 10, 100])
  test(`Following preserves a visible narrated subject (${inset}px from the frame edge)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=black-friday-commerce&sim=doors-open&paused=1");
    await pauseClock(page);
    await page.getByTestId("live-restart").click();
    await page.getByTestId("live-play").click();
    await page.clock.runFor(4500);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("live-note-text")).toContainText("Doors open");
    await page.clock.resume();
    await goToNode(page, "gateway");
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Shift+Digit0");
    await waitForCameraIdle(page);
    const card = page.getByTestId("rf__node-gateway");
    const beforeBox = await card.boundingBox();
    const pane = await page.getByTestId("canvas-wrap").boundingBox();
    const rail = await page.getByTestId("tool-rail").boundingBox();
    if (!beforeBox || !pane) throw new Error("Expected card and pane");
    const left = Math.max(pane.x, rail ? rail.x + rail.width : pane.x);
    await page
      .getByTestId("canvas-pane")
      .dispatchEvent("wheel", { deltaX: beforeBox.x - left - inset, deltaY: 0, bubbles: true });
    await waitForCameraIdle(page);
    await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(left + inset, 0);
    const before = await viewportTransform(page);
    const mark = await cameraJournalMark(page);
    await pauseClock(page);
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-follow").click();
    await page.clock.runFor(1000);
    await page.clock.runFor(32);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", "follow");
    expect(await viewportTransform(page)).toBe(before);
    expect((await cameraJournal(page, mark)).filter((e) => e.moved)).toEqual([]);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("card-title")).toBeVisible();
    await expect(card.getByTestId("card-title")).toHaveText("API gateway");
    await expect(card).toHaveAttribute("data-detail-expanded", "");
    await expect(card).not.toHaveAttribute("data-live-dim");
    await expect(page.getByTestId("rf__node-web")).toHaveAttribute("data-live-dim", "1");
    await expect(page.getByTestId("node-badge-gateway")).toBeVisible();
    await expect(page.getByTestId("node-metric-gateway")).toBeVisible();
    await expect(page.getByTestId("node-metric-gateway")).not.toHaveText("");
    await expect(page.getByTestId("focus-offscreen-gateway")).toHaveCount(0);
  });

test("low-zoom zone and boundary titles share reservations", async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline", JSON.stringify(cameraRegionsFixture())],
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  await zoomTo(page, 0.35);
  const zone = page.getByTestId("annotation-label-region");
  const boundary = page.getByTestId("zone-focus-tier");
  await expect(zone).toBeVisible();
  await expect(boundary).toBeVisible();
  await expect
    .poll(async () => {
      const a = await zone.boundingBox();
      const b = await boundary.boundingBox();
      return (
        !!a && !!b && (a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
      );
    })
    .toBe(true);
});
for (const zoom of [0.35, 1, 1.5])
  test(`phone zone renaming scales once (${zoom})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline", JSON.stringify({ ...cameraRegionsFixture(), groups: [] })],
    );
    await gotoCanvas(page, "kafka-order-pipeline");
    await zoomTo(page, zoom);
    const label = page.getByTestId("annotation-label-region");
    const labelBox = await label.boundingBox();
    const canvas = await page.getByTestId("canvas-wrap").boundingBox();
    if (!labelBox || !canvas) throw new Error("Expected zone and canvas");
    await page.getByTestId("canvas-pane").dispatchEvent("wheel", {
      deltaX: labelBox.x - canvas.x - 80,
      deltaY: labelBox.y - canvas.y - 160,
      bubbles: true,
    });
    await waitForCameraIdle(page);
    await label.dblclick();
    const editor = page.getByTestId("annotation-editor");
    await expect(editor).toBeFocused();
    await waitForCameraIdle(page);
    await waitForStableBox(editor);
    const width = await editor.evaluate((el) => ({ screen: el.getBoundingClientRect().width, layout: el.offsetWidth }));
    expect(width.screen / width.layout).toBeCloseTo(Math.max(1, zoom), 1);
    const bounds = await editor.boundingBox();
    const pane = await page.getByTestId("canvas-wrap").boundingBox();
    if (!bounds || !pane) throw new Error("Expected editor and pane");
    expect(bounds.x).toBeGreaterThanOrEqual(pane.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(pane.x + pane.width);
    await editor.fill("Renamed delivery zone");
    await editor.press("Escape");
    await expect(page.getByTestId("annotation-label-region")).toHaveText("Renamed delivery zone");
  });
