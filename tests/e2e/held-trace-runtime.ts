import type { Page } from "@playwright/test";
import { expect, gotoLive, waitForCameraIdle } from "./fixtures";
import { chunk, holdChunk } from "./chunk";

export const TRACE_RUNTIME = chunk("TraceRuntime", "src/live/slowmo/TraceRuntime.tsx");
export async function holdTraceRuntime(page: Page, query = "") {
  const held = await holdChunk(page, TRACE_RUNTIME);
  await gotoLive(page, `./?view=canvas&example=kafka-order-pipeline&live=1${query}`);
  await waitForCameraIdle(page);
  // Mutation control: a static runtime import prevents even this first Live frame.
  expect(held.requested()).toBe(false);
  return held;
}
export async function replayNode(page: Page) {
  await waitForCameraIdle(page);
  await page.getByTestId("node-shopper").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.slowmo-from").click();
  await expect(page.getByTestId("slowmo-loading")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["live.trace-runtime"]))
    .toEqual({ state: "loading", active: true });
}
export async function traceNext(page: Page) {
  await waitForCameraIdle(page);
  await page.getByTestId("node-shopper").click({ button: "right" });
  await page.getByTestId("context-menu-item-sim.trace-next").click();
}
