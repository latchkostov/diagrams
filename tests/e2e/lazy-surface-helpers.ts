import type { Page } from "@playwright/test";
import { lazySurfaces, type LazySurfaceId } from "../../src/lib/lazySurfaces";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";
import { existsSync, readFileSync } from "node:fs";
import { chunk } from "./chunk";
import type { DiagramFile } from "../../src/model/types";
import {
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  waitForInteractionIdle,
  openLiveNodeDetails,
  STORAGE_KEYS,
  expect,
} from "./fixtures";

const SLUG = "blocking-call";
const slowPayment = JSON.parse(readFileSync("src/examples/slow-payment-provider.json", "utf8")) as DiagramFile;
const kafka = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
const PAYMENT = "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts";

export function surfaceContract(id: LazySurfaceId) {
  const contract = lazySurfaces.find(([key]) => key === id);
  if (!contract) throw new Error(`Missing lazy surface contract: ${id}`);
  return contract;
}

/** Surface modules include both TS and TSX; hold the actual dev module as well as its build chunk. */
export function surfaceChunk(id: LazySurfaceId) {
  const [, name, source] = surfaceContract(id);
  const file = ["tsx", "ts"].map((extension) => `src/${source}.${extension}`).find((file) => existsSync(file));
  if (!file) throw new Error(`Missing lazy surface source: ${source}`);
  return chunk(name, file);
}

