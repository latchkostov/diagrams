import recommendations from "../../src/examples/recommendations-feature-store.json" with { type: "json" };
import commerce from "../../src/examples/black-friday-commerce.json" with { type: "json" };
import delivery from "../../src/examples/delivery-dispatch.json" with { type: "json" };
import { test, expect, gotoCanvas, gotoLive, waitForCameraIdle, pauseClock } from "./fixtures";
import { zoomIdentity } from "./node-identity";
import type { Page } from "@playwright/test";

for (const [slug, diagram] of [
  ["recommendations-feature-store", recommendations],
  ["black-friday-commerce", commerce],
  ["delivery-dispatch", delivery],
] as const)
  for (const zoom of [0.4, 0.25])
    test(`chips are named, readable and overlap-free: ${slug} at ${zoom}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoCanvas(page, slug);
      await zoomIdentity(page, zoom);
      const root = page.getByTestId("canvas-wrap");
      await expect(root).toHaveAttribute("data-low-zoom", zoom < 0.3 ? "far" : "mid");
      await expect(page.getByTestId(/^connection-stroke-/)).toHaveCount(diagram.edges.length);
      const problems = await root.evaluate(
        (root, names) => {
          const boxes: { id: string; x: number; y: number; right: number; bottom: number }[] = [];
          const problems: string[] = [];
          for (const { id, label } of names) {
            const node = root.querySelector<HTMLElement>(`[data-testid="node-${id}"]`);
            const title = node?.querySelector<HTMLElement>('[data-testid="card-title"]');
            const icon = node?.querySelector<HTMLElement>('[data-testid="card-icon"]');
            const body = title?.parentElement;
            if (!node || !title || !icon || !body) throw new Error(`Missing identity: ${id}`);
            const text = title.textContent ?? "";
            const rect = body.getBoundingClientRect();
            const style = getComputedStyle(title);
            if (!text.trim() || text.includes("…") || style.textOverflow === "ellipsis")
              problems.push(`${id}: blank or ellipsis`);
            if (body.getAttribute("aria-label") !== label) problems.push(`${id}: missing full accessible name`);
            if (getComputedStyle(icon).visibility !== "visible" || !icon.getBoundingClientRect().height)
              problems.push(`${id}: hidden icon`);
            const scale = rect.width / body.offsetWidth;
            if (parseFloat(style.fontSize) * scale < 10.4) problems.push(`${id}: small name`);
            const ink = title.getBoundingClientRect();
            if (ink.left < rect.left || ink.right > rect.right + 1 || ink.bottom > rect.bottom + 1)
              problems.push(`${id}: clipped name`);
            boxes.push({ id, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
          }
          const overlap = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
            a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++)
              if (overlap(boxes[i], boxes[j])) problems.push(`${boxes[i].id} overlaps ${boxes[j].id}`);
          for (const title of root.querySelectorAll<HTMLElement>('[data-testid^="zone-focus-"]')) {
            const r = title.getBoundingClientRect();
            for (const box of boxes)
              if (
                overlap({ id: title.dataset.testid ?? "zone", x: r.x, y: r.y, right: r.right, bottom: r.bottom }, box)
              )
                problems.push(`${title.dataset.testid} covers ${box.id}`);
          }
          return problems;
        },
        diagram.nodes.map(({ id, label }) => ({ id, label })),
      );
      expect(problems).toEqual([]);
      if (slug === "recommendations-feature-store" && zoom === 0.4) {
        await page.keyboard.press("Shift+1");
        await waitForCameraIdle(page);
        await page.getByTestId("node-feature-server").hover();
        await expect(page.getByTestId("node-tooltip")).toContainText("Feature server");
        await expect(page.getByTestId("node-feature-server")).not.toHaveAttribute("title");
      }
    });

for (const platform of [undefined, "MacIntel"])
  test(`chips publish a tier only after zoom settles and reuse it through pan${platform ? ` (${platform})` : ""}`, async ({
    page,
  }) => {
    if (platform)
      await page.addInitScript((platform) => {
        // The app helper reads platform; React Flow's pinch gain reads userAgent.
        const userAgent = navigator.userAgent.replace(/\([^)]*\)/, "(Macintosh; Intel Mac OS X 10_15_7)");
        Object.defineProperty(navigator, "platform", { get: () => platform });
        Object.defineProperty(navigator, "userAgent", { get: () => userAgent });
      }, platform);
    await page.clock.install();
    await gotoCanvas(page, "recommendations-feature-store");
    await zoomIdentity(page, 0.65);
    await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-low-zoom");
    await pauseClock(page);
    const pane = page.getByTestId("canvas-pane");
    const root = page.getByTestId("canvas-wrap");
    const fits = await root.getAttribute("data-chip-fits");
    // Use the same relative pinch as zoomIdentity; macOS applies ten times the wheel gain.
    const pinchScale = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 0.1 : 1));
    for (const deltaY of [100, 20, 10]) {
      await pane.dispatchEvent("wheel", { deltaY: deltaY * pinchScale, ctrlKey: true, bubbles: true });
      await page.clock.runFor(16);
      await expect(root).toHaveAttribute("data-viewport-moving", "");
      expect(await root.getAttribute("data-chip-fits")).toBe(fits);
      await expect(root).not.toHaveAttribute("data-low-zoom");
    }
    await page.clock.runFor(400);
    await expect(root).toHaveAttribute("data-low-zoom", "mid");
    const settled = Number(await root.getAttribute("data-chip-fits"));
    expect(settled - Number(fits)).toBe(1);
    for (let n = 0; n < 8; n++) {
      await pane.dispatchEvent("wheel", { deltaY: 10, bubbles: true });
      await page.clock.runFor(16);
    }
    expect(Number(await root.getAttribute("data-chip-fits"))).toBe(settled);
  });

test("low zoom removes most card and edge drawing elements", async ({ page }) => {
  await gotoCanvas(page, "black-friday-commerce");
  // Drawing elements, apart from React Flow's interaction scaffolding: the connection dots and the edges'
  // invisible hit strokes. Those stay one for one at every zoom, so connecting, reconnecting and clicking
  // beside a hairline work as they do at 100% (flow-building.spec.ts, lowzoom-edge-edit.spec.ts).
  const SCAFFOLD = ".react-flow__handle, .react-flow__edge-interaction";
  const count = () =>
    page.getByTestId("canvas-wrap").evaluate((root, scaffold) => {
      const elements = [...root.querySelectorAll('[data-testid^="node-"],[data-testid^="edge-"]')]
        .filter((el) => /^(node|edge)-/.test(el.getAttribute("data-testid") ?? ""))
        .flatMap((el) => [el, ...el.querySelectorAll("*")]);
      return {
        drawing: elements.filter((el) => !el.matches(scaffold)).length,
        handles: elements.filter((el) => el.matches(".react-flow__handle")).length,
        hits: elements.filter((el) => el.matches(".react-flow__edge-interaction")).length,
      };
    }, SCAFFOLD);
  await zoomIdentity(page, 1);
  const full = await count();
  await zoomIdentity(page, 0.4);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
  const low = await count();
  expect({ handles: low.handles, hits: low.hits }).toEqual({ handles: full.handles, hits: full.hits });
  expect(full.hits).toBe(commerce.edges.length);
  // The drawing shrinks to under 45% (black-friday-commerce: 386 of 876). The earlier bound, under 40% of
  // everything with three of every four dots removed, allowed up to 47% of this drawing.
  expect(low.drawing).toBeLessThan(full.drawing * 0.45);
});

test("a troubled drill accents chips and rolls up zone health without animated canvases", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=poison-deploy&paused=1");
  await waitForCameraIdle(page);
  await page.getByTestId("live-timeline-input").fill("376");
  await page.getByTestId("live-timeline-input").press("ArrowRight");
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  await zoomIdentity(page, 0.25);
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "far");
  await expect
    .poll(() => page.getByTestId("node-loyalty").evaluate((el) => el.parentElement?.getAttribute("data-live-trouble")))
    .toBe("failing");
  await expect(page.getByTestId("zone-trouble-fulfil")).toContainText("1 failing");
  await expect
    .poll(() => page.getByTestId("live-canvas").evaluate((el) => getComputedStyle(el).visibility))
    .toBe("hidden");
  await pauseClock(page);
  // Flush the UI's batched frame counter (and any already posted worker reply).
  await page.clock.runFor(1000);
  const frames = await page.getByTestId("live-canvas").getAttribute("data-frames");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("live-canvas")).toHaveAttribute("data-frames", frames ?? "0");
  await page.clock.resume();
  await page.getByTestId("node-loyalty").hover();
  await expect(page.getByTestId("hover-full-name")).toHaveText("Loyalty points");
  await expect(page.getByTestId("hover-full-name")).not.toHaveAttribute("title");
});

for (const renderer of ["worker", "main"])
  test(`low zoom stops painting during running playback: ${renderer}`, async ({ page }) => {
    await installParticleCounters(page);
    await page.clock.install();
    await gotoLive(
      page,
      `./?view=canvas&example=kafka-order-pipeline&live=1&sim=black-friday&paused=1&renderer=${renderer}`,
    );
    const play = page.getByTestId("live-play");
    const settleZoom = async () => {
      await expect
        .poll(
          async () => {
            await page.clock.runFor(32);
            return page
              .getByTestId("canvas-wrap")
              .evaluate((el) => !el.hasAttribute("data-viewport-moving") && el.dataset.chipsPending === "false");
          },
          { intervals: [0] },
        )
        .toBe(true);
    };
    await expect(play).toHaveAttribute("data-state", "paused");
    await expect.poll(() => page.evaluate(() => typeof window.__liveProbe)).toBe("function");
    await zoomIdentity(page, 0.8);
    await pauseClock(page);
    await settleZoom();
    await play.click();
    await expect(play).toHaveAttribute("data-state", "playing");
    const frames = async () => (await rendererCounters(page, true)).frames;
    const clock = async () => Number(await page.getByTestId("live-clock").getAttribute("data-ms"));
    const first = await frames();
    await page.clock.runFor(1000);
    expect(await frames()).toBeGreaterThan(first);
    // Keep playback running through both manual zooms, advancing only the controlled page clock.
    await zoomIdentity(page, 0.4);
    await settleZoom();
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
    await expect(play).toHaveAttribute("data-state", "playing");
    // Counters publish every other UI tick; measure after that pending publish.
    await page.clock.runFor(1000);
    const stopped = await frames();
    const time = await clock();
    await page.clock.runFor(1000);
    expect(await clock()).toBeGreaterThan(time);
    expect(await frames()).toBe(stopped);
    await zoomIdentity(page, 0.8);
    await settleZoom();
    await expect(play).toHaveAttribute("data-state", "playing");
    const resumed = await frames();
    await page.clock.runFor(1000);
    expect(await frames()).toBeGreaterThan(resumed);
  });

/**
 * The saved SVG as a digest, canonicalized: generated ids renamed in order of appearance, and each tag's attributes
 * and each copied style's declarations sorted. Those orders already vary with a page's history on the natural
 * drawing alone (Chrome lists custom properties by zoom history; a label drawn before the lazy edge details gets
 * its title appended), so only order is set aside: every element, attribute, name and value still counts.
 */
async function svgDigest(page: Page) {
  return page.evaluate(async () => {
    const image = (await import("/src/interop/image.ts" as string)) as typeof import("../../src/interop/image");
    const text = await (await image.renderDiagramImage("svg")).text();
    const names = new Map<string, string>();
    const canonical = text
      .replace(/\bu[0-9a-z]{4}\d+\b/g, (name) => {
        if (!names.has(name)) names.set(name, `pseudo${names.size}`);
        return names.get(name) ?? name;
      })
      .replace(/style="([^"]*)"/g, (_, style: string) => `style="${style.split("; ").sort().join("; ")}"`)
      .replace(
        /<([\w:-]+)((?:\s+[\w:-]+="[^"]*")+)/g,
        (_, tag: string, attributes: string) =>
          `<${tag} ${(attributes.match(/[\w:-]+="[^"]*"/g) ?? []).sort().join(" ")}`,
      );
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}

// Six 9.5 MB captures in one test outran its deadline (docs/backlog/2026-11-01-svg-export-speed-investigation.md).
// The same comparisons run as two tests: 40%, then 25% followed by the return to 100%, so a capture
// below 60% still precedes the 100% check that nothing the chips placed on the page stays behind.
for (const zooms of [[0.4], [0.25, 1]] as const) {
  const label = zooms.map((z) => `${z * 100}%`).join(" then ");
  test(`image exports never include the chips: the natural drawing's SVG at ${label} @dev`, async ({
    page,
    browser,
  }, info) => {
    // The same canvas in a second browser with the chips switched off (the parity tier's switch).
    const { baseURL, viewport, colorScheme, deviceScaleFactor } = info.project.use;
    const context = await browser.newContext({ baseURL, viewport, colorScheme, deviceScaleFactor });
    try {
      const natural = await context.newPage();
      await natural.addInitScript(() => localStorage.setItem("diagrams.lowZoom", "off"));
      // Zones with moved headers, merged lanes and wrapped names: everything the chips restyle.
      await Promise.all(
        [page, natural].map(async (p) => {
          await gotoCanvas(p, "black-friday-commerce");
          // A capture below 60% turns far-zoom cards back to natural ones while it copies them, so without this
          // the natural reference would catch some borders and shadows mid-transition. Compare settled values.
          await p.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
        }),
      );
      for (const zoom of zooms) {
        const tier = zoom < 0.3 ? "far" : "mid";
        await Promise.all([page, natural].map((p) => zoomIdentity(p, zoom)));
        if (zoom < 0.6) await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", tier);
        await expect(natural.getByTestId("canvas-wrap")).not.toHaveAttribute("data-low-zoom");
        const [actual, expected] = await Promise.all([svgDigest(page), svgDigest(natural)]);
        expect({ zoom, digest: actual }).toEqual({ zoom, digest: expected });
        // The capture hands the screen back to the chips.
        if (zoom < 0.6) await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", tier);
      }
    } finally {
      await context.close();
    }
  });
}
import { installParticleCounters, rendererCounters } from "./particle-counters";
