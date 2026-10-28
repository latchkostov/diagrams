import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  goToNode,
  waitForCameraIdle,
  viewportTransform,
  cameraJournal,
  cameraJournalMark,
  pauseClock,
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
  await page.clock.runFor(32);
  await waitForCameraIdle(page);
  const moves = (await cameraJournal(page, mark)).filter((e) => e.moved);
  expect(moves.length).toBeGreaterThan(0);
  for (const move of moves) {
    expect(move.command).toBe("follow");
    expect(move.from.zoom).toBe(1);
    expect(move.to?.zoom).toBe(1);
    expect(move.to).not.toEqual(move.from);
  }
});

for (const example of ["black-friday-commerce", "recommendations-feature-store", "delivery-dispatch"])
  for (const zoom of ["fit", 0.35] as const)
    test(`titles never intersect cards (${example}, ${zoom})`, async ({ page }) => {
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
        await expect(page.getByTestId(/^zone-focus-/).first()).toBeVisible();
        const overlaps = await page.getByTestId("canvas-wrap").evaluate((root) => {
          const visible = (el: Element) => getComputedStyle(el).visibility !== "hidden";
          const titles = [
            ...root.querySelectorAll(
              '[data-testid^="zone-focus-"], [data-testid^="group-label-"], [data-testid^="annotation-label-"]',
            ),
          ].filter(visible);
          const cards = [...root.querySelectorAll('[data-testid^="node-"]')].filter(
            (el) => el.querySelector('[data-testid="card-title"]') && visible(el),
          );
          return titles.flatMap((title) => {
            const a = title.getBoundingClientRect();
            return cards
              .filter((card) => {
                const b = card.getBoundingClientRect();
                return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
              })
              .map((card) => [title.getAttribute("data-testid"), card.getAttribute("data-testid")]);
          });
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
