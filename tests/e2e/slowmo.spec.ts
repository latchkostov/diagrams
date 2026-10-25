import {
  animationFrames,
  test,
  expect,
  expectNoErrors,
  gotoLive,
  pauseClock,
  cameraJournal,
  cameraJournalMark,
  viewportTransform,
  waitForCameraIdle,
  interactionJournalMark,
  liveKeyLevels,
} from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { holdTraceRuntime, replayNode } from "./held-trace-runtime";
import { holdChunk } from "./chunk";

for (const heldRuntime of [false, true]) {
  for (const panel of ["capacity", "sim"] as const) {
    test(`replay panel Escape matches eager behaviour: ${panel}, held=${heldRuntime}`, async ({ page }) => {
      const held = await holdTraceRuntime(page);
      try {
        if (!heldRuntime) {
          await replayNode(page);
          held.release();
          await expect(page.getByTestId("slowmo-chip")).toBeVisible();
          await page.getByTestId("trace-card-close").click();
        }
        if (panel === "capacity") await page.getByTestId("live-capacity").click();
        else {
          await page.getByTestId("live-more").click();
          await page.getByTestId("live-edit-sims").click();
        }
        await expect(page.getByTestId(`${panel}-panel`)).toBeVisible();
        if (heldRuntime) await replayNode(page);
        else {
          await waitForCameraIdle(page);
          await page.getByTestId("node-shopper").click({ button: "right" });
          await page.getByTestId("context-menu-item-sim.slowmo-from").click();
          await expect(page.getByTestId("slowmo-chip")).toBeVisible();
        }
        await page.getByTestId(panel === "capacity" ? "capacity-close" : "sim-panel-close").focus();
        await page.keyboard.press("Escape");
        await expect(page.getByTestId(`${panel}-panel`)).toHaveCount(0);
        if (heldRuntime) {
          await expect(page.getByTestId("slowmo-loading")).toBeVisible();
          held.release();
        }
        await expect(page.getByTestId("slowmo-chip")).toBeVisible();
      } finally {
        held.release();
      }
    });
  }
  test(`replay keys on selected focused node match eager behaviour: held=${heldRuntime}`, async ({ page }) => {
    const held = await holdTraceRuntime(page, "&paused=1");
    try {
      await replayNode(page);
      if (!heldRuntime) {
        held.release();
        await expect(page.getByTestId("slowmo-chip")).toBeVisible();
      }
      await waitForCameraIdle(page);
      await page.getByTestId("node-shopper").click();
      await page.getByTestId("rf__node-shopper").focus();
      await expect(page.getByTestId("rf__node-shopper")).toBeFocused();
      const position = await page.getByTestId("node-shopper").evaluate((el) => el.parentElement?.style.transform);
      for (const key of ["Enter", "ArrowRight", "ArrowLeft", "Space"]) {
        await page.keyboard.press(key);
        await expect(page.getByTestId("rf__node-shopper")).toBeFocused();
        expect(await page.getByTestId("node-shopper").evaluate((el) => el.parentElement?.style.transform)).toBe(
          position,
        );
      }
      if (heldRuntime) {
        await expect(page.getByTestId("slowmo-loading")).toBeVisible();
        held.release();
      }
      await expect(page.getByTestId("slowmo-chip")).toBeVisible();
    } finally {
      held.release();
    }
  });
}

for (const renderer of ["worker", "main"] as const) {
  for (const paused of [false, true]) {
    for (const reduced of [false, true]) {
      test(`held runtime: ${renderer}, ${paused ? "paused" : "live"}, reduced=${reduced}: checkpoint, keys and camera`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await page.clock.install();
        const held = await holdTraceRuntime(
          page,
          `${renderer === "main" ? "&renderer=main" : ""}${paused ? "&paused=1" : ""}`,
        );
        try {
          await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-renderer", renderer);
          await pauseClock(page);
          const before = await viewportTransform(page);
          await replayNode(page);
          await page.clock.runFor(250);
          const checkpoint = await page.getByTestId("live-canvas").getAttribute("data-sim-time");
          if (checkpoint === null) throw new Error("Missing requested replay state");
          await expect.poll(held.requested).toBe(true);
          for (const key of ["Space", "Enter", "ArrowLeft", "ArrowRight"]) {
            await page.getByTestId("canvas-wrap").focus();
            await page.keyboard.press(key);
          }
          await page.clock.runFor(1000);
          await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", checkpoint);
          expect(await viewportTransform(page)).toBe(before);
          held.release();
          await page.clock.resume();
          await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
          await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-sim-time", checkpoint);
          await page.getByTestId("trace-slowmo").focus();
          await page.keyboard.press("Enter");
          await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "paused");
          await page.getByTestId("trace-card-close").focus();
          await page.keyboard.press("Enter");
          await waitForCameraIdle(page);
          expect(await viewportTransform(page)).toBe(before);
          await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", paused ? "paused" : "playing");
        } finally {
          held.release();
        }
      });
    }
  }
}

