import { readFileSync } from "node:fs";
import { textFieldsFixture } from "../../src/lab/textFieldsFixture";
import { encodeShare } from "../../src/interop/share";
import { expectFittedIdentity, zoomIdentity } from "./node-identity";
import { chunk, holdChunk } from "./chunk";
import type { Page } from "@playwright/test";
import {
  test,
  STORAGE_KEYS,
  expect,
  gotoCanvas,
  gotoLive,
  expectNoErrors,
  pauseClock,
  viewportTransform,
  waitForStableViewport,
  waitForCameraIdle,
  cameraJournalMark,
  cameraMoves,
  interactionJournalMark,
  liveKeyLevels,
} from "./fixtures";

// Presenting, full screen: the button beside Exit presentation, F, the browser's own exit, and Esc's order.
// Headless Chromium has the Fullscreen API; the state is read from document.fullscreenElement.

const KAFKA = "kafka-order-pipeline";

for (const view of ["presentation", "embed"])
  test(`${view} retains the narrow icon title's identity at 24% and 15%`, async ({ page }) => {
    const diagram = textFieldsFixture;
    await page.addInitScript(
      ({ key, diagram }) => {
        localStorage.setItem("diagrams.settings.v1", JSON.stringify({ nodeVariant: "iconOnly" }));
        localStorage.setItem(key, JSON.stringify(diagram));
      },
      { key: STORAGE_KEYS.autosavePrefix + KAFKA, diagram },
    );
    if (view === "presentation") {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
    } else {
      // Link embeds resolve their payload independently of editor autosaves.
      const token = await encodeShare(diagram);
      await page.goto(`./?embed=1#d=${token}`);
      await expect(page.getByTestId("node-c")).toBeVisible();
    }
    await zoomIdentity(page);
    await expectFittedIdentity(page, "c", "Worker");
    await zoomIdentity(page, 0.15);
    await expectFittedIdentity(page, "c", "Worker");
    await expect(page.getByTestId("node-c").getByTestId("card-title")).toHaveText("W");
  });

for (const view of ["presentation", "embed"])
  test(`read-only views preserve identity size and containment at low zoom (${view})`, async ({ page }) => {
    const diagram = textFieldsFixture;
    await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
      key: STORAGE_KEYS.autosavePrefix + KAFKA,
      diagram,
    });
    if (view === "presentation") {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
    } else {
      const token = await encodeShare(diagram);
      await page.goto(`./?embed=1#d=${token}`);
      await expect(page.getByTestId("node-a")).toBeVisible();
    }
    await zoomIdentity(page, 1);
    // At natural size the second line is part of the card.
    await expect(page.getByTestId("node-a").getByTestId("card-second-line")).toBeVisible();
    for (const target of [0.24, 0.15]) {
      await zoomIdentity(page, target);
      for (const node of diagram.nodes) await expectFittedIdentity(page, node.id, node.label);
      // Below the far zoom the enlarged title takes the card; secondary text keeps the editor's floor.
      for (const node of diagram.nodes)
        await expect(page.getByTestId(`node-${node.id}`).getByTestId("card-second-line")).toBeHidden();
    }
  });

