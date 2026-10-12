import type { Page } from "@playwright/test";
import { perfBudget } from "../../src/test/perfBudget";
import { test, expect, expectNoErrors, livePaint } from "./fixtures";

// The live view draws its particles, the overlay above the edge label pills, the marching edges and
// the Live dot's breath in a worker, on OffscreenCanvas (src/live/liveRenderer.ts); where that isn't
// available the same drawing code runs on the main thread. Every behaviour here is checked on both
// paths: `?renderer=main` forces the fallback. A worker's canvas can't be read from the page, so
// pixels come through the renderer's test hook (`livePaint`). Selectors are data-testid only.

const KAFKA = "kafka-order-pipeline";
const PILL = "shopper-to-gateway"; // "HTTPS": the entry edge, always busy
const canvas = (page: Page) => page.getByTestId("live-canvas");
const count = async (page: Page, name: string) => Number(await canvas(page).getAttribute(`data-${name}`));
const menuItem = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);

type Renderer = "worker" | "main";

async function goLive(page: Page, renderer: Renderer, query = "") {
  await page.goto(`./?view=canvas&example=${KAFKA}&live=1${renderer === "main" ? "&renderer=main" : ""}${query}`);
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(canvas(page)).toHaveAttribute("data-renderer", renderer);
}

async function openNodeMenu(page: Page, nodeId: string, actionId: string) {
  await expect(async () => {
    await page.getByTestId(`node-${nodeId}`).click({ button: "right" });
    await menuItem(page, actionId).click({ timeout: 1000 });
  }).toPass({ timeout: 8000 });
}

/** A layer's pixels in a client rect (the whole pane by default), summed up in the page: the highest alpha and a checksum. */
async function pixels(
  page: Page,
  layer: "base" | "over" | "march",
  rect?: { x: number; y: number; width: number; height: number },
) {
  return page.evaluate(
    async ([layer, rect]) => {
      const el = document.querySelector('[data-testid="live-canvas"]');
      const probe = window.__liveProbe;
      if (!el || !probe) throw new Error("live view isn't on, or this build has no test hooks");
      const pane = el.getBoundingClientRect();
      const { data } = await probe(
        layer,
        rect ?? { x: pane.left, y: pane.top, width: pane.width, height: pane.height },
      );
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum = (sum * 31 + data[i]) % 1_000_000_007;
        if (i % 4 === 3) peak = Math.max(peak, data[i]);
      }
      return { peak, sum, length: data.length };
    },
    [layer, rect ?? null] as const,
  );
}

type Box = { x: number; y: number; w: number; h: number };

/** A label rect from the canvas's test hooks (pane px) → client px. */
async function clientRect(page: Page, r: Box) {
  const pane = await canvas(page).boundingBox();
  if (!pane) throw new Error("no canvas");
  return { x: pane.x + r.x, y: pane.y + r.y, width: r.w, height: r.h };
}