test("held runtime: Escape, exit/re-entry and late completion cannot retake the camera", async ({ page }) => {
  const held = await holdTraceRuntime(page, "&paused=1");
  try {
    await replayNode(page);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("slowmo-loading")).toHaveCount(0);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await replayNode(page);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await waitForCameraIdle(page);
    const before = await viewportTransform(page);
    const mark = await cameraJournalMark(page);
    held.release();
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["live.trace-runtime"]?.state))
      .toBe("loaded");
    await animationFrames(page, 20);
    await expect(page.getByTestId("slowmo-chip")).toHaveCount(0);
    expect(await viewportTransform(page)).toBe(before);
    expect((await cameraJournal(page, mark)).filter((entry) => /slowmo/i.test(entry.command))).toEqual([]);
  } finally {
    held.release();
  }
});

test("held runtime: pending palette owns Escape before its dialog mounts", async ({ page }) => {
  const palette = await holdChunk(page, /\/assets\/PaletteDialog-[\w-]+\.js/);
  const held = await holdTraceRuntime(page);
  try {
    await replayNode(page);
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("ControlOrMeta+k");
    await expect.poll(palette.requested).toBe(true);
    await expect(page.getByTestId("command-input")).toHaveCount(0);
    held.release();
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-trace-runtime", "queued");
    await expect(page.getByTestId("slowmo-loading")).toBeVisible();
    await page.keyboard.press("Escape");
    palette.release();
    await expect(page.getByTestId("command-input")).toHaveCount(0);
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", "playing");
    await page.getByTestId("trace-card-close").click();
  } finally {
    held.release();
    palette.release();
  }
});

// Slow motion: one message's recorded journey, replayed node by node while live stays frozen; and
// calmer drawing below 1×. Selectors are data-testid only (axe takes [data-testid] CSS).

const KAFKA = "kafka-order-pipeline";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
const canvas = (page: Page) => page.getByTestId("live-canvas");
const play = (page: Page) => page.getByTestId("live-play");
const clockMs = async (page: Page) => Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
const data = async (page: Page, name: string) => canvas(page).getAttribute(`data-${name}`);
/** The viewport transform, as numbers. */
const view = (transform: string) => {
  const [x, y, zoom] = (transform.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  return { x, y, zoom };
};

async function openNodeMenu(page: Page, nodeId: string, actionId: string) {
  await waitForCameraIdle(page);
  await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
  await menuItem(page, actionId).click();
}

async function openCanvasSubmenu(page: Page, parent: string, child: string) {
  await waitForCameraIdle(page);
  const box = await page.getByTestId("canvas-wrap").boundingBox();
  if (!box) throw new Error("No canvas");
  await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: box.width / 2, y: 90 } });
  await menuItem(page, parent).click();
  await menuItem(page, child).click();
}

