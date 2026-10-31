import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLive, waitForCameraIdle, goToNode, setTheme, expectTheme } from "./fixtures";
import { installFakeSpeech, speech, speechState, openAdvanced, installFakeLanguageModel } from "./ai-helpers";

for (const onDevice of [false, true])
  for (const pending of [false, true])
    test(`R-db805d3041 hidden AI cancels ${onDevice ? "on-device" : "Advanced"} ${pending ? "pending" : "active"} dictation`, async ({
      page,
    }) => {
      await installFakeSpeech(page, { deferredAvailability: pending });
      if (onDevice) await installFakeLanguageModel(page);
      await gotoCanvas(page, "retry-storm");
      await openAdvanced(page);
      if (onDevice) {
        await page.getByTestId("ai-ondevice-toggle").check();
        await expect(page.getByTestId("ai-ondevice")).toBeVisible();
      }
      const input = page.getByTestId(onDevice ? "ai-ondevice-input" : "ai-request");
      const mic = page.getByTestId(onDevice ? "ai-ondevice-mic" : "ai-mic");
      await input.fill("Keep my draft");
      await mic.click();
      await expect(mic).toHaveAttribute("aria-pressed", "true");
      if (!pending) await expect.poll(async () => (await speechState(page)).active).toBe(1);
      await page.getByTestId("dock-tab-checks").click();
      await expect(page.getByTestId("ai-panel")).toBeHidden();
      if (pending) await speech(page, "resolveAvailability");
      await expect.poll(async () => (await speechState(page)).active).toBe(0);
      await page.keyboard.press("ControlOrMeta+Shift+m");
      await page.getByTestId("dock-tab-ai").click();
      await expect(mic).toHaveAttribute("aria-pressed", "false");
      await expect(input).toHaveValue("Keep my draft");
      expect((await speechState(page)).starts).toBe(pending ? 0 : 1);
    });

test("R-c7d1533b30 R-fdc778e36c returning from Stencils restores the rail focus and tab stop", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("view-gallery").click();
  await page.getByTestId("view-canvas").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-wrap")).toBeVisible();
  await expect(page.getByTestId("rail-select")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("rail-select")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("rail-select")).toBeFocused();
});

test("R-fdc778e36c closing phone overflow retains a visible rail tab stop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("rail-more").click();
  await page.getByTestId("shortcuts-button").focus();
  await page.getByTestId("rail-more").evaluate((el) => {
    el.parentElement?.removeAttribute("open");
  });
  await expect(page.getByTestId("rail-select")).toHaveAttribute("tabindex", "0");
});

test("R-8ea66b0634 restoring Checks in Live opens Properties", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("checks-count").click();
  await page.getByTestId("inspector-toggle").click();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("dock-tab-properties")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("checks-card")).toHaveCount(0);
});

test("R-caf692ac78 phone Speed retains native navigation keys", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&paused=1");
  await page.getByTestId("live-more").click();
  const speed = page.getByTestId("live-speed");
  await speed.focus();
  // Native selects consume these keys. No ancestor may cancel their default action.
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    expect(
      await speed.evaluate(
        (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
        key,
      ),
    ).toBe(true);
    await expect(speed).toBeFocused();
  }
  await speed.press("End");
  await speed.press("Tab");
  await expect(speed).toHaveValue("8");
});

test("R-1129cd5c6f presentation retains a working Live toggle", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toHaveCount(0);
  await expect(page.getByTestId("present-exit")).toBeVisible();
});

test("R-6c8bc47a03 ordinary presentation keeps playback controls", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&paused=1");
  await page.getByTestId("present-toggle").click();
  for (const id of ["live-play", "live-restart", "live-speed", "live-sim-picker", "live-more"])
    await expect(page.getByTestId(id)).toBeVisible();
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
});

test("R-94e0cd3edb narration navigation keeps focus on the sheet controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoLive(page, "./?view=canvas&example=retry-storm&live=1&sim=three-quick-retries&paused=1");
  const time = page.getByTestId("live-timeline-input");
  await time.fill("159");
  await time.press("ArrowRight");
  await expect(page.getByTestId("live-note-text")).toBeVisible();
  await page.getByTestId("live-note-expand").click();
  const later = page.getByTestId("live-note-later");
  await later.focus();
  const before = await page.getByTestId("live-note-text").textContent();
  await later.press("Enter");
  await expect(page.getByTestId("live-note-text")).not.toHaveText(before ?? "");
  await expect(page.getByTestId("live-note-close")).toBeFocused();
  const earlier = page.getByTestId("live-note-earlier");
  await earlier.focus();
  await earlier.press("Enter");
  await expect(page.getByTestId("live-note-text")).toHaveText(before ?? "");
  await expect(earlier).toBeFocused();
});

