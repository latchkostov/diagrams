import { test, expect, savedDiagram } from "./fixtures";
import type { Page } from "@playwright/test";
import { lazySurfaces, type LazySurfaceId } from "../../src/lib/lazySurfaces";
import { readFileSync } from "node:fs";
import { chunk, holdChunk } from "./chunk";
import { openSurface as open, surfaceChunk } from "./lazy-surface-helpers";
import { pauseClock } from "./fixtures";

test("simulation keyboard setup waits for the independently held identity and rename focus", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(chunk("NodeIdentity", "src/canvas/inspector/NodeIdentity.tsx"), async (route) => {
    await held;
    await route.continue();
  });
  let opened = false;
  const opening = open(page, "inspector.simulation").then(() => {
    opened = true;
  });
  try {
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.identity"]))
      .toEqual({ state: "loading", active: true });
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.simulation"]?.state))
      .toBe("loaded");
    expect(opened, "settings readiness alone must not finish keyboard setup").toBe(false);
    release();
    await opening;
    await expect(page.getByTestId("inspector-field-label")).toBeFocused();
    const picker = page.getByTestId("example-picker");
    await picker.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(picker).toBeFocused();
  } finally {
    release();
    await opening;
  }
});

async function exportHeldSvg(page: Page, id: LazySurfaceId) {
  const { release } = await holdChunk(page, surfaceChunk(id));
  try {
    if (id === "live.calls") await page.clock.install();
    await open(page, id);
    await expect
      .poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key], id))
      .toEqual({ state: "loading", active: true });
    if (id === "live.calls") {
      await pauseClock(page);
      await page.clock.runFor(1000);
      await page.getByTestId("live-play").click();
      await page.clock.resume();
    }
    let downloaded = false;
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    await expect(page.getByTestId("image-format-svg")).toHaveAttribute(
      "title",
      "Recordings capture Live narration; SVG exports don't include it.",
    );
    const download = page.waitForEvent("download").then((file) => {
      downloaded = true;
      return file;
    });
    await page.getByTestId("image-export").click();
    await expect.poll(() => page.evaluate(() => window.__lazySurfaces?.pendingOutputs())).toBeGreaterThan(0);
    expect(downloaded).toBe(false);
    await expect(page.getByTestId("image-export-cancel")).toBeFocused();
    release();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.svg$/);
    await expect(page.getByTestId("image-export-cancel")).toHaveCount(0);
    return readFileSync(await file.path(), "utf8");
  } finally {
    release();
  }
}

// LL-04 owner decision: narration belongs to recordings, outside the SVG viewport.
test("live.note: exported SVG excludes awaited narration", async ({ page }) => {
  const svg = await exportHeldSvg(page, "live.note");
  await expect(page.getByTestId("live-note-text")).toHaveText("Follow a request through the decision service.");
  expect(svg).not.toContain('data-testid="live-note-text"');
  expect(svg).not.toContain("Follow a request through the decision service.");
});

async function retrySurface(page: Page, id: LazySurfaceId) {
  await page.getByTestId(id === "live.sequence" ? "lazy-dialog-retry" : "lazy-load-retry").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key]?.state, id)).toBe("loaded");
  // Presence has no focus field of its own. Other surfaces keep the generated contract's
  // non-body keyboard stop. Wait for the actual keyboard target as well as the chunk.
  if (id === "canvas.presence") await expect(page.getByTestId("example-picker")).toBeFocused();
  else await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
}

for (const id of ["canvas.presence", "live.trace"] as const)
  test(`${id} Retry returns the keyboard without another animation frame`, async ({ page }) => {
    await page.clock.install();
    const held = await holdChunk(page, surfaceChunk(id));
    held.fail = true;
    try {
      await open(page, id);
      await expect.poll(() => page.evaluate((key) => window.__lazySurfaces?.states()[key]?.state, id)).toBe("failed");
      const picker = page.getByTestId("example-picker");
      await picker.focus();
      await page.getByTestId("lazy-load-retry").focus();
      await pauseClock(page);
      held.fail = false;
      held.release();
      await retrySurface(page, id);
      await expect(page.getByTestId("lazy-load-retry")).toHaveCount(0);
      await expect(picker).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(picker).toBeFocused();
    } finally {
      held.release();
      await page.clock.resume();
    }
  });

for (const [id, , , policy] of lazySurfaces) {
  if (policy === "await")
    test(`${id}: image export waits for its real chunk`, async ({ page }) => {
      const svg = await exportHeldSvg(page, id);
      if (id === "live.capacity-analysis") {
        expect(svg).toMatch(/data-testid="capacity-ring-caller"[^>]*data-level="ok"/);
        expect(svg).toMatch(/data-testid="capacity-label-caller"[^>]*data-level="ok"/);
        expect(svg).toContain("100/s of 20k/s");
      }
      if (id === "live.calls") {
        expect(svg).toContain('data-testid="call-pill-call"');
        expect(svg).toContain("in flight");
      }
      if (id === "live.threads") {
        expect(svg).toMatch(/data-testid="thread-meter-caller"[^>]*data-working="0"[^>]*data-waiting="0"/);
        expect(svg).toContain('aria-valuemax="400"');
      }
      if (id === "live.session") {
        expect(svg).toContain('data-testid="node-badge-caller"');
        expect(svg).toContain('data-testid="thread-meter-caller"');
      }
    });
  test(`${id}: held chunk, keyboard, export policy and Retry`, async ({ page }) => {
    let requested = false;
    let mode: "hold" | "fail" | "pass" = "hold";
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(surfaceChunk(id), async (route) => {
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
      // A tutorial replaces the app (no top bar, no saved diagram): its stand-in bar keeps the way out. The
      // Tutorials view has the top bar but no diagram open.
      const tutorial = id === "tutorial.app";
      const focus = page.getByTestId(
        id === "examples.discovery"
          ? "examples-search"
          : id === "live.sequence"
            ? "lazy-dialog-close"
            : id === "live.inject"
              ? "inject-loading-close"
              : id === "live.simulations"
                ? "sim-panel-close"
                : tutorial
                  ? "tutorial-exit"
                  : id === "tutorial.list"
                    ? "view-button"
                    : "example-picker",
      );
      await focus.focus();
      await expect(focus).toBeFocused();
      const before = id.startsWith("tutorial.") ? undefined : await savedDiagram(page);
      if (!tutorial) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
        await page.keyboard.press("Shift+Tab");
        await expect(focus).toBeFocused();
      }
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
      await retrySurface(page, id);
      if (before) expect(await savedDiagram(page)).toEqual(before);
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    } finally {
      release();
    }
  });
}