/** Kafka in free play with traffic flowing, then slow motion from the Storefront. */
async function watchFromStorefront(page: Page, query = "") {
  await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1${query}`);
  // Let traffic build up so there's a busy background to freeze.
  await expect.poll(async () => Number(await data(page, "particles")), { timeout: 10_000 }).toBeGreaterThan(40);
  await openNodeMenu(page, "shopper", "sim.slowmo-from");
  await expect(canvas(page)).toHaveAttribute("data-slowmo-machine", "playing");
  await expect(play(page)).toHaveAttribute("data-state", "slowmo");
  await expect(canvas(page)).toHaveAttribute("data-slowmo", "playing");
}

test.describe("slow motion", () => {
  test("starts at 1×, the pace control works, and exit restores live speed", async ({ page, consoleErrors }) => {
    await watchFromStorefront(page, "&speed=8");
    await expect(page.getByTestId("live-speed")).toHaveValue("1");
    await play(page).click();
    await page.getByTestId("live-speed").selectOption("0.5");
    await expect(page.getByTestId("live-speed")).toHaveValue("0.5");
    await play(page).click();
    const at = Number(await page.getByTestId("slowmo-timeline-input").inputValue());
    await expect
      .poll(async () => Number(await page.getByTestId("slowmo-timeline-input").inputValue()))
      .toBeGreaterThan(at);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("live-speed")).toHaveValue("8");
    await page.getByTestId("trace-slowmo").click();
    await expect(page.getByTestId("live-speed")).toHaveValue("1");
    expectNoErrors(consoleErrors);
  });

  test("engine changes are disabled consistently; tracing, sequence and recording remain available", async ({
    page,
    consoleErrors,
  }) => {
    test.fixme(process.platform === "win32", "Nightly native teardown: docs/backlog/2026-10-18-nightly-native-load.md");
    await watchFromStorefront(page);
    await play(page).click();
    await waitForCameraIdle(page);
    await page.getByTestId("node-payments").click({ button: "right" });
    for (const id of ["sim.inject", "sim.storm"]) {
      await expect(menuItem(page, id)).toHaveAttribute("aria-disabled", "true");
      await expect(menuItem(page, id)).toContainText("Exit slow motion (Esc) first");
    }
    await expect(menuItem(page, "sim.trace-next")).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "sim.fault").click();
    await expect(menuItem(page, "sim.kill")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "sim.failure")).toContainText("Exit slow motion (Esc) first");
    await page.keyboard.press("Escape");
    await page.getByTestId("node-payments").click({ button: "right" });
    await menuItem(page, "sim.behaviour").click();
    await expect(menuItem(page, "sim.pause")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "sim.events")).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await page.getByTestId("node-payments").click();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("Take down");
    const kill = page.getByTestId("command-item-action:sim.kill");
    await expect(kill).toHaveAttribute("aria-disabled", "true");
    await expect(kill).toContainText("Exit slow motion (Esc) first");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("command-input")).toBeVisible();
    await page.getByTestId("command-input").fill("black");
    await expect(page.getByTestId("command-item-sim:black-friday")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.getByTestId("live-more").click();
    await expect(page.getByTestId("live-traffic")).toBeDisabled();
    await expect(page.getByTestId("live-traffic")).toHaveAttribute("title", "Exit slow motion (Esc) first");
    await expect(page.getByTestId("live-record")).toBeEnabled();
    await page.getByTestId("live-record").click();
    await expect(page.getByTestId("record-opt-slowmo")).toBeChecked();
    await page.getByTestId("record-cancel").click();
    await expect(page.getByTestId("trace-sequence")).toBeEnabled();
    await page.getByTestId("trace-sequence").click();
    await expect(page.getByTestId("sequence-dialog")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("an open Inputs panel and capacity Apply fix wait until slow motion ends", async ({ page, consoleErrors }) => {
    test.fixme(process.platform === "win32", "Nightly native teardown: docs/backlog/2026-10-18-nightly-native-load.md");
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&sim=black-friday&paused=1`);
    await page.getByTestId("live-capacity").click();
    // 1,200 orders/s at quarter capacity still overloads consumers and offers Apply fix. Keep capture small:
    // at 6,000/s, background look-ahead alone can consume half the whole-test backstop under load.
    await page.getByTestId("capacity-traffic-mult").fill("7");
    await page.getByTestId("capacity-capacity-mult").fill("0");
    await expect(page.getByTestId("bottleneck-apply")).toBeEnabled();
    await openNodeMenu(page, "shopper", "sim.slowmo-from");
    // Capturing this busy run yields between look-ahead slices. Its completion, like a lazy download,
    // uses the whole-test hang backstop; the replay and mutation assertions retain their normal timeout.
    await play(page).evaluate(
      (button) =>
        new Promise<void>((resolve) => {
          const ready = () => {
            if (button.hasAttribute("disabled")) return;
            observer.disconnect();
            resolve();
          };
          const observer = new MutationObserver(ready);
          observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
          ready();
        }),
    );
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await expect(page.getByTestId("capacity-context")).toHaveText("Exit slow motion (Esc) first");
    for (const id of [
      "capacity-traffic-mult",
      "capacity-capacity-mult",
      "capacity-replicas-payments",
      "scale-override",
      "capacity-reset",
      "capacity-save",
      "bottleneck-apply",
    ])
      await expect(page.getByTestId(id)).toBeDisabled();
    await expect(page.getByTestId("bottleneck-apply")).toHaveAttribute("title", "Exit slow motion (Esc) first");
    await page.getByTestId("capacity-close").click();
    await page.getByTestId("trace-card-close").click();
    await page.getByTestId("live-capacity").click();
    await expect(page.getByTestId("capacity-traffic-mult")).toBeEnabled();
    await expect(page.getByTestId("bottleneck-apply")).toBeEnabled();
    expectNoErrors(consoleErrors);
  });

  test("from a node: the background freezes, at most 4 dots move, captions tell each hop", async ({
    page,
    consoleErrors,
  }) => {
    await page.clock.install();
    await watchFromStorefront(page);
    await pauseClock(page);
    await expect(page.getByTestId("slowmo-chip")).toContainText("live paused");
    await expect(page.getByTestId("live-clock")).toHaveAttribute("data-mode", "slowmo");
    const time = await data(page, "sim-time");
    const sum = await data(page, "particle-sum");
    const moving: number[] = [];
    const captions = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.clock.runFor(150);
      // One protocol round trip per sample: the four readings belong to the same frozen frame.
      const sample = await canvas(page).evaluate((el) => ({
        dots: Number(el.getAttribute("data-slowmo-dots")),
        caption: document.querySelector('[data-testid="slowmo-caption"]')?.textContent ?? "",
        time: el.getAttribute("data-sim-time"),
        sum: el.getAttribute("data-particle-sum"),
      }));
      moving.push(sample.dots);
      captions.add(sample.caption);
      // Live is frozen: the clock and every background dot stay exactly where they were.
      expect(sample.time).toBe(time);
      expect(sample.sum).toBe(sum);
    }
    expect(Math.max(...moving)).toBeLessThanOrEqual(4);
    expect(Math.max(...moving)).toBeGreaterThanOrEqual(1);
    expect([...captions]).toContainEqual(expect.stringMatching(/^Commerce gateway · route POST \/orders · \d+ ms$/));
    expect([...captions]).toContainEqual(
      expect.stringMatching(/^Order service · POST \/orders · \d+ ms → OrderPlaced$/),
    );
    // The captions drawn on the canvas are reported too, clear of each other.
    const drawn = JSON.parse((await data(page, "slowmo-captions")) ?? "[]") as {
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    for (const [i, a] of drawn.entries())
      for (const b of drawn.slice(i + 1))
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    // The first hop in the card is where the story starts.
    await page.keyboard.press("Space");
    await page
      .getByTestId(/^trace-hop-seek-/)
      .first()
      .click();
    await expect(page.getByTestId("slowmo-caption")).toHaveText("Storefront sends OrderRequest");
    // The ⋯ menu's step becomes "Next hop".
    await page.getByTestId("live-more").click();
    await expect(page.getByTestId("live-step")).toContainText("Next hop");
    await page.keyboard.press("Escape");
    expectNoErrors(consoleErrors);
  });

  test("Space pauses, ← and → step hop by hop, and a trace card hop seeks", async ({ page, consoleErrors }) => {
    await watchFromStorefront(page, "&speed=2");
    await page.keyboard.press("Space");
    await expect(play(page)).toHaveAttribute("data-playing", "0");
    await expect(page.getByTestId("trace-slowmo")).toHaveAttribute("data-state", "paused");
    // Where the replay is: the timeline's position (0–1000).
    const at = async () => Number(await page.getByTestId("slowmo-timeline-input").inputValue());
    const start = await at();
    const beat = Number(await data(page, "slowmo-beat"));
    await page.keyboard.press("ArrowRight");
    await expect.poll(at).toBeGreaterThan(start);
    await expect.poll(async () => Number(await data(page, "slowmo-beat"))).not.toBe(beat);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => clockMs(page)).toBeGreaterThan(0);
    const later = await at();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(at).toBeLessThan(later);
    // Still paused after stepping.
    await expect(canvas(page)).toHaveAttribute("data-slowmo-machine", "paused");
    await animationFrames(page, 20);
    expect(await play(page).getAttribute("data-playing")).toBe("0");

    // The card highlights the hop being told; clicking another hop tells the story from there.
    await expect(page.getByTestId("trace-row-current")).toHaveAttribute("aria-current", "step");
    const seekers = page.getByTestId(/^trace-hop-seek-/);
    // A hop's name is what a click does, then everything the row says (its node, where from, latency).
    await expect(seekers.nth(1)).toHaveAccessibleName(
      /^Play from here: \+\d+\.\d+ s.*Commerce gateway.*from Storefront/,
    );
    const last = seekers.last();
    const key = ((await last.getAttribute("data-testid")) ?? "").replace("trace-hop-seek-", "");
    await last.click();
    await expect(page.getByTestId("trace-row-current")).toHaveAttribute("data-row", key);
    expect(await at()).toBeGreaterThan(later);

    await page.getByTestId("trace-slowmo").click();
    await expect(play(page)).toHaveAttribute("data-playing", "1");
    // Replay restarts from the first beat.
    await page.getByTestId("live-restart").click();
    await expect.poll(() => clockMs(page)).toBeLessThan(400);
    expectNoErrors(consoleErrors);
  });

  test("Esc goes back to live exactly where it left off, paused or playing", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await expect.poll(async () => Number(await data(page, "particles")), { timeout: 10_000 }).toBeGreaterThan(20);
    await play(page).click();
    await expect(play(page)).toHaveAttribute("data-state", "paused");
    await waitForCameraIdle(page);
    await animationFrames(page);
    await expect(canvas(page)).toHaveAttribute("data-live-playing", "false");
    const time = await data(page, "sim-time");
    const sum = await data(page, "particle-sum");
    await waitForCameraIdle(page);
    const mark = await cameraJournalMark(page);
    await openNodeMenu(page, "payments", "sim.slowmo-from");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await expect(canvas(page)).toHaveAttribute("data-slowmo-machine", "playing");
    await expect.poll(async () => Number(await data(page, "slowmo-progress"))).toBeGreaterThan(0);
    const keys = await interactionJournalMark(page);
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "paused");
    // Slow motion's own Esc (liveKeys row X1): live view's chain never acts on it. Slow motion's listener usually
    // stops the key before live view's hears it; when live view's hears it first, it journals the level and yields.
    expect(["", "escape:slowmo"]).toContain((await liveKeyLevels(page, keys)).join());
    // Slow motion planned its take, then gave the view back where it was (panePolicy W4, W2).
    const commands = (await cameraJournal(page, mark)).map((e) => e.command);
    expect(commands.indexOf("slowmoPlan")).toBeGreaterThanOrEqual(0);
    expect(commands.at(-1)).toBe("restore");
    await expect(canvas(page)).not.toHaveAttribute("data-slowmo", /.*/);
    await waitForCameraIdle(page);
    await animationFrames(page);
    expect(await data(page, "sim-time")).toBe(time);
    expect(await data(page, "particle-sum")).toBe(sum);
    // The trace stays on: live at real speed shows the same message.
    await expect(page.getByTestId("trace-card")).toBeVisible();

    // Playing before: playing again after, from the same moment.
    await play(page).click();
    await expect(play(page)).toHaveAttribute("data-state", "playing");
    await page.getByTestId("trace-slowmo").click();
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await waitForCameraIdle(page);
    await animationFrames(page);
    const frozen = Number(await data(page, "sim-time"));
    const replayAt = Number(await data(page, "slowmo-progress"));
    await expect.poll(async () => Number(await data(page, "slowmo-progress"))).toBeGreaterThan(replayAt);
    expect(Number(await data(page, "sim-time"))).toBe(frozen);
    await page.getByTestId("trace-card-close").click();
    await expect(play(page)).toHaveAttribute("data-state", "playing");
    await expect.poll(async () => Number(await data(page, "sim-time"))).toBeGreaterThan(frozen);
    expectNoErrors(consoleErrors);
  });

  for (const zoomed of [false, true])
    test(`Esc restores the pre-replay viewport (${zoomed ? "zoomed by hand" : "fitted"})`, async ({
      page,
      consoleErrors,
    }) => {
      test.fixme(
        process.platform === "win32" && !zoomed,
        "Nightly native teardown: docs/backlog/2026-10-18-nightly-native-load.md",
      );
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
      await waitForCameraIdle(page);
      if (zoomed) {
        await page.getByTestId("canvas-wrap").focus();
        await page.keyboard.press("Shift+Digit0");
        await waitForCameraIdle(page);
      }
      const before = view(await viewportTransform(page));
      await openNodeMenu(page, "payments", "sim.slowmo-from");
      await expect(canvas(page)).toHaveAttribute("data-slowmo", /.+/);
      // The take's camera has moved the view before we leave.
      await expect.poll(async () => view(await viewportTransform(page))).not.toEqual(before);
      await page.keyboard.press("Escape");
      await expect(canvas(page)).not.toHaveAttribute("data-slowmo", /.*/);
      await waitForCameraIdle(page);
      const after = view(await viewportTransform(page));
      expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
      expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
      expect(Math.abs(after.zoom - before.zoom)).toBeLessThan(0.001);
      expectNoErrors(consoleErrors);
    });

  test("Trace a message ▸ and the command palette start it; Record video offers this slow motion", async ({
    page,
    consoleErrors,
  }) => {
    test.fixme(process.platform === "win32", "Nightly native teardown: docs/backlog/2026-10-18-nightly-native-load.md");
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=2`);
    await openCanvasSubmenu(page, "sim.trace-message", "sim.trace-message:slowmo");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "playing");

    // The palette loads on first use.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("command-input")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("command-input").fill("slow motion");
    await page.getByTestId("command-item-action:sim.trace-message:slowmo").click();
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");

    await page.getByTestId("live-more").click();
    await page.getByTestId("live-record").click();
    await expect(page.getByTestId("record-opt-slowmo")).toBeChecked();
    await expect(page.getByTestId("record-opt-from-start")).toHaveCount(0);
    await page.getByTestId("record-cancel").click();
    expectNoErrors(consoleErrors);
  });

  test("with no traffic it waits for the message, then starts on Send one now", async ({ page, consoleErrors }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await openNodeMenu(page, "shopper", "sim.slowmo-from");
    await expect(page.getByTestId("trace-waiting")).toContainText("slow motion starts when it comes");
    await page.getByTestId("trace-send-one").focus();
    await page.keyboard.press("Enter");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await expect(page.getByTestId("slowmo-caption")).not.toBeEmpty();
    expectNoErrors(consoleErrors);
  });

  test("Esc leaves slow motion from its timeline, before presentation", async ({ page, consoleErrors }) => {
    await watchFromStorefront(page, "&present=1");
    const timeline = page.getByTestId("slowmo-timeline-input");
    await timeline.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "playing");
    await expect(canvas(page)).not.toHaveAttribute("data-slowmo", /.*/);
    await expect(page).toHaveURL(/present=1/);
    expectNoErrors(consoleErrors);
  });

  test("leaving live mid-replay takes slow motion's marks off the canvas", async ({ page, consoleErrors }) => {
    await watchFromStorefront(page);
    const marks = page.getByTestId("canvas-wrap").locator("[data-live-slowmo], [data-slowmo-off]");
    await expect.poll(() => marks.count()).toBeGreaterThan(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await expect(marks).toHaveCount(0);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(marks).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("reduced motion keeps the camera fixed across distant hops", async ({ page, consoleErrors }) => {
    // At this size the whole path is too small to read, so slow motion would follow it otherwise.
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await watchFromStorefront(page);
    await page.keyboard.press("Space");
    await expect(play(page)).toHaveAttribute("data-playing", "0");
    const where = async () =>
      Promise.all(
        ["shopper", "payment-db"].map(async (id) => {
          const b = await page.getByTestId(`node-${id}`).boundingBox();
          return b && [Math.round(b.x), Math.round(b.y), Math.round(b.width)];
        }),
      );
    // After the one fit (a jump under reduced motion), the view never changes.
    await waitForCameraIdle(page);
    const fitted = await where();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("ArrowRight");
      // A step at the last beat legitimately stays there. Let the key's React work commit,
      // then check the same geometry invariant at every beat, including the end.
      await animationFrames(page);
      await waitForCameraIdle(page);
      expect(await where()).toEqual(fitted);
    }
    expect(Number(await page.getByTestId("slowmo-timeline-input").inputValue())).toBeGreaterThan(300);
    expectNoErrors(consoleErrors);
  });

  test("reduced motion: still beats, no camera moves, same story", async ({ page, consoleErrors }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await watchFromStorefront(page);
    await expect
      .poll(async () => (await page.getByTestId("slowmo-caption").textContent()) ?? "", {
        timeout: 15_000,
        intervals: [100],
      })
      .toMatch(/^Commerce gateway/);
    expect(Number(await data(page, "slowmo-dots"))).toBeLessThanOrEqual(4);
    expectNoErrors(consoleErrors);
  });

  test("the new UI has no accessibility violations", async ({ page }) => {
    await watchFromStorefront(page);
    await page.keyboard.press("Space");
    for (const scope of ["live-controls", "trace-card"]) {
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .include(`[data-testid="${scope}"]`)
        .analyze();
      expect(violations.map((v) => `${scope}: ${v.id} ${v.help}`)).toEqual([]);
    }
  });
});

/** A granted share prompt (a canvas stream) and a recorder that hands back a small WebM blob. */
async function stubCapture(page: Page) {
  await page.addInitScript(() => {
    const c = document.createElement("canvas");
    navigator.mediaDevices.getDisplayMedia = async () => {
      const stream = c.captureStream(30);
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & { restrictTo?: () => Promise<void> };
      track.restrictTo = async () => {};
      return stream;
    };
    (window as unknown as Record<string, unknown>).RestrictionTarget = { fromElement: async (el: Element) => ({ el }) };
    // Where slow motion's replay was (0–1000) when the recorder started and stopped.
    const progress = () =>
      document.querySelector('[data-testid="live-canvas"]')?.getAttribute("data-slowmo-progress") ?? null;
    const marks: Record<string, string | null> = {};
    (window as unknown as Record<string, unknown>).recordedAt = marks;
    class FakeRecorder extends EventTarget {
      state: RecordingState = "inactive";
      mimeType = "video/webm";
      static isTypeSupported = (mime: string) => mime.startsWith("video/webm");
      start() {
        this.state = "recording";
        marks.start = progress();
      }
      stop() {
        if (this.state === "inactive") return;
        marks.stop = progress();
        this.state = "inactive";
        const data = new Blob([new Uint8Array(4_000)], { type: this.mimeType });
        setTimeout(() => {
          this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
          this.dispatchEvent(new Event("stop"));
        }, 30);
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
  });
}

test("Record this slow motion plays it from the start and stops at its end", async ({ page, consoleErrors }) => {
  test.slow();
  await stubCapture(page);
  await watchFromStorefront(page, "&speed=8");
  await page.getByTestId("live-speed").selectOption("8");
  // Paused on a hop in the middle: the take still starts from the first beat.
  await page.keyboard.press("Space");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await data(page, "slowmo-progress"))).toBeGreaterThan(0);
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-record").click();
  await expect(page.getByTestId("record-opt-slowmo")).toBeChecked();
  await page.getByTestId("record-start").click();
  await expect(page.getByTestId("record-indicator")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByTestId("record-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("record-review")).toContainText("orderrequest-slow-motion.webm");
  // The take ends on the replay's last beat; slow motion is still on, at its end.
  await expect(page.getByTestId("live-clock")).toHaveAttribute("data-mode", "slowmo");
  const at = await page.evaluate(() => (window as unknown as { recordedAt: Record<string, string | null> }).recordedAt);
  expect(at).toEqual({ start: "0", stop: "1000" });
  expectNoErrors(consoleErrors);
});

test.describe("calmer slow speeds", () => {
  test("0.25× draws a calm sample of whole journeys; counts stay exact", async ({ page, consoleErrors }) => {
    test.slow();
    await page.clock.install();
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await pauseClock(page);
    const sample = async () => {
      const out: number[] = [];
      for (let i = 0; i < 12; i++) {
        await page.clock.runFor(250);
        out.push(Number(await data(page, "particles")));
      }
      return out.reduce((a, b) => a + b, 0) / out.length;
    };
    await page.clock.runFor(1500);
    await expect.poll(async () => Number(await data(page, "particles"))).toBeGreaterThan(60);
    const full = await sample();
    expect(full).toBeGreaterThan(70);
    await page.getByTestId("live-speed").selectOption("0.25");
    await page.clock.runFor(2500);
    const calm = await sample();
    expect(calm).toBeLessThan(50);
    expect(calm).toBeGreaterThan(8);
    // The counter still counts every message in flight.
    expect(Number(await page.getByTestId("live-in-system").getAttribute("data-count"))).toBeGreaterThan(full * 0.8);
    expectNoErrors(consoleErrors);
  });
});
