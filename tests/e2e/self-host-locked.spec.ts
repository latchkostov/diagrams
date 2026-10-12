import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { test, expect, gotoCanvas, gotoLab, expectNoErrors, publicExamples } from "./fixtures";
import { installFakeModelContext, must, toolNames } from "./ai-helpers";

/**
 * A self-hosted copy with every switch off (docs/SELF-HOSTING.md): project "locked" in playwright.config.ts
 * (LOCKED_ENV). Links people send don't open (in the app or an embed), and with AI tools and the on-device model
 * both off there's no AI panel at all. Selectors are data-testid only.
 */

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const OFF = "Opening shared links is turned off here. Ask for the diagram file instead.";
const other = must(
  publicExamples.find((e) => e.slug !== SLUG),
  "another public example",
);
const kafka = must(
  publicExamples.find((e) => e.slug === SLUG),
  "the Kafka example",
);
const payload = deflateRawSync(readFileSync(`src/examples/${other.slug}.json`)).toString("base64url");

test.describe("self-hosted build with link opening off", () => {
  test("the Lab has no on-device model evals: nothing there can run the model", async ({ page, consoleErrors }) => {
    await gotoLab(page);
    await expect(page.getByTestId(/^lab-preset-link-/).first()).toBeVisible();
    await expect(page.getByTestId("lab-preset-link-ondevice-evals")).toHaveCount(0);
    await page.goto("./?view=lab&preset=ondevice-evals");
    await expect(page.getByTestId("lab-view")).toBeVisible();
    await expect(page.getByTestId("ondevice-evals")).toHaveCount(0);
    await expect(page.getByTestId("ondevice-evals-run")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("a link someone sent doesn't open, and leaves the address bar", async ({ page, consoleErrors }) => {
    await page.goto(`./?view=canvas&example=${SLUG}#d=${payload}`);
    await expect(page.getByTestId("toast").filter({ hasText: OFF })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    await expect(page.getByTestId("shared-banner")).toHaveCount(0);
    await expect(page.getByTestId(`node-${other.nodeIds[0]}`)).toHaveCount(0);
    await expect(page).not.toHaveURL(/#d=/);

    // A password link the same way: no password prompt.
    await page.evaluate(
      () => (window.location.hash = "e=v1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    );
    await expect(page.getByTestId("toast").filter({ hasText: OFF })).toBeVisible();
    await expect(page.getByTestId("password-prompt")).toHaveCount(0);

    // And there's no way in from the File menu.
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-import-from").click();
    await expect(page.getByTestId("import-paste")).toBeVisible();
    await expect(page.getByTestId("import-share-link")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

  test("an embed carrying a diagram says so; an example's embed still shows", async ({ page, consoleErrors }) => {
    await page.goto(`./?embed=1#d=${payload}`);
    await expect(page.getByTestId("embed-error")).toHaveText(OFF);
    await expect(page.getByTestId(`node-${other.nodeIds[0]}`)).toHaveCount(0);

    await page.goto(`./?embed=1&example=${SLUG}`);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("embed-open-in-app")).toContainText("Open in Live Diagrams");
    expectNoErrors(consoleErrors);
  });

  test("no AI panel: no rail, no Ctrl+I, no menu entry, no tools", async ({ page, consoleErrors }) => {
    await installFakeModelContext(page);
    await gotoCanvas(page, SLUG);
    await expect(page.getByTestId(`node-${kafka.nodeIds[0]}`)).toBeVisible();
    await expect(page.getByTestId("brand")).toHaveText("Live Diagrams");
    await expect(page.getByTestId("ai-rail")).toHaveCount(0);
    await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 60 } });
    await page.keyboard.press(`${MOD}+i`);
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-canvas.ai-panel")).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(await toolNames(page)).toEqual([]);
    expectNoErrors(consoleErrors);
  });
});