/** The saved SVG, canonicalized, plus the painted title and icon sizes inside it. */
async function presentedSvg(page: Page) {
  return page.evaluate(async () => {
    const image = (await import("/src/interop/image.ts" as string)) as typeof import("../../src/interop/image");
    const text = await (await image.renderDiagramImage("svg")).text();
    const names = new Map<string, string>();
    const canonical = text.replace(/\bu[0-9a-z]{4}\d+\b/g, (name) => {
      if (!names.has(name)) names.set(name, `pseudo${names.size}`);
      return names.get(name) ?? name;
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const svg = new DOMParser().parseFromString(text, "image/svg+xml");
    const size = (selector: string, pattern: RegExp) =>
      [...svg.querySelectorAll<SVGElement | HTMLElement>(selector)].map(
        (el) => (el.getAttribute("style") ?? "").match(pattern)?.[1],
      );
    return {
      digest: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      // The clone writes the title's size inside the `font` shorthand: "font: 620 13px / 16.875px …".
      titles: size('[data-testid="card-title"]', /(?:^|;)\s*font: [^;]*?([\d.]+)px \//),
      icons: size('[data-testid="card-icon"] > *', /(?:^|;)\s*height: ([\d.]+)px/),
      seconds: size('[data-testid="card-second-line"]', /(?:^|;)\s*visibility: ([^;]+)/),
    };
  });
}

test("presentation image exports capture natural identity at any zoom @dev", async ({ page }) => {
  await gotoCanvas(page, KAFKA);
  await zoomIdentity(page, 1);
  const editor = await presentedSvg(page);
  // At 100% the editor's export is the natural drawing (what the parity goldens pin).
  expect(editor.titles.length).toBeGreaterThan(0);
  for (const size of editor.titles) expect(Number(size)).toBeLessThanOrEqual(13.5);
  for (const size of editor.icons) expect(Number(size)).toBeLessThanOrEqual(34);
  expect(new Set(editor.seconds)).toEqual(new Set(["visible"]));
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await zoomIdentity(page, 1);
  const natural = await presentedSvg(page);
  // Presentation's own chrome styles may differ from the editor's; its identity sizes may not.
  expect({ ...natural, digest: "" }).toEqual({ ...editor, digest: "" });
  for (const target of [0.35, 0.24]) {
    await zoomIdentity(page, target);
    // The whole image, byte for byte, is independent of the presentation zoom.
    expect({ ...(await presentedSvg(page)), target }).toEqual({ ...natural, target });
  }
});

test("a low-zoom image export captures natural identity while the frame-detail chunk is held", async ({
  page,
}, info) => {
  test.slow(); // rendering + font embedding is CPU-bound
  const held = await holdChunk(page, chunk("FrameDetail", "src/canvas/FrameDetail.tsx"));
  await gotoCanvas(page, KAFKA);
  await expect.poll(held.requested).toBe(true);
  await zoomIdentity(page, 0.24);
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-menu")).toBeVisible();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-image").click();
  await page.getByTestId("image-options-toggle").click();
  await page.getByTestId("image-format-svg").click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45_000 }),
    page.getByTestId("image-export").click(),
  ]);
  const file = info.outputPath("held.svg");
  await download.saveAs(file);
  // The clone writes each title's size in its `font` shorthand: "font: 620 13.5px / 16.875px …".
  const titles = [
    ...readFileSync(file, "utf8").matchAll(/data-testid="card-title"[^>]*?style="[^"]*?font: [^;]*?([\d.]+)px \//g),
  ].map((m) => Number(m[1]));
  expect(titles.length).toBeGreaterThan(0);
  // At 24% the on-screen floor is 9.5 / 0.24 ≈ 40 px; the picture keeps the natural size.
  for (const size of titles) expect(size).toBeLessThanOrEqual(13.5);
  held.release();
});

const fullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement === document.documentElement);

/** Nodes of the diagram that aren't wholly inside the canvas. */
const clipped = (page: Page) =>
  page.getByTestId("canvas-wrap").evaluate((wrap) => {
    const pane = wrap.getBoundingClientRect();
    return [...wrap.querySelectorAll<HTMLElement>(".react-flow__node")]
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.left < pane.left || r.top < pane.top || r.right > pane.right || r.bottom > pane.bottom;
      })
      .map((n) => n.dataset.id);
  });

/** Esc delivered to the page (at the focused element), as a browser that doesn't take it for full screen would. */
const escToPage = (page: Page) =>
  page.evaluate(() =>
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
    ),
  );

async function present(page: Page) {
  await gotoCanvas(page, KAFKA);
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("present-exit")).toBeVisible();
}

