import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { test, expect, gotoCanvas, waitForStableViewport } from "./fixtures";
import { holdChunk } from "./chunk";
import { surfaceChunk } from "./lazy-surface-helpers";

async function exportFile(page: Page, kind: "svg" | "png" | "html", holdTip = false) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId(kind === "html" ? "export-html" : "export-image").click();
  if (kind !== "html") {
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId(`image-format-${kind}`).click();
    if (kind === "png") await page.getByTestId("image-scale-1").click();
  }
  const outside = await page.getByTestId("file-button").boundingBox();
  if (!outside) throw new Error("Missing File button");
  await page.mouse.move(outside.x + outside.width / 2, outside.y + outside.height / 2);
  if (holdTip) {
    // Activate the reader behind the dialog. Keyboard export keeps the pointer
    // outside the canvas, so closing the dialog cannot hide the held shell.
    await page.getByTestId("edge-label-branch-edge").dispatchEvent("pointerover");
    await expect(page.getByTestId("edge.message-tip-loading")).toHaveCount(1);
  }
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(kind === "html" ? "html-export-download" : "image-export").press("Enter"),
  ]);
  expect(await download.failure()).toBeNull();
  if (holdTip) await expect(page.getByTestId("edge.message-tip-loading")).toHaveCount(1);
  return readFileSync(await download.path());
}

/** The clone library gives pseudo-elements random class names; preserve every other SVG byte. */
function canonicalSvg(bytes: Buffer) {
  const names = new Map<string, string>();
  return bytes.toString("utf8").replace(/\bu[0-9a-z]{4}\d+\b/g, (name) => {
    if (!names.has(name)) names.set(name, `pseudo${names.size}`);
    return names.get(name) ?? name;
  });
}

for (const kind of ["svg", "png", "html"] as const)
  test(`${kind} export excludes a held edge message tip without changing bytes`, async ({ page }) => {
    // Compare stationary captures, as the existing image byte-parity tests do.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const held = await holdChunk(page, surfaceChunk("edge.message-tip"));
    await page.addInitScript(() => {
      localStorage.setItem("diagrams.lowZoom", "off");
      localStorage.setItem("diagrams.settings.v1", JSON.stringify({ theme: "dark" }));
      // PNG serializes an intermediate SVG. Inspect that DOM too: an empty span
      // can leave the raster unchanged while still violating the export contract.
      const serialize = XMLSerializer.prototype.serializeToString;
      const shells: string[] = [];
      (window as unknown as { imageLoadingShells: string[] }).imageLoadingShells = shells;
      XMLSerializer.prototype.serializeToString = function (node) {
        const text = serialize.call(this, node);
        shells.push(...(text.match(/<[^>]+data-testid="[^"]*-loading"[^>]*>/g) ?? []));
        return text;
      };
    });
    try {
      await gotoCanvas(page, "branch-to-datacentre");
      await waitForStableViewport(page);
      await expect
        .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["edge.reader"]?.state))
        .toBe("loaded");
      const baseline = await exportFile(page, kind);
      const actual = await exportFile(page, kind, true);
      expect(held.requested()).toBe(true);
      expect(
        await page.evaluate(() => (window as unknown as { imageLoadingShells: string[] }).imageLoadingShells),
      ).toEqual([]);
      if (kind === "svg") {
        expect(actual.toString("utf8")).not.toMatch(/data-testid="[^"]*-loading"/);
        expect(canonicalSvg(actual)).toBe(canonicalSvg(baseline));
      } else expect(actual.equals(baseline)).toBe(true);
    } finally {
      held.release();
    }
  });
