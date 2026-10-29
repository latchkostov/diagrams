import { test, expect, gotoCanvas, gotoLive, pauseClock } from "./fixtures";
import { zoomIdentity } from "./node-identity";

for (const activation of ["pointer", "keyboard"] as const)
  test(`Config settings dismiss and reopen on ${activation} reselection at 50%`, async ({ page }) => {
    await page.clock.install();
    await gotoCanvas(page, "aks-app-config-key-vault");
    await zoomIdentity(page, 0.5);
    const edge = page.getByTestId("edge-api-to-appcfg");
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
    await expect(edge).toHaveAttribute("data-relation", "config");
    // React Flow's wrapper is the connection's keyboard stop.
    await page.keyboard.press("Shift");
    await edge.evaluate((el) => (el.parentElement as unknown as SVGElement).focus());
    await zoomIdentity(page, 0.5);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
    const card = page.getByTestId("edge-settings-api-to-appcfg");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Orders:PageSize");
    await expect(page.getByTestId("edge-setting-api-to-appcfg-2")).toHaveAttribute("data-secret", "1");
    await expect(page.getByTestId("edge-messages-api-to-appcfg")).not.toBeVisible();
    await edge.dispatchEvent("click");
    await page.getByTestId("canvas-wrap").focus();
    await expect(card).toBeVisible();
    const wrapper = page.getByTestId("relationship-wrapper-api-to-appcfg");
    await page.keyboard.press("Shift");
    await wrapper.focus();
    await zoomIdentity(page, 0.5);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
    await expect(card).toBeVisible();
    await expect(edge).toHaveClass(/is-selected/);
    // Hold the queued canvas deselection: the card must dismiss through its own lifecycle.
    await pauseClock(page);
    await wrapper.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(wrapper).toBeFocused();
    await page.clock.resume();
    // As at normal zoom, the canvas deselects while the settings dismiss and keyboard focus stays put.
    await expect(edge).not.toHaveClass(/is-selected/);
    await page.getByTestId("node-appcfg").click();
    await expect(card).toHaveCount(0);
    await expect(edge).not.toHaveClass(/is-selected/);
    if (activation === "pointer") await edge.dispatchEvent("click");
    else {
      // Reach the same incoming connection again using canvas keyboard navigation.
      // eslint-disable-next-line no-restricted-syntax -- Edge navigation uses literal Ctrl on every platform.
      await page.keyboard.press("Control+Alt+[");
      await expect(wrapper).toBeFocused();
    }
    await expect(edge).toHaveClass(/is-selected/);
    await expect(card).toBeVisible();
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", "mid");
  });

test("changing language preserves fitted chip widths and merged paths", async ({ page }) => {
  await gotoCanvas(page, "black-friday-commerce");
  await zoomIdentity(page, 0.4);
  const root = page.getByTestId("canvas-wrap");
  await expect(root).toHaveAttribute("data-low-zoom", "mid");
  const geometry = () =>
    root.evaluate((root) => ({
      widths: [...root.querySelectorAll<HTMLElement>('[data-testid="card-title"]')].map((el) => {
        if (!el.parentElement) throw new Error("Missing chip body");
        return el.parentElement.style.width;
      }),
      paths: [...root.querySelectorAll('[data-testid^="connection-stroke-"]')].map((el) => el.getAttribute("d")),
    }));
  const before = await geometry();
  expect(before.widths.every(Boolean)).toBe(true);
  expect(before.paths.some((path) => path?.includes(" M"))).toBe(true);
  await page.getByTestId("view-button").click();
  await page.getByTestId("view-language").click();
  await page.getByTestId("language-option-de").click();
  await expect(page.getByTestId("language-option-de")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("language-done").click();
  await expect.poll(geometry).toEqual(before);
});

for (const zoom of [0.4, 0.25])
  test(`failing and stressed chips paint their accents and recover at ${zoom}`, async ({ page }) => {
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=black-friday-commerce&live=1&sim=poison-deploy&paused=1");
    await zoomIdentity(page, zoom);
    await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-low-zoom", zoom < 0.3 ? "far" : "mid");
    const ink = (id: string) =>
      page
        .getByTestId(`node-${id}`)
        .getByTestId("card-title")
        .evaluate((title) => {
          const body = title.parentElement;
          if (!body) throw new Error("Missing chip body");
          const style = getComputedStyle(body);
          return { border: style.borderTopColor, tint: style.backgroundColor, shadow: style.boxShadow };
        });
    const healthy = await ink("loyalty");
    const seek = async (value: string) => {
      await page.getByTestId("live-timeline-input").fill(value);
      await page.getByTestId("live-timeline-input").press("ArrowRight");
    };
    await seek("376");
    for (const [id, status, token, mix] of [
      ["loyalty", "failing", "down", 12],
      ["dlq-triage", "stressed", "paused", 9],
    ] as const) {
      await expect(page.getByTestId(`rf__node-${id}`)).toHaveAttribute("data-live-trouble", status);
      const expected = await page
        .getByTestId(`node-${id}`)
        .getByTestId("card-title")
        .evaluate(
          (title, { token, mix }) => {
            const probe = document.createElement("span");
            const body = title.parentElement;
            if (!body) throw new Error("Missing chip body");
            body.append(probe);
            probe.style.borderColor =
              token === "down" ? "var(--status-down)" : "color-mix(in oklab, var(--status-paused) 75%, var(--text))";
            probe.style.backgroundColor = `color-mix(in oklab, var(--status-${token}) ${mix}%, var(--node-bg))`;
            probe.style.boxShadow = `inset calc(3px / var(--rf-zoom-exact)) 0 0 var(--status-${token})`;
            const style = getComputedStyle(probe);
            const result = { border: style.borderTopColor, tint: style.backgroundColor, shadow: style.boxShadow };
            probe.remove();
            return result;
          },
          { token, mix },
        );
      await expect.poll(() => ink(id)).toEqual(expected);
    }
    await seek("999");
    await expect(page.getByTestId("rf__node-dlq-triage")).not.toHaveAttribute("data-live-trouble");
    await expect.poll(async () => (await ink("dlq-triage")).shadow.includes("inset")).toBe(false);
    await seek("0");
    await expect(page.getByTestId("rf__node-loyalty")).not.toHaveAttribute("data-live-trouble");
    await expect.poll(() => ink("loyalty")).toEqual(healthy);
  });
