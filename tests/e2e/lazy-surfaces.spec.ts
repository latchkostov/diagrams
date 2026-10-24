import type { Page } from "@playwright/test";
import { lazySurfaces, type LazySurfaceId } from "../../src/lib/lazySurfaces";
import { lazySurfacesFixture } from "../../src/lab/lazySurfacesFixture";
import { readFileSync } from "node:fs";
import type { DiagramFile } from "../../src/model/types";
import { chunk } from "./chunk";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  waitForStableViewport,
  openLiveNodeDetails,
  savedDiagram,
  STORAGE_KEYS,
} from "./fixtures";

const SLUG = "blocking-call";
const slowPayment = JSON.parse(readFileSync("src/examples/slow-payment-provider.json", "utf8")) as DiagramFile;
const kafka = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
const PAYMENT = "./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=no-timeouts";

/** Real entry points, rather than test-only component replacements. Every registration must supply one. */
async function open(page: Page, id: LazySurfaceId) {
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
  if (id === "canvas.menu") {
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").click({ button: "right" });
    return;
  }
  if (id === "canvas.grow") {
    await gotoCanvas(page, SLUG);
    await waitForStableViewport(page);
    await page.getByTestId("node-caller").click();
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
      case "inspector.node":
      case "inspector.identity":
      case "inspector.simulation":
      case "inspector.properties":
        await page.getByTestId("node-caller").dblclick();
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

for (const [id, name, source, policy] of lazySurfaces) {
  if (policy === "await")
    test(`${id}: image export waits for its real chunk`, async ({ page }) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(chunk(name, `src/${source}.tsx`), async (route) => {
        await held;
        await route.continue();
      });
      try {
        await open(page, id);
        await expect
          .poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key], id))
          .toEqual({ state: "loading", active: true });
        if (id === "live.calls") await page.getByTestId("live-play").click();
        let downloaded = false;
        await page.getByTestId("file-button").click();
        await page.getByTestId("file-more-formats").click();
        await page.getByTestId("export-image").click();
        await page.getByTestId("image-options-toggle").click();
        await page.getByTestId("image-format-svg").click();
        const download = page.waitForEvent("download").then((file) => {
          downloaded = true;
          return file;
        });
        await page.getByTestId("image-export").click();
        await expect.poll(() => page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBeGreaterThan(0);
        expect(downloaded).toBe(false);
        await expect(page.getByTestId("image-export-cancel")).toBeFocused();
        release();
        expect((await download).suggestedFilename()).toMatch(/\.svg$/);
        await expect(page.getByTestId("image-export-cancel")).toHaveCount(0);
      } finally {
        release();
      }
    });
  test(`${id}: held chunk, keyboard, export policy and Retry`, async ({ page }) => {
    let requested = false;
    let mode: "hold" | "fail" | "pass" = "hold";
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(chunk(name, `src/${source}.tsx`), async (route) => {
      requested = true;
      if (mode === "hold") await held;
      if (mode === "fail") await route.abort("failed");
      else await route.continue();
    });
    try {
      await open(page, id);
      await expect.poll(() => requested).toBe(true);
      await expect
        .poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key], id))
        .toEqual({ state: "loading", active: true });
      if (id === "live.calls") await page.getByTestId("live-play").click();
      // A surviving shell control remains a keyboard stop. The specialised rename/modal tests keep
      // their stronger typing, Escape and cancellation assertions alongside this generated contract.
      const focus = page.getByTestId(
        id === "live.inject"
          ? "inject-loading-close"
          : id === "live.simulations"
            ? "sim-panel-close"
            : "example-picker",
      );
      await focus.focus();
      await expect(focus).toBeFocused();
      const before = await savedDiagram(page);
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
      await page.keyboard.press("Shift+Tab");
      await expect(focus).toBeFocused();
      expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toMatch(/wait|progress/);
      // This is the readiness hook used by image export and recording. It must signal skip without
      // waiting, or remain pending until the held output chunk arrives. No elapsed-time assertion.
      await page.evaluate(() => {
        document.documentElement.dataset.surfaceExport = "pending";
        const surfaces = window.__lazySurfaces;
        if (!surfaces) throw new Error("Missing lazy surface test adapter");
        void surfaces.ensureLoaded().then(
          () => {
            document.documentElement.dataset.surfaceExport = "ready";
          },
          () => {
            document.documentElement.dataset.surfaceExport = "failed";
          },
        );
      });
      if (policy === "skip")
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.surfaceExport)).toBe("ready");
      else expect(await page.evaluate(() => document.documentElement.dataset.surfaceExport)).toBe("pending");
      mode = "fail";
      release();
      await expect.poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key]?.state, id)).toBe("failed");
      await expect(page.getByTestId("lazy-load-retry")).toBeVisible();
      if (id === "live.simulations") await expect(page.getByTestId("sim-panel-load-retry")).toBeFocused();
      else await expect(focus).toBeFocused();
      mode = "pass";
      await page.getByTestId("lazy-load-retry").focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key]?.state, id)).toBe("loaded");
      expect(await savedDiagram(page)).toEqual(before);
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    } finally {
      release();
    }
  });
}
