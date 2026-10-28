// Live view on large diagrams (docs/BENCHMARKS.md § Live view on large diagrams): above LARGE_LIVE_ELEMENTS nodes and
// edges the per-element fades are dropped, because hundreds of them running at once starved the renderer; a small
// diagram keeps them.

import type { Page } from "@playwright/test";
import { eventPipeline } from "../../src/bench/workloads/pipeline";
import { LARGE_LIVE_ELEMENTS } from "../../src/live/decorations";
import { expect, pageLoadTimeout, test, waitForCameraIdle } from "./fixtures";

/** Opens a generated pipeline of `n` nodes live, as a saved diagram opens. */
async function openLive(page: Page, n: number) {
  const d = eventPipeline(n);
  await page.addInitScript((text) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("diagrams.imported.v1", text);
      sessionStorage.setItem("seeded", "1");
    }
  }, JSON.stringify(d));
  await page.goto("./?view=canvas&example=imported&live=1");
  await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live", "on");
  return { d, elements: d.nodes.length + d.edges.length };
}

/** The fades in effect: the transition durations on an edge's parts, and on a node's wrapper (React Flow's). */
async function fades(page: Page, edgeId: string, nodeId: string) {
  const edge = await page
    .getByTestId(`edge-${edgeId}`)
    .evaluate((g) => [...new Set([...g.querySelectorAll("*")].map((el) => getComputedStyle(el).transitionDuration))]);
  const node = await page.getByTestId(`node-${nodeId}`).evaluate((el) => {
    const wrapper = el.closest("[data-id]");
    if (!wrapper) throw new Error("no node wrapper");
    return getComputedStyle(wrapper).transitionDuration;
  });
  return { edge: edge.sort(), node };
}

test.describe("live view on large diagrams", () => {
  test("settled Overview never remeasures cards for changing Live badge numbers", async ({ page }) => {
    test.slow();
    const { d } = await openLive(page, 500);
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-far", "");
    await page.evaluate(async () => {
      for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
      const original = Element.prototype.getBoundingClientRect;
      const counter = {
        reads: 0,
        restore: () => {
          Element.prototype.getBoundingClientRect = original;
        },
      };
      (window as unknown as { __cardReads: typeof counter }).__cardReads = counter;
      Element.prototype.getBoundingClientRect = function () {
        if (this.getAttribute("data-testid")?.startsWith("rf__node-")) counter.reads++;
        return original.call(this);
      };
    });
    try {
      await page.getByTestId(`rf__node-${d.nodes[0].id}`).evaluate((el) => el.getBoundingClientRect());
      expect(
        await page.evaluate(() => (window as unknown as { __cardReads: { reads: number } }).__cardReads.reads),
      ).toBe(1);
      const reads = await page.evaluate(async () => {
        const w = window as unknown as {
          __cardReads: { reads: number };
          __liveBench: { decorations: { applies: number } };
        };
        w.__cardReads.reads = 0;
        const start = w.__liveBench.decorations.applies;
        while (w.__liveBench.decorations.applies - start < 10) await new Promise(requestAnimationFrame);
        return w.__cardReads.reads;
      });
      expect(reads).toBe(0);
    } finally {
      await page.evaluate(() => (window as unknown as { __cardReads: { restore(): void } }).__cardReads.restore());
    }
  });

  for (const n of [100, 500])
    test(`closing the capacity panel only reads Overview labels for the camera fit @${n}`, async ({ page }) => {
      test.slow();
      await openLive(page, n);
      await waitForCameraIdle(page);
      await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-far", "");
      await page.getByTestId("live-capacity").click();
      await expect(page.getByTestId("capacity-panel")).toBeVisible();
      await waitForCameraIdle(page);
      await page.evaluate(() => {
        const original = Element.prototype.getBoundingClientRect;
        const counter = {
          reads: new Map<string, number>(),
          restore: () => {
            Element.prototype.getBoundingClientRect = original;
          },
        };
        (window as unknown as { __labelReads: typeof counter }).__labelReads = counter;
        Element.prototype.getBoundingClientRect = function () {
          const id = this.getAttribute("data-testid");
          if (id?.startsWith("edge-label-")) counter.reads.set(id, (counter.reads.get(id) ?? 0) + 1);
          return original.call(this);
        };
      });
      try {
        await page.getByTestId("capacity-close").click();
        await expect(page.getByTestId("capacity-panel")).toHaveCount(0);
        await waitForCameraIdle(page);
        const reads = await page.evaluate(async () => {
          for (let frame = 0; frame < 20; frame++) await new Promise(requestAnimationFrame);
          return Math.max(
            0,
            ...(window as unknown as { __labelReads: { reads: Map<string, number> } }).__labelReads.reads.values(),
          );
        });
        expect(reads).toBeLessThanOrEqual(1);
      } finally {
        await page.evaluate(() => (window as unknown as { __labelReads: { restore(): void } }).__labelReads.restore());
      }
    });

  test("a small diagram keeps its fades", async ({ page, consoleErrors }) => {
    const { d, elements } = await openLive(page, 100);
    expect(elements).toBeLessThan(LARGE_LIVE_ELEMENTS);
    await expect(page.getByTestId("rf__wrapper")).not.toHaveAttribute("data-live-large", /.*/);
    expect(await fades(page, d.edges[0].id, d.nodes[0].id)).toEqual({
      edge: ["0.35s, 0.35s", "0s"],
      node: "0.35s, 0.35s",
    });
    expect(consoleErrors).toEqual([]);
  });

  test("a large diagram changes state without fading", async ({ page, consoleErrors }) => {
    test.slow();
    const { d, elements } = await openLive(page, 600);
    expect(elements).toBeGreaterThan(LARGE_LIVE_ELEMENTS);
    await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-large", "1");
    expect(await fades(page, d.edges[0].id, d.nodes[0].id)).toEqual({ edge: ["0s"], node: "0s" });
    // Edges still go active as messages travel them.
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('[data-live-edge="active"]').length), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    // Leaving live view clears the mark.
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("rf__wrapper")).not.toHaveAttribute("data-live-large", /.*/);
    expect(consoleErrors).toEqual([]);
  });
});