/** Real entry points, rather than test-only component replacements. Every registration must supply one. */
export async function openSurface(page: Page, id: LazySurfaceId) {
  const d = lazySurfacesFixture();
  await page.addInitScript(
    ({ diagrams, prefix }) => {
      for (const [slug, diagram] of diagrams) localStorage.setItem(prefix + slug, JSON.stringify(diagram));
      localStorage.setItem("diagrams.inspector.open.v1", "{}");
    },
    {
      diagrams: [
        [SLUG, d],
        ["slow-payment-provider", slowPayment],
        ["kafka-order-pipeline", kafka],
      ] as const,
      prefix: STORAGE_KEYS.autosavePrefix,
    },
  );

  if (id === "canvas.stencils") {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("rail-add").click();
    return;
  }
  if (id === "canvas.frame-detail") {
    await gotoCanvas(page, SLUG);
    return;
  }
  if (id === "examples.discovery") {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("example-picker").click();
    await page.getByTestId("picker-browse-examples").click();
    return;
  }
  if (id === "edge.shaping") {
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").click();
    return;
  }
  if (id === "canvas.check-markers") {
    await gotoCanvas(page, SLUG);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("Check diagram");
    await page.getByTestId("command-item-action:canvas.check-diagram").click();
    return;
  }
  if (id === "canvas.presence") {
    await page.addInitScript(() => {
      window.__collabEndpoints = { trackers: [], iceServers: [] };
    });
    await gotoCanvas(page, SLUG);
    await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
    await page.getByTestId("room-start-confirm").click();
    await page.getByTestId("room-started-done").click();
    return;
  }
  if (id.startsWith("inspector.") || id === "edge.reader" || id === "edge.message-tip" || id === "canvas.node-tips") {
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    switch (id) {
      case "inspector.diagram":
        if ((await page.getByTestId("inspector").getAttribute("data-collapsed")) === "1")
          await page.getByTestId("inspector-toggle").click();
        return;
      case "inspector.node-settings":
      case "inspector.identity":
      case "inspector.simulation":
      case "inspector.properties":
        await page.getByTestId("node-caller").dblclick();
        if (id !== "inspector.identity") {
          // Rename's identity chunk can finish after the settings chunk requested below. Let its
          // pending field-focus request finish before the keyboard contract focuses the shell.
          await expect
            .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.identity"]))
            .toEqual({ state: "loaded", active: true });
          await expect(page.getByTestId("inspector-field-label")).toBeFocused();
          await waitForInteractionIdle(page);
        }
        if (id === "inspector.properties") await page.getByTestId("inspector-section-node-properties").click();
        return;
      case "inspector.group":
        await page.getByTestId("group-label-commerce").dblclick();
        return;
      case "inspector.annotation":
        await page.getByTestId("annotation-note").click();
        return;
      case "inspector.multi":
        await page.getByTestId("canvas-wrap").focus();
        await page.keyboard.press("ControlOrMeta+a");
        return;
      case "canvas.node-tips":
      case "edge.reader":
        return; // The intent reader mounts in every canvas host.
      case "edge.message-tip":
        await page.getByTestId("edge-call").hover();
        return;
      default:
        await page.getByTestId("edge-call").dblclick();
        if (id === "inspector.call") await page.getByTestId("inspector-section-edge-simulation").click();
        if (id === "inspector.messages") await page.getByTestId("inspector-section-edge-messages").click();
        return;
    }
  }
  if (id === "tutorial.app") {
    await page.goto("./?tutorial=mobile-api");
    return;
  }
  if (id === "tutorial.list") {
    await page.goto("./?view=tutorials");
    return;
  }
  switch (id) {
    case "live.session":
      await page.goto(`./?view=canvas&example=${SLUG}&live=1&paused=1`);
      await expect(page.getByTestId("canvas-view")).toBeVisible();
      return;
    case "live.edit-capacity":
      await gotoCanvas(page, SLUG);
      await page.getByTestId("canvas-wrap").focus();
      await page.keyboard.press("c");
      return;
    case "live.timeline":
      await gotoLive(page, PAYMENT);
      return;
    case "live.note":
      await gotoLive(page, `./?view=canvas&example=${SLUG}&sim=narration&paused=1`);
      await page.getByTestId("live-play").click();
      return;
    case "live.trouble":
      await page.clock.install();
      await gotoLive(page, PAYMENT);
      await pauseClock(page);
      await page.getByTestId("live-play").click();
      for (let second = 1; second <= 15; second += 2) {
        await page.getByTestId("live-timeline-input").fill(String(second * 50));
        await page.getByTestId("live-play").focus();
      }
      await expect(page.getByTestId("live-clock")).toHaveAttribute("data-ms", "15000");
      await page.getByTestId("live-play").focus();
      await page.keyboard.press("Space");
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
      await page.clock.resume();
      return;
    case "live.slow-timeline":
      await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1");
      await waitForStableViewport(page);
      await page.getByTestId("node-shopper").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.slowmo-from").click();
      return;
    default:
      await gotoLive(page, `./?view=canvas&example=${SLUG}&live=1&paused=1`);
  }
  switch (id) {
    case "live.calls":
      await page.getByTestId("live-play").click();
      return;
    case "live.threads":
      return;
    case "live.capacity-analysis":
    case "live.capacity":
      await page.getByTestId("live-capacity").click();
      return;
    case "live.bottleneck":
      await page.getByTestId("view-button").click();
      await page.getByTestId("capacity-overlay-toggle").click();
      return;
    case "live.more":
    case "live.events":
    case "live.simulations":
    case "live.trace":
      await page.getByTestId("live-more").click();
      if (id === "live.events") await page.getByTestId("live-events-toggle").click();
      if (id === "live.simulations") await page.getByTestId("live-edit-sims").click();
      if (id === "live.trace") {
        await page.getByTestId("live-trace-message").click();
        await page.getByTestId("live-trace-next").click();
      }
      return;
    case "live.inject":
      await waitForStableViewport(page);
      await page.getByTestId("node-caller").click({ button: "right" });
      await page.getByTestId("context-menu-item-sim.inject").click();
      await page.getByTestId("context-menu-item-sim.inject:custom").click();
      return;
    case "live.node-details":
      await waitForStableViewport(page);
      await page.getByTestId("node-caller").evaluate((el) => el.parentElement?.focus());
      await page.keyboard.press("Enter");
      return;
    case "live.edge-details":
      await waitForStableViewport(page);
      await page.getByTestId("edge-call").evaluate((el) => el.closest<HTMLElement>("[tabindex]")?.focus());
      await page.keyboard.press("Enter");
      return;
    case "live.sections":
      await openLiveNodeDetails(page, "caller", "threads");
      return;
    case "live.history":
      await openLiveNodeDetails(page, "caller", "outcomes");
      return;
    default:
      throw new Error(`Missing lazy surface entry point: ${id}`);
  }
}