for (const renderer of ["worker", "main"] as const) {
  test.describe(`live rendering, ${renderer} path`, () => {
    test("draws particles frame after frame, and the busy edges march on their canvas", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(20);
      expect(await livePaint(page, "base")).toBeGreaterThan(200);
      const frames = await count(page, "frames");
      await expect.poll(() => count(page, "frames")).toBeGreaterThan(frames + 10);
      // The SVG's own march steps aside for the canvas, which draws the dashes.
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-march", "canvas");
      expect(await livePaint(page, "march")).toBeGreaterThan(200);

      // Paused, everything stands still once the last arrival pulses fade (0.7 s at most): no new
      // frames, and the march keeps its place.
      await page.getByTestId("live-play").click();
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-still", "1");
      let still = -1;
      await expect
        .poll(
          async () => {
            const now = await count(page, "frames");
            const same = now === still;
            still = now;
            return same;
          },
          { intervals: [900], timeout: 8000 },
        )
        .toBe(true);
      const ants = await pixels(page, "march");
      await page.waitForTimeout(700);
      expect(await count(page, "frames")).toBe(still);
      expect(await pixels(page, "march")).toEqual(ants);
      expectNoErrors(consoleErrors);
    });

    test("a dot passing behind an edge label pill is drawn dimmed above it", async ({ page, consoleErrors }) => {
      await goLive(page, renderer);
      // The overlay has paint inside the pill only while a dot passes, and never at full strength.
      // (The pill is re-read each time: the view may still be fitting.)
      let peak = 0;
      await expect
        .poll(
          async () => {
            const pill = await page.getByTestId(`edge-label-${PILL}`).boundingBox();
            if (pill) peak = Math.max(peak, (await pixels(page, "over", pill)).peak);
            return peak;
          },
          { timeout: 10_000, intervals: [50] },
        )
        .toBeGreaterThan(20);
      expect(peak).toBeLessThan(200);
      expectNoErrors(consoleErrors);
    });

    test("a traced message's label is drawn above the pills where the hooks place it", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer, "&traffic=0&speed=0.5");
      await page.waitForTimeout(1200);
      await openNodeMenu(page, "shopper", "sim.trace-next");
      await page.getByTestId("trace-send-one").click();
      await expect
        .poll(async () => (await canvas(page).getAttribute("data-trace-labels")) ?? "", { timeout: 10_000 })
        .not.toBe("");
      // Pause so the label stays put, then find its pill on the overlay where the hook says it is (the
      // hook is refreshed at the UI clock, so give it a beat).
      await page.getByTestId("live-play").click();
      await expect
        .poll(
          async () => {
            const [label] = JSON.parse((await canvas(page).getAttribute("data-trace-labels")) ?? "[]") as Box[];
            return label ? livePaint(page, "over", await clientRect(page, label)) : 0;
          },
          { timeout: 5000 },
        )
        .toBeGreaterThan(30);
      expectNoErrors(consoleErrors);
    });

    test("slow motion draws its dots and captions above the pills, over the frozen live view", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
      await openNodeMenu(page, "shopper", "sim.slowmo-from");
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "playing");
      await expect
        .poll(async () => JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]").length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
      // Pause the replay so the caption holds still, then find it on the overlay.
      await page.getByTestId("live-play").click();
      await expect(canvas(page)).toHaveAttribute("data-slowmo", "paused");
      await expect
        .poll(
          async () => {
            const [caption] = JSON.parse((await canvas(page).getAttribute("data-slowmo-captions")) ?? "[]") as Box[];
            return caption ? livePaint(page, "over", await clientRect(page, caption)) : 0;
          },
          { timeout: 5000 },
        )
        .toBeGreaterThan(30);
      // Live is frozen and faint underneath (the background dots and the lit edges).
      expect(await livePaint(page, "base", undefined, 5)).toBeGreaterThan(50);
      expectNoErrors(consoleErrors);
    });

    test("clicking a particle traces its message (hit targets from the drawn frame)", async ({
      page,
      consoleErrors,
    }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
      await page.getByTestId("live-play").click();
      await page.waitForTimeout(500);
      // A dot's opaque core, found on the particle layer, clear of node cards.
      const at = await page.evaluate(async () => {
        const el = document.querySelector('[data-testid="live-canvas"]');
        const probe = window.__liveProbe;
        if (!el || !probe) return null;
        const pane = el.getBoundingClientRect();
        const px = await probe("base", { x: pane.left, y: pane.top, width: pane.width, height: pane.height });
        const { data, width } = px;
        for (let i = 3; i < data.length; i += 4 * 7) {
          if (data[i] < 255) continue;
          const x = px.x + (((i - 3) / 4) % width) / px.scale;
          const y = px.y + Math.floor((i - 3) / 4 / width) / px.scale;
          const hit = document.elementFromPoint(x, y);
          if (hit && !hit.closest(".react-flow__node, button, [data-editor-overlay], .fe-label")) return { x, y };
        }
        return null;
      });
      if (!at) throw new Error("no opaque particle core on the canvas");
      await page.mouse.click(at.x, at.y);
      await expect(page.getByTestId("trace-card")).toBeVisible();
      expectNoErrors(consoleErrors);
    });

    test("a waiting note stops the march like pausing does (the sim clock stands still)", async ({
      page,
      consoleErrors,
    }) => {
      // Waiting, the controller still hands out fresh snapshots, at the same simulated time.
      await page.goto(
        `./?view=canvas&example=${KAFKA}&sim=payments-outage&speed=8${renderer === "main" ? "&renderer=main" : ""}`,
      );
      await expect(page.getByTestId("live-note-continue")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
      await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-still", "1");
      // The note's camera fit animates first; then the ants hold still (marching, they never would).
      let ants = await pixels(page, "march");
      await expect
        .poll(
          async () => {
            const now = await pixels(page, "march");
            const same = now.sum === ants.sum;
            ants = now;
            return same;
          },
          { intervals: [700], timeout: 8000 },
        )
        .toBe(true);
      expect(ants.peak).toBeGreaterThan(0);
      await page.getByTestId("live-note-continue").click();
      await expect(page.getByTestId("rf__wrapper")).not.toHaveAttribute("data-live-still", "1");
      expectNoErrors(consoleErrors);
    });

    test("0.25× draws a calm sample of the traffic", async ({ page, consoleErrors }) => {
      await goLive(page, renderer);
      await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(60);
      await page.getByTestId("live-speed").selectOption("0.25");
      await expect.poll(() => count(page, "particles"), { timeout: 8_000 }).toBeLessThan(50);
      expectNoErrors(consoleErrors);
    });
  });
}