test.describe("presenting full screen", () => {
  test("the button enters and leaves full screen, and says which it does", async ({ page, consoleErrors }) => {
    await present(page);
    const button = page.getByTestId("present-fullscreen");
    await expect(button).toHaveAccessibleName("Full screen");
    await expect(button).toHaveAttribute("aria-keyshortcuts", "F");
    expect(await fullscreen(page)).toBe(false);

    await button.click();
    await expect.poll(() => fullscreen(page)).toBe(true);
    await expect(button).toHaveAccessibleName("Exit full screen");
    await expect(button).toHaveAttribute("data-state", "on");
    // Still presenting, with the diagram on screen.
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("node-shopper")).toBeInViewport();

    await button.click();
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect(button).toHaveAccessibleName("Full screen");
    await expect(page.getByTestId("present-exit")).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("F toggles it, only while presenting", async ({ page }) => {
    await gotoCanvas(page, KAFKA);
    // Editing: F is no shortcut, and there's no button.
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("f");
    // A key after it that does something: by the time it has, an F that went full screen would have too.
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-dialog")).toContainText("Presenting: full screen, or back");
    expect(await fullscreen(page)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-dialog")).toHaveCount(0);
    await expect(page.getByTestId("present-fullscreen")).toHaveCount(0);

    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    await expect(page.getByTestId("present-fullscreen")).toHaveAttribute("data-state", "on");
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect(page.getByTestId("present-fullscreen")).toHaveAttribute("data-state", "off");
  });

  test("the button follows a full screen left outside it", async ({ page }) => {
    await present(page);
    const button = page.getByTestId("present-fullscreen");
    await button.click();
    await expect(button).toHaveAttribute("data-state", "on");
    // As the browser's own exit does (F11, its "Exit full screen" bar): the page didn't ask through the button.
    await page.evaluate(() => document.exitFullscreen());
    await expect(button).toHaveAttribute("data-state", "off");
    await expect(button).toHaveAccessibleName("Full screen");
    await expect(page.getByTestId("present-exit")).toBeVisible();
  });

  test("Esc leaves full screen first, and only the next Esc leaves the presentation", async ({ page }) => {
    await present(page);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect(page.getByTestId("present-fullscreen")).toHaveAttribute("data-state", "off");
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page).toHaveURL(/present=1/);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page).not.toHaveURL(/present=1/);
  });

  test("leaving the presentation leaves full screen", async ({ page }) => {
    await present(page);
    await page.getByTestId("present-fullscreen").click();
    await expect.poll(() => fullscreen(page)).toBe(true);
    await page.getByTestId("present-exit").click();
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect.poll(() => fullscreen(page)).toBe(false);

    // And by going back in history, which leaves the presentation without a click.
    await page.getByTestId("present-toggle").click();
    await page.getByTestId("present-fullscreen").click();
    await expect.poll(() => fullscreen(page)).toBe(true);
    await page.goBack();
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect.poll(() => fullscreen(page)).toBe(false);
  });

  test("live view keeps running full screen", async ({ page }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&present=1`);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    await expect(page.getByTestId("live-controls")).toBeVisible();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
    const processed = async () => Number(await page.getByTestId("node-badge-orders").getAttribute("data-processed"));
    const before = await processed();
    await expect.poll(processed, { timeout: 10_000 }).toBeGreaterThan(before);
  });

  test("no button, and F does nothing, where the browser can't go full screen", async ({ page }) => {
    // As in an iframe without allow="fullscreen", or iOS Safari.
    await page.addInitScript(() =>
      Object.defineProperty(Document.prototype, "fullscreenEnabled", { configurable: true, get: () => false }),
    );
    await present(page);
    await expect(page.getByTestId("present-fullscreen")).toHaveCount(0);
    // (Chromium would still go full screen if asked: an F that asked would make the Esc below leave full screen
    // instead of the presentation.)
    await page.keyboard.press("f");
    // Esc still leaves the presentation in one press.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("topbar")).toBeVisible();
    expect(await fullscreen(page)).toBe(false);
  });
  // Headless Chromium mostly takes Esc itself while full screen, as browsers do, but not always (just after going full
  // screen it can reach the page). These send Esc to the page as a browser that passes it on would, every time.
  test("an Esc the browser passes on leaves full screen only, even when slow motion started first", async ({
    page,
  }) => {
    // Slow motion's Esc listener was added before the presentation's.
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await waitForCameraIdle(page);
    await page.getByTestId("node-shopper").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.slowmo-from").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);

    const keys = await interactionJournalMark(page);
    await escToPage(page);
    await expect.poll(() => fullscreen(page)).toBe(false);
    // Full screen is ahead of live view's chain: no live level heard this Esc.
    expect(await liveKeyLevels(page, keys)).toEqual([]);
    // Only full screen: still in slow motion, still presenting.
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
    await expect(page.getByTestId("present-exit")).toBeVisible();
    // The next Esc is slow motion's.
    await escToPage(page);
    await expect(page.getByTestId("live-play")).not.toHaveAttribute("data-state", "slowmo");
    await expect(page.getByTestId("present-exit")).toBeVisible();
  });

  test("an Esc the browser passes on goes to full screen ahead of any layer listening from before", async ({
    page,
  }) => {
    await gotoCanvas(page, KAFKA);
    // A layer that mounted before the presentation and claims Esc on the window's capture phase (as slow motion,
    // the trace or a menu does): added first, it would run first, unless full screen is ahead of everything.
    await page.evaluate(() => {
      const w = window as Window & { __layerEsc?: number };
      w.__layerEsc = 0;
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== "Escape") return;
          w.__layerEsc = (w.__layerEsc ?? 0) + 1;
          e.stopImmediatePropagation();
        },
        true,
      );
    });
    const layerEsc = () => page.evaluate(() => (window as Window & { __layerEsc?: number }).__layerEsc);
    await page.getByTestId("present-toggle").click();
    await page.getByTestId("node-shopper").click();
    await expect(page.getByTestId("rf__node-shopper")).toHaveClass(/\bselected\b/);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    await escToPage(page);
    await expect.poll(() => fullscreen(page)).toBe(false);
    expect(await layerEsc()).toBe(0);
    await expect(page.getByTestId("rf__node-shopper")).toHaveClass(/\bselected\b/);
    // The next Esc is the layer's.
    await escToPage(page);
    await expect.poll(layerEsc).toBe(1);
  });

  test("leaving live view during a presented replay fits the whole diagram, and full screen refits it", async ({
    page,
  }) => {
    await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1`);
    await waitForCameraIdle(page);
    await page.getByTestId("node-shopper").click({ button: "right" });
    await page.getByTestId("context-menu-item-sim.slowmo-from").click();
    await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "slowmo");
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-slowmo", /.+/);
    const mark = await cameraJournalMark(page);
    // L leaves live view mid-replay; the presentation stays.
    await page.keyboard.press("l");
    await expect(page.getByTestId("live-controls")).toHaveCount(0);
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await waitForCameraIdle(page);
    // The normal fit for the mode (panePolicy F4), not slow motion's close-up.
    expect(await cameraMoves(page, mark)).toContain("fit:mode");
    await expect.poll(() => clipped(page)).toEqual([]);
    const left = await cameraJournalMark(page);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    // The browser can publish fullscreenElement before delivering fullscreenchange to React.
    await expect
      .poll(async () => (await cameraMoves(page, left)).filter((m) => m.startsWith("fit") || m.startsWith("slowmo")))
      .toEqual(["fit:fullscreen"]);
    await waitForCameraIdle(page);
    // Slow motion gave the view back: full screen refits the fitted presentation (F2).
    const fits = (await cameraMoves(page, left)).filter((m) => m.startsWith("fit") || m.startsWith("slowmo"));
    expect(fits).toEqual(["fit:fullscreen"]);
  });

  test("going full screen and back refits a diagram shown whole to the pane", async ({ page }) => {
    // Headless Chromium keeps the window's size full screen (and won't resize a full-screen window), so the pane
    // is made smaller by hand, as full screen's opposite would: the refit on each change must fit it again.
    const squeeze = (size: string) =>
      page.addStyleTag({
        content: `[data-testid="canvas-view"] { width: ${size} !important; height: ${size} !important; }`,
      });
    await present(page);
    await waitForCameraIdle(page);
    expect(await clipped(page)).toEqual([]);
    const mark = await cameraJournalMark(page);
    await squeeze("70%");
    await expect.poll(() => clipped(page)).not.toEqual([]);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    // Fullscreen state and an unclipped intermediate animation frame can precede the refit's completion.
    await expect
      .poll(async () => (await cameraMoves(page, mark)).filter((m) => m === "fit:fullscreen"))
      .toEqual(["fit:fullscreen"]);
    await waitForCameraIdle(page);
    await expect.poll(() => clipped(page)).toEqual([]);

    await squeeze("50%");
    await expect.poll(() => clipped(page)).not.toEqual([]);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(false);
    await expect
      .poll(async () => (await cameraMoves(page, mark)).filter((m) => m === "fit:fullscreen"))
      .toEqual(["fit:fullscreen", "fit:fullscreen"]);
    await waitForCameraIdle(page);
    await expect.poll(() => clipped(page)).toEqual([]);
    // Each change refit the fitted presentation (panePolicy F2).
    const refits = (await cameraMoves(page, mark)).filter((m) => m === "fit:fullscreen");
    expect(refits).toEqual(["fit:fullscreen", "fit:fullscreen"]);
  });

  test("going full screen and back keeps a view the presenter zoomed", async ({ page }) => {
    await page.clock.install();
    await present(page);
    await waitForCameraIdle(page);
    const box = await page.getByTestId("canvas-wrap").boundingBox();
    if (!box) throw new Error("No canvas");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Literal Control: a trackpad pinch emits ctrl+wheel on every OS.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    await waitForStableViewport(page);
    const zoomed = await viewportTransform(page);
    const mark = await cameraJournalMark(page);

    // Time stands still from here, then runs well past the refit's delay and its animation.
    await pauseClock(page);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(true);
    await page.clock.runFor(2000);
    expect(await viewportTransform(page)).toBe(zoomed);
    await page.keyboard.press("f");
    await expect.poll(() => fullscreen(page)).toBe(false);
    await page.clock.runFor(2000);
    expect(await viewportTransform(page)).toBe(zoomed);
    // The presenter zoomed by hand: full screen never refits it (panePolicy F2).
    expect(await cameraMoves(page, mark)).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const)
    test(`the bar reads at rest (${theme}): the icon at 3:1, Exit presentation at 4.5:1`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await present(page);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      // The pointer away from both, so neither is hovered; composited over the canvas as drawn.
      await page.mouse.move(10, 400);
      const measure = () =>
        page.getByTestId("canvas-wrap").evaluate((wrap) => {
          const ctx = document.createElement("canvas").getContext("2d");
          if (!ctx) throw new Error("Missing color context");
          const rgb = (color: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
          };
          const luminance = (c: number[]) =>
            c
              .map((v) => {
                const x = v / 255;
                return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
              })
              .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
          const ratio = (a: number[], b: number[]) => {
            const [x, y] = [luminance(a), luminance(b)];
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          const bg = rgb(getComputedStyle(wrap).getPropertyValue("--bg"));
          return ["present-fullscreen", "present-exit"].map((id) => {
            const el = wrap.querySelector<HTMLElement>(`[data-testid="${id}"]`);
            if (!el) return { id, ratio: 0 };
            let opacity = 1;
            for (let p: Element | null = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
            const style = getComputedStyle(el);
            const over = (c: number[]) => c.map((v, i) => v * opacity + bg[i] * (1 - opacity));
            const face = over(rgb(style.backgroundColor));
            return { id, ratio: ratio(over(rgb(style.color)), face) };
          });
        });
      await expect
        .poll(async () =>
          (await measure())
            .filter((m) => m.ratio < (m.id === "present-exit" ? 4.5 : 3))
            .map((m) => `${m.id} at ${m.ratio.toFixed(2)}:1`),
        )
        .toEqual([]);
    });
});

test("presenting hides the selected line's segment handles", async ({ page }) => {
  const diagram = JSON.parse(readFileSync("tests/parity/corpus/hand-shaped-lines.diagram.json", "utf8"));
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEYS.autosavePrefix + KAFKA, JSON.stringify(diagram)],
  );
  await gotoCanvas(page, KAFKA);
  await waitForStableViewport(page);
  await page.getByTestId("edge-label-api-db").click();
  await expect(page.getByTestId("route-segment-api-db-1")).toBeVisible();
  await page.getByTestId("present-toggle").click();
  await expect(page.getByTestId("present-exit")).toBeVisible();
  await expect(page.getByTestId(/^route-segment-/)).toHaveCount(0);
});
