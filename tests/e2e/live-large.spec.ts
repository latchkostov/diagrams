// Live view on large diagrams (docs/BENCHMARKS.md § Live view on large diagrams): above LARGE_LIVE_ELEMENTS nodes and
// edges the per-element fades are dropped, because hundreds of them running at once starved the renderer; a small
// diagram keeps them.

import type { Page } from "@playwright/test";
import { eventPipeline } from "../../src/bench/workloads/pipeline";
import { LARGE_LIVE_ELEMENTS } from "../../src/live/decorations";
import { expect, pageLoadTimeout, test } from "./fixtures";

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
