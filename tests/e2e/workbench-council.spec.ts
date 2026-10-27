import { test, expect, gotoCanvas, gotoLive, pauseClock, waitForCameraIdle } from "./fixtures";

for (const width of [1440, 390])
  for (const theme of ["light", "dark"])
    test(`${width === 390 ? "phone Follow keeps every narrated card visible" : "council frame preserves whole cards and reserved legend"} (${width}, ${theme})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript(
        (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
        theme,
      );
      await page.clock.install();
      await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
      await pauseClock(page);
      await page.getByTestId("live-timeline-input").fill("159");
      await page.getByTestId("live-timeline-input").press("ArrowRight");
      await page.getByTestId("live-view-menu").click();
      await page.getByTestId("view-follow").click();
      await page.clock.runFor(1400);
      await waitForCameraIdle(page);
      await expect(page.getByTestId("node-payments")).toBeVisible();
      const frame = await page.getByTestId("canvas-wrap").boundingBox();
      const legend = await page.getByTestId("live-route-legend").boundingBox();
      if (!frame || !legend) throw new Error("Expected frame and legend");
      const cards = await page.getByTestId(/^rf__node-/).evaluateAll((els) =>
        els
          .filter((el) => !el.hasAttribute("data-detail-hidden") && el.querySelector('[data-testid="card-title"]'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          }),
      );
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.x).toBeGreaterThanOrEqual(frame.x);
        expect(card.y).toBeGreaterThanOrEqual(frame.y);
        expect(card.right).toBeLessThanOrEqual(frame.x + frame.width);
        expect(card.bottom).toBeLessThan(legend.y);
      }
      const credit = await page.getByTestId("react-flow-credit").boundingBox();
      if (!credit) throw new Error("Expected visible credit");
      expect(credit.y).toBeGreaterThanOrEqual(legend.y);
      if (width === 390) {
        // Both cards are narrated. Follow must now frame the caller too.
        await expect(page.getByTestId("focus-offscreen-checkout")).toHaveCount(0);
        const assertNarrated = async () => {
          for (const id of ["checkout", "payments"]) {
            const node = page.getByTestId(`rf__node-${id}`);
            await expect(node).toBeVisible();
            await expect(node).not.toHaveAttribute("data-detail-hidden", "");
            const box = await node.boundingBox();
            if (!box) throw new Error(`Expected narrated ${id}`);
            expect(box.x).toBeGreaterThanOrEqual(frame.x);
            expect(box.y).toBeGreaterThanOrEqual(frame.y);
            expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
            expect(box.y + box.height).toBeLessThan(legend.y);
          }
        };
        await assertNarrated();
        const caller = await page.getByTestId("node-checkout").boundingBox();
        const card = await page.getByTestId("node-payments").boundingBox();
        if (!caller || !card) throw new Error("Expected narrated caller and subject");
        expect(card.x - caller.x - caller.width).toBeGreaterThan(24);
        await page.getByTestId("live-note-expand").click();
        await page.clock.runFor(1400);
        await waitForCameraIdle(page);
        await assertNarrated();
        for (const id of ["live-note-earlier", "live-note-later"]) {
          const target = await page.getByTestId(id).boundingBox();
          expect(target?.height).toBeGreaterThanOrEqual(44);
        }
        await expect(page.getByTestId("node-badge-orders")).not.toBeVisible();
      }
      await info.attach("council-frame", { body: await page.screenshot(), contentType: "image/png" });
    });

test("council inspector note has an inset and the description hint does not truncate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoCanvas(page, "outbox-saga-checkout");
  await page.getByTestId("node-order-api").click();
  const note = page.getByTestId("planning-unavailable");
  const dock = await page.getByTestId("inspector").boundingBox();
  const box = await note.boundingBox();
  if (!dock || !box) throw new Error("Expected planning note");
  expect(box.x - dock.x).toBeGreaterThanOrEqual(16);
  await expect(note).toContainText("ⓘ");
  await expect(page.getByTestId("toolbar-divider-collapse")).toHaveCount(0);
});

for (const theme of ["light", "dark"])
  test(`Live Overview removes blank note rectangles and raw counters (${theme})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      (theme) => localStorage.setItem("diagrams.settings.v1", JSON.stringify({ themePreference: theme })),
      theme,
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=doors-open&paused=1");
    await pauseClock(page);
    await page.getByTestId("live-timeline-input").fill("273");
    await page.getByTestId("live-timeline-input").press("ArrowRight");
    await page.getByTestId("live-view-menu").click();
    await page.getByTestId("view-overview").click();
    await page.clock.runFor(1400);
    await waitForCameraIdle(page);
    for (const id of ["note-routes", "note-outbox"])
      await expect(page.getByTestId(`annotation-${id}`)).not.toBeVisible();
    await expect(page.getByTestId("react-flow-credit")).toBeVisible();
    await expect(page.getByTestId("node-badge-checkout-api")).not.toBeVisible();
    await info.attach("live-overview", { body: await page.screenshot(), contentType: "image/png" });
  });
