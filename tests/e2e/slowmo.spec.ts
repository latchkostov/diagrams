import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors } from "./fixtures";

// Slow motion: one message's recorded journey, replayed node by node while live stays frozen; and
// calmer drawing below 1×. Selectors are data-testid only (axe takes [data-testid] CSS).

const KAFKA = "kafka-order-pipeline";
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
const canvas = (page: Page) => page.getByTestId("live-canvas");
const play = (page: Page) => page.getByTestId("live-play");
const clockMs = async (page: Page) => Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
const data = async (page: Page, name: string) => canvas(page).getAttribute(`data-${name}`);

async function openNodeMenu(page: Page, nodeId: string, actionId: string) {
  // A refit can dismiss a menu between opening it and choosing an action.
  await expect(async () => {
    await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
    await menuItem(page, actionId).click({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

async function openCanvasSubmenu(page: Page, parent: string, child: string) {
  await expect(async () => {
    const box = await page.getByTestId("canvas-wrap").boundingBox();
    if (!box) throw new Error("No canvas");
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: box.width / 2, y: 90 } });
    await menuItem(page, parent).click({ timeout: 1000 });
    await menuItem(page, child).click({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

/** Kafka in free play with traffic flowing, then slow motion from the Storefront. */
async function watchFromStorefront(page: Page, query = "") {
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1${query}`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  // Let traffic build up so there's a busy background to freeze.
  await expect.poll(async () => Number(await data(page, "particles")), { timeout: 10_000 }).toBeGreaterThan(40);
  await openNodeMenu(page, "shopper", "sim.slowmo-from");
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
    await watchFromStorefront(page);
    await play(page).click();
    await page.waitForTimeout(800);
    await page.getByTestId("node-payments").click({ button: "right" });
    for (const id of ["sim.kill", "sim.inject", "sim.storm"]) {
      await expect(menuItem(page, id)).toHaveAttribute("aria-disabled", "true");
      await expect(menuItem(page, id)).toContainText("Exit slow motion (Esc) first");
    }
    await expect(menuItem(page, "sim.trace-next")).not.toHaveAttribute("aria-disabled", "true");
    await menuItem(page, "sim.behaviour").click();
    await expect(menuItem(page, "sim.pause")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "sim.failure")).toContainText("Exit slow motion (Esc) first");
    await expect(menuItem(page, "sim.events")).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await page.getByTestId("node-payments").click();
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-input").fill("Kill");
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
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&sim=black-friday&paused=1`);
    await page.getByTestId("live-capacity").click();
    await page.getByTestId("capacity-traffic-mult").fill("14");
    await expect(page.getByTestId("bottleneck-apply")).toBeEnabled();
    await openNodeMenu(page, "shopper", "sim.slowmo-from");
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
    await watchFromStorefront(page);
    await expect(page.getByTestId("slowmo-chip")).toContainText("live paused");
    await expect(page.getByTestId("live-clock")).toHaveAttribute("data-mode", "slowmo");
    const time = await data(page, "sim-time");
    const sum = await data(page, "particle-sum");
    const moving: number[] = [];
    const captions = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      moving.push(Number(await data(page, "slowmo-dots")));
      captions.add((await page.getByTestId("slowmo-caption").textContent()) ?? "");
      // Live is frozen: the clock and every background dot stay exactly where they were.
      expect(await data(page, "sim-time")).toBe(time);
      expect(await data(page, "particle-sum")).toBe(sum);
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
    await page.waitForTimeout(400);
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
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect.poll(async () => Number(await data(page, "particles")), { timeout: 10_000 }).toBeGreaterThan(20);
    await play(page).click();
    await expect(play(page)).toHaveAttribute("data-state", "paused");
    await page.waitForTimeout(300);
    const time = await data(page, "sim-time");
    const sum = await data(page, "particle-sum");
    await openNodeMenu(page, "payments", "sim.slowmo-from");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "paused");
    await expect(canvas(page)).not.toHaveAttribute("data-slowmo", /.*/);
    await page.waitForTimeout(300);
    expect(await data(page, "sim-time")).toBe(time);
    expect(await data(page, "particle-sum")).toBe(sum);
    // The trace stays on: live at real speed shows the same message.
    await expect(page.getByTestId("trace-card")).toBeVisible();

    // Playing before: playing again after, from the same moment.
    await play(page).click();
    await expect(play(page)).toHaveAttribute("data-state", "playing");
    await page.getByTestId("trace-slowmo").click();
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await page.waitForTimeout(300);
    const frozen = Number(await data(page, "sim-time"));
    await page.waitForTimeout(800);
    expect(Number(await data(page, "sim-time"))).toBe(frozen);
    await page.getByTestId("trace-card-close").click();
    await expect(play(page)).toHaveAttribute("data-state", "playing");
    await expect.poll(async () => Number(await data(page, "sim-time"))).toBeGreaterThan(frozen);
    expectNoErrors(consoleErrors);
  });

  test("Trace a message ▸ and the command palette start it; Record video offers this slow motion", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&speed=2`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await openCanvasSubmenu(page, "sim.trace-message", "sim.trace-message:slowmo");
    await expect(play(page)).toHaveAttribute("data-state", "slowmo");
    await page.keyboard.press("Escape");
    await expect(play(page)).toHaveAttribute("data-state", "playing");

    // The palette loads on first use.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
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
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await openNodeMenu(page, "shopper", "sim.slowmo-from");
    await expect(page.getByTestId("trace-waiting")).toContainText("slow motion starts when it comes");
    await page.getByTestId("trace-send-one").click();
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
    await page.waitForTimeout(600);
    const fitted = await where();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(150);
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
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    const sample = async () => {
      const out: number[] = [];
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(250);
        out.push(Number(await data(page, "particles")));
      }
      return out.reduce((a, b) => a + b, 0) / out.length;
    };
    await expect.poll(async () => Number(await data(page, "particles")), { timeout: 10_000 }).toBeGreaterThan(60);
    await page.waitForTimeout(1500);
    const full = await sample();
    expect(full).toBeGreaterThan(70);
    await page.getByTestId("live-speed").selectOption("0.25");
    await page.waitForTimeout(2500);
    const calm = await sample();
    expect(calm).toBeLessThan(50);
    expect(calm).toBeGreaterThan(8);
    // The counter still counts every message in flight.
    expect(Number(await page.getByTestId("live-in-system").getAttribute("data-count"))).toBeGreaterThan(full * 0.8);
    expectNoErrors(consoleErrors);
  });
});