/** Counts main-thread 2D canvas drawing calls (a worker's OffscreenCanvas contexts aren't these). */
const COUNT_DRAWS = `(() => {
  window.__draws = 0;
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of ["drawImage", "fill", "stroke", "clearRect", "fillRect", "fillText", "putImageData"]) {
    const original = proto[name];
    proto[name] = function (...args) {
      window.__draws++;
      return original.apply(this, args);
    };
  }
  window.__loaf = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push(e.duration); })
      .observe({ type: "long-animation-frame" });
  } catch {}
})();`;

declare global {
  interface Window {
    __draws: number;
    __loaf: number[];
  }
}

/** Main-thread draw calls, worker frames and long animation frames over `ms` of live traffic. */
async function busyWindow(page: Page, ms: number) {
  await page.evaluate(() => {
    window.__draws = 0;
    window.__loaf.length = 0;
  });
  const frames = await count(page, "frames");
  await page.waitForTimeout(ms);
  return {
    draws: await page.evaluate(() => window.__draws),
    frames: (await count(page, "frames")) - frames,
    longFrames: await page.evaluate(() => window.__loaf.reduce((a, b) => a + b, 0)),
    // Animations that would repaint (CSS) or recomposite (compositor) every frame while live: each
    // holds input a frame deeper (docs/BACKLOG.md). Transient transitions don't count.
    running: await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity)
        .map((a) => (a as CSSAnimation).animationName ?? "animation"),
    ),
  };
}

test.describe("live rendering stays off the main thread", () => {
  test("the worker path draws nothing on the main thread and runs no endless animation while live", async ({
    page,
    consoleErrors,
  }) => {
    await page.addInitScript(COUNT_DRAWS);
    await goLive(page, "worker");
    await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
    await expect(page.getByTestId("rf__wrapper")).toHaveAttribute("data-live-glow", "canvas");
    const playing = await busyWindow(page, 1500);
    expect(playing.frames, "the worker kept drawing").toBeGreaterThan(20);
    expect(playing.draws, "main-thread canvas calls per 1.5 s").toBe(0);
    expect(playing.running).toEqual([]);
    expect(playing.longFrames).toBeLessThan(perfBudget(150));

    // The fallback really is on the main thread: the same check counts its drawing.
    await goLive(page, "main");
    await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(40);
    const fallback = await busyWindow(page, 1000);
    expect(fallback.draws).toBeGreaterThan(fallback.frames);
    expectNoErrors(consoleErrors);
  });
});

/** The fallback took over on fresh canvases: particles and the march paint, the dot breathes in CSS. */
async function handedOver(page: Page) {
  await expect(page.getByTestId("live-controls")).toBeVisible();
  await expect(canvas(page)).toHaveAttribute("data-renderer", "main", { timeout: 15_000 });
  await expect.poll(() => count(page, "particles"), { timeout: 10_000 }).toBeGreaterThan(10);
  await expect.poll(() => livePaint(page, "base")).toBeGreaterThan(100);
  await expect.poll(() => livePaint(page, "march")).toBeGreaterThan(100);
  await expect(page.getByTestId("rf__wrapper")).not.toHaveAttribute("data-live-glow", "canvas");
}

test.describe("a particle worker that can't start hands over to the main thread", () => {
  test("its script never arrives (an error event)", async ({ page }) => {
    // A proxy, a CSP on worker-src, a broken deploy.
    await page.route(/particleWorker/, (route) => route.abort());
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
    await handedOver(page);
  });

  test("its constructor throws (a CSP, disabled workers, Trusted Types)", async ({ page, consoleErrors }) => {
    // The capability check still passes (it constructs nothing); the particle worker itself throws.
    await page.addInitScript(() => {
      const Real = window.Worker;
      window.Worker = function (this: Worker, url: string | URL, options?: WorkerOptions) {
        if (String(url).includes("particleWorker")) throw new DOMException("Blocked by policy", "SecurityError");
        return new Real(url, options);
      } as unknown as typeof Worker;
    });
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
    await handedOver(page);
    expectNoErrors(consoleErrors);
  });

  test("a canvas can't be transferred", async ({ page, consoleErrors }) => {
    await page.addInitScript(() => {
      HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
        throw new DOMException("Cannot transfer", "InvalidStateError");
      };
    });
    await page.goto(`./?view=canvas&example=${KAFKA}&live=1`);
    await handedOver(page);
    expectNoErrors(consoleErrors);
  });
});
