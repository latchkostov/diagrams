import recommendations from "../../src/examples/recommendations-feature-store.json" with { type: "json" };
import commerce from "../../src/examples/black-friday-commerce.json" with { type: "json" };
import delivery from "../../src/examples/delivery-dispatch.json" with { type: "json" };
import { test, expect, gotoCanvas, gotoLive, waitForCameraIdle, pauseClock } from "./fixtures";
import { zoomIdentity } from "./node-identity";

for (const [slug, diagram] of [
  ["recommendations-feature-store", recommendations],
  ["black-friday-commerce", commerce],
  ["delivery-dispatch", delivery],
] as const)
  for (const zoom of [0.4, 0.25])
    test(`chips are named, readable and overlap-free: ${slug} at ${zoom}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoCanvas(page, slug);
      await zoomIdentity(page, zoom);
      const root = page.getByTestId("canvas-wrap");
      await expect(root).toHaveAttribute("data-low-zoom", zoom < 0.3 ? "far" : "mid");
      await expect(page.getByTestId(/^connection-stroke-/)).toHaveCount(diagram.edges.length);
      const problems = await root.evaluate(
        (root, names) => {
          const boxes: { id: string; x: number; y: number; right: number; bottom: number }[] = [];
          const problems: string[] = [];
          for (const { id, label } of names) {
            const node = root.querySelector<HTMLElement>(`[data-testid="node-${id}"]`);
            const title = node?.querySelector<HTMLElement>('[data-testid="card-title"]');
            const icon = node?.querySelector<HTMLElement>('[data-testid="card-icon"]');
            const body = title?.parentElement;
            if (!node || !title || !icon || !body) throw new Error(`Missing identity: ${id}`);
            const text = title.textContent ?? "";
            const rect = body.getBoundingClientRect();
            const style = getComputedStyle(title);
            if (!text.trim() || text.includes("…") || style.textOverflow === "ellipsis")
              problems.push(`${id}: blank or ellipsis`);
            if (body.getAttribute("aria-label") !== label) problems.push(`${id}: missing full accessible name`);
            if (getComputedStyle(icon).visibility !== "visible" || !icon.getBoundingClientRect().height)
              problems.push(`${id}: hidden icon`);
            const scale = rect.width / body.offsetWidth;
            if (parseFloat(style.fontSize) * scale < 10.4) problems.push(`${id}: small name`);
            const ink = title.getBoundingClientRect();
            if (ink.left < rect.left || ink.right > rect.right + 1 || ink.bottom > rect.bottom + 1)
              problems.push(`${id}: clipped name`);
            boxes.push({ id, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
          }
          const overlap = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
            a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++)
              if (overlap(boxes[i], boxes[j])) problems.push(`${boxes[i].id} overlaps ${boxes[j].id}`);
          for (const title of root.querySelectorAll<HTMLElement>('[data-testid^="zone-focus-"]')) {
            const r = title.getBoundingClientRect();
            for (const box of boxes)
              if (
                overlap({ id: title.dataset.testid ?? "zone", x: r.x, y: r.y, right: r.right, bottom: r.bottom }, box)
              )
                problems.push(`${title.dataset.testid} covers ${box.id}`);
          }
          return problems;
        },
        diagram.nodes.map(({ id, label }) => ({ id, label })),
      );
      expect(problems).toEqual([]);
      if (slug === "recommendations-feature-store" && zoom === 0.4) {
        await page.keyboard.press("Shift+1");
        await waitForCameraIdle(page);
        await page.getByTestId("node-feature-server").hover();
        await expect(page.getByTestId("node-tooltip")).toContainText("Feature server");
        await expect(page.getByTestId("node-feature-server")).not.toHaveAttribute("title");
      }
    });

test("chips publish a tier only after zoom settles and reuse it through pan", async ({ page }) => {
  await page.clock.install();
  await gotoCanvas(page, "recommendations-feature-store");
  await zoomIdentity(page, 0.65);
  await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-low-zoom");
  await pauseClock(page);
  const pane = page.getByTestId("canvas-pane");
  const root = page.getByTestId("canvas-wrap");
  const fits = await root.getAttribute("data-chip-fits");
  for (const deltaY of [100, 20, 10]) {
    await pane.dispatchEvent("wheel", { deltaY, ctrlKey: true, bubbles: true });
    await page.clock.runFor(16);
    await expect(root).toHaveAttribute("data-viewport-moving", "");
    expect(await root.getAttribute("data-chip-fits")).toBe(fits);
    await expect(root).not.toHaveAttribute("data-low-zoom");
  }
  await page.clock.runFor(400);
  await expect(root).toHaveAttribute("data-low-zoom", "mid");
  const settled = Number(await root.getAttribute("data-chip-fits"));
  expect(settled - Number(fits)).toBe(1);
  for (let n = 0; n < 8; n++) {
    await pane.dispatchEvent("wheel", { deltaY: 10, bubbles: true });
    await page.clock.runFor(16);
  }
  expect(Number(await root.getAttribute("data-chip-fits"))).toBe(settled);
});

test("low zoom removes most card and edge drawing elements", async ({ page }) => {
  await gotoCanvas(page, "black-friday-commerce");
  const count = () =>
    page
      .getByTestId("canvas-wrap")
      .evaluate((root) =>
        [...root.querySelectorAll('[data-testid^="node-"],[data-testid^="edge-"]')]
          .filter((el) => /^(node|edge)-/.test(el.getAttribute("data-testid") ?? ""))
          .reduce((n, el) => n + el.querySelectorAll("*").length + 1, 0),
      );
  await zoomIdentity(page, 1);
  const full = await count();
  await zoomIdentity(page, 0.4);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
  expect(await count()).toBeLessThan(full * 0.4);
});

test("a troubled drill accents chips and rolls up zone health without animated canvases", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=poison-deploy&paused=1");
  await waitForCameraIdle(page);
  await page.getByTestId("live-timeline-input").fill("376");
  await page.getByTestId("live-timeline-input").press("ArrowRight");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  await zoomIdentity(page, 0.25);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "far");
  await expect
    .poll(() => page.getByTestId("node-loyalty").evaluate((el) => el.parentElement?.getAttribute("data-live-trouble")))
    .toBe("failing");
  await expect(page.getByTestId("zone-trouble-fulfil")).toContainText("1 failing");
  await expect
    .poll(() => page.getByTestId("live-canvas").evaluate((el) => getComputedStyle(el).visibility))
    .toBe("hidden");
  await pauseClock(page);
  // Flush the UI's batched frame counter (and any already posted worker reply).
  await page.clock.runFor(1000);
  const frames = await page.getByTestId("live-canvas").getAttribute("data-frames");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-frames", frames ?? "0");
  await page.clock.resume();
  await page.getByTestId("node-loyalty").hover();
  await expect(page.getByTestId("hover-full-name")).toHaveText("Loyalty points");
  await expect(page.getByTestId("hover-full-name")).not.toHaveAttribute("title");
});

for (const renderer of ["worker", "main"])
  test(`low zoom stops painting during running playback: ${renderer}`, async ({ page }) => {
    await page.clock.install();
    await gotoLive(page, `./?view=canvas&example=kafka-order-pipeline&live=1&sim=black-friday&renderer=${renderer}`);
    await zoomIdentity(page, 0.8);
    await pauseClock(page);
    const canvas = page.getByTestId("live-canvas");
    const frames = async () => Number(await canvas.getAttribute("data-frames"));
    const clock = async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
    const first = await frames();
    await page.clock.runFor(1000);
    expect(await frames()).toBeGreaterThan(first);
    await page.clock.resume();
    await zoomIdentity(page, 0.4);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
    await pauseClock(page);
    // Counters publish every other UI tick; measure after that pending publish.
    await page.clock.runFor(1000);
    const stopped = await frames();
    const time = await clock();
    await page.clock.runFor(1000);
    expect(await clock()).toBeGreaterThan(time);
    expect(await frames()).toBe(stopped);
    await page.clock.resume();
    await zoomIdentity(page, 0.8);
    await pauseClock(page);
    const resumed = await frames();
    await page.clock.runFor(1000);
    expect(await frames()).toBeGreaterThan(resumed);
  });
