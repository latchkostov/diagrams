import { test, expect, gotoLive, STORAGE_KEYS } from "./fixtures";
import { chunk, holdChunk } from "./chunk";
import { faultDrillFixture } from "../../src/lab/faultDrillFixture";
import { zoomIdentity } from "./node-identity";
import { readFile } from "node:fs/promises";

test("outages and cuts remain painted through held chips, zoom and leaving Live", async ({ page }) => {
  const held = await holdChunk(page, chunk("chipInk", "src/live/chipInk.ts"));
  try {
    const diagram = faultDrillFixture();
    const simulation = diagram.simulations?.[0];
    if (!simulation) throw new Error("Expected the public fault drill fixture");
    simulation.timeline = [
      { atMs: 0, action: { do: "fault", fault: { kind: "boundary", boundary: "zone-b", down: true } } },
      { atMs: 0, action: { do: "fault", fault: { kind: "link", edge: "request", cut: true } } },
    ];
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
      diagram,
    });
    await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&paused=1&sim=drill");
    const boundary = page.getByTestId("group-zone-b");
    const cut = () =>
      page.getByTestId("edge-request").evaluate((el) => el.parentElement?.getAttribute("data-live-cut"));
    await expect(boundary).toHaveAttribute("data-live-status", "down");
    await expect.poll(cut).toBe("1");
    for (const zoom of [0.5, 0.8, 0.24]) {
      await zoomIdentity(page, zoom);
      await expect(boundary).toHaveAttribute("data-live-status", "down");
      await expect.poll(cut).toBe("1");
    }
    await expect.poll(held.requested).toBe(true);
    await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("grayscale(1)");
    expect(await page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBe(0);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("image-export").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.svg$/);
    expect(await file.failure()).toBeNull();
    const path = await file.path();
    if (!path) throw new Error("SVG download failed");
    const svg = await readFile(path, "utf8");
    const ink = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const boundary = doc.querySelector<HTMLElement>('[data-testid="group-zone-b"]');
      const link = doc.querySelector<SVGElement>('[data-testid="connection-stroke-request"]');
      return {
        filter: boundary?.style.filter,
        border: boundary?.style.borderStyle,
        stroke: link?.style.stroke,
        dash: link?.style.strokeDasharray,
      };
    }, svg);
    expect(ink).toEqual({
      filter: "grayscale(1)",
      border: "dashed",
      stroke: "rgb(209, 57, 63)",
      dash: "4px, 8px",
    });
    await expect(boundary).toHaveAttribute("data-live-status", "down");
    await expect.poll(cut).toBe("1");
    await page.getByTestId("live-toggle").click();
    await expect(boundary).not.toHaveAttribute("data-live-status");
    await expect.poll(cut).toBeNull();
  } finally {
    held.release();
  }
});