test("R-0994a05580 expectTheme only reads the rendered theme and checked choice", async ({ page }) => {
  await gotoCanvas(page, "retry-storm");
  await setTheme(page, "dark");
  const clicks: string[] = [];
  await page.exposeFunction("themeChoiceClicked", (id: string) => clicks.push(id));
  await page.evaluate(() =>
    document.addEventListener("click", (event) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-testid]")?.dataset.testid;
      if (id === "theme-dark" || id === "theme-light")
        void (window as unknown as { themeChoiceClicked(id: string): Promise<void> }).themeChoiceClicked(id);
    }),
  );
  await expectTheme(page, "dark");
  expect(clicks).toEqual([]);
});

const paths = (page: Page) =>
  page.getByTestId(/^connection-stroke-/).evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-testid"),
      stroke: el.getAttribute("d"),
      model: el.nextElementSibling?.getAttribute("d"),
    })),
  );

test("R-d4400bbfaa detail routing agrees with FlowEdge in icon-only view with hidden dependencies", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("diagrams.settings.v1", JSON.stringify({ nodeVariant: "iconOnly" }));
    localStorage.setItem("diagrams.showDependencies.v1", "0");
  });
  await gotoCanvas(page, "aks-app-config-key-vault");
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", "overview");
  await expect.poll(async () => (await paths(page)).filter((p) => p.stroke !== p.model)).toEqual([]);
});

test("R-64f737571f presenting restores connections truncated by Focus", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await gotoCanvas(page, "kafka-order-pipeline");
  await goToNode(page, "payments");
  await page.getByTestId("node-payments").click();
  await page.getByTestId("view-focus").click();
  await waitForCameraIdle(page);
  await expect.poll(async () => (await paths(page)).filter((p) => p.stroke !== p.model).length).toBeGreaterThan(0);
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("frame-detail")).toHaveCount(0);
  expect((await paths(page)).filter((p) => p.stroke !== p.model)).toEqual([]);
});

for (const mode of ["overview", "focus"])
  test(`R-061a263911 SVG export includes complete titles and routes from ${mode}`, async ({ page }) => {
    await gotoCanvas(page, "branch-to-datacentre");
    if (mode === "focus") {
      await page.getByTestId("node-staff").dispatchEvent("click");
      await page.getByTestId("view-focus").click();
    }
    await waitForCameraIdle(page);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", mode);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const downloading = page.waitForEvent("download");
    await page.getByTestId("image-export").click();
    const svg = readFileSync(await (await downloading).path(), "utf8");
    // Inspect the actual exported document: every title and label is visible, and strokes match hit paths.
    const defects = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return [
        ...doc.querySelectorAll(
          '[data-testid="card-title"], [data-testid^="edge-label-"], [data-testid^="connection-stroke-"]',
        ),
      ].flatMap((el) => {
        const hidden = [el, ...parents(el)].some((p) => p.getAttribute("style")?.includes("visibility: hidden"));
        const truncated =
          el.getAttribute("data-testid")?.startsWith("connection-stroke-") &&
          el.getAttribute("d") !== el.nextElementSibling?.getAttribute("d");
        return hidden || truncated ? [el.getAttribute("data-testid")] : [];
      });
      function parents(el: Element): Element[] {
        return el.parentElement ? [el.parentElement, ...parents(el.parentElement)] : [];
      }
    }, svg);
    expect(defects).toEqual([]);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-detail-view", mode);
  });

test("R-cf27e61cc1 Shift+2 frames an edge-only selection with its route and label", async ({ page }) => {
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("edge-order-events-to-notifications").dispatchEvent("click");
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("Shift+Digit2");
  await waitForCameraIdle(page);
  const pane = await page.getByTestId("canvas-wrap").boundingBox();
  for (const id of ["connection-stroke-order-events-to-notifications", "edge-label-order-events-to-notifications"]) {
    await expect(page.getByTestId(id)).toBeVisible();
    const box = await page.getByTestId(id).boundingBox();
    expect(
      box &&
        pane &&
        box.x >= pane.x &&
        box.y >= pane.y &&
        box.x + box.width <= pane.x + pane.width &&
        box.y + box.height <= pane.y + pane.height,
      id,
    ).toBe(true);
  }
});
