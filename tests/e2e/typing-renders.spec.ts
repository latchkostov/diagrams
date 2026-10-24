import {
  test,
  expect,
  gotoCanvas,
  waitForCameraIdle,
  waitForHistoryIdle,
  waitForAutosave,
  waitForChecks,
  pauseClock,
  TEXT_END,
  waitForStableBox,
} from "./fixtures";
import { typingFixture } from "../../src/lab/typingFixture";
import { RENDER_HOOK } from "../bench/ui/instrument";
import { median, typingWork } from "./typing-work";

for (const field of ["label", "sublabel", "node-description"] as const) {
  test(`typing ${field} renders only the affected parts`, async ({ page }, info) => {
    await page.clock.install();
    await page.addInitScript(RENDER_HOOK);
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("import-input").setInputFiles({
      name: "typing.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(typingFixture)),
    });
    await expect(page.getByTestId("diagram-title")).toHaveText("Typing");
    await page.getByTestId("node-api").dblclick();
    const input = page.getByTestId(`inspector-field-${field}`);
    await expect(input).toBeVisible();
    // Warm lazy fields, focus and the documentation badge before counting steady-state input.
    await input.fill("An existing value wider than the card's maximum label width");
    await input.press(TEXT_END);
    await waitForCameraIdle(page);
    await waitForChecks(page);
    await waitForHistoryIdle(page);
    await waitForAutosave(page);
    await expect(page.getByTestId("undo-button")).toBeEnabled();
    await pauseClock(page);
    const work = await typingWork(page, false, () => page.clock.runFor(32));
    const samples = [];
    for (const ch of "xyz123") {
      await page.evaluate((explain) => window.__benchRenders?.start(explain), process.env.TYPING_PROFILE === "1");
      await work.key(ch);
      const sample = await page.evaluate(() => window.__benchRenders?.stop());
      if (!sample) throw new Error("React render hook was not installed");
      samples.push(sample);
    }
    await work.close();
    info.annotations.push({ type: "typing-renders", description: JSON.stringify({ field, samples }) });
    expect(median(samples.map((s) => s.total)), `${field} renders per key`).toBeLessThanOrEqual(15);
    expect(median(samples.map((s) => s.commits)), `${field} commits per key`).toBeLessThanOrEqual(2);
    await expect(input).toHaveValue("An existing value wider than the card's maximum label widthxyz123");
    await page.clock.resume();
    await input.blur();
    await waitForHistoryIdle(page);
    await page.getByTestId("undo-button").click();
    await expect(input).not.toHaveValue("An existing value wider than the card's maximum label widthxyz123");
    await expect(page.getByTestId("redo-button")).toBeEnabled();
    await page.getByTestId("redo-button").click();
    await expect(input).toHaveValue("An existing value wider than the card's maximum label widthxyz123");
  });
}

test("renaming a growing card keeps the add-node chip clear", async ({ page }) => {
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.getByTestId("import-input").setInputFiles({
    name: "typing.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(typingFixture)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Typing");
  const node = page.getByTestId("node-api");
  await node.dblclick();
  const label = page.getByTestId("inspector-field-label");
  const chip = page.getByTestId("grow-chip-api");
  await expect(chip).toHaveAttribute("data-side", "right");
  await waitForCameraIdle(page);
  await waitForHistoryIdle(page);
  await waitForAutosave(page);
  await waitForStableBox(node);
  const before = await node.boundingBox();
  if (!before) throw new Error("Expected the API card");
  await label.fill("A much wider label that grows the API card");
  await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThan(before.width);
  await expect(chip).toHaveAttribute("data-side", "bottom");
  await waitForStableBox(node);
  await label.fill("API");
  await expect(chip).toHaveAttribute("data-side", "right");
});
